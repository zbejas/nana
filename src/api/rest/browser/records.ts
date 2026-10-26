import { Elysia } from "elysia";
import { sanitizeHtml } from "../../../lib/sanitize";
import { serverConfig } from "../../../lib/config";
import {
    BrowserAuthError,
    jsonError,
    requireBrowserAdmin,
    requireBrowserAuth,
    type BrowserAuth,
} from "./auth";
import { forwardJson, forwardToPocketBase, readRawBody } from "./proxy";

/**
 * Browser-compatible record surface.
 *
 * The SPA still speaks the PocketBase record shape (snake_case fields, PB
 * filters, `expand`, file metadata). This facade keeps that contract while
 * making Elysia the only public edge: collection names are allowlisted,
 * PocketBase system fields and ownership cannot be supplied by the browser,
 * relation ownership is checked before writes, and PocketBase still runs its
 * API rules, guards, hooks, cascades, and version/trash logic.
 */

const READ_ONLY = new Set(["document_versions", "trash_documents", "trash_folders"]);
const ADMIN_ONLY = new Set(["settings"]);

const CREATE_FIELDS: Record<string, Set<string>> = {
    documents: new Set([
        "title", "slug", "content", "tags", "published", "folder",
        "is_public", "is_private", "share_attachments", "public_share_token",
        "public_expires_at", "attachments",
    ]),
    folders: new Set([
        "name", "color", "parent", "is_public", "is_private",
        "share_attachments", "public_share_token", "public_expires_at",
    ]),
    boards: new Set([
        "name", "description", "archived", "folder", "is_private", "is_public",
        "public_share_token", "public_expires_at",
    ]),
    tasks: new Set([
        "title", "description", "status", "priority", "due_date", "board_order",
        "labels", "board", "document",
    ]),
    users: new Set([
        "email", "password", "passwordConfirm", "name", "admin", "emailVisibility",
    ]),
    settings: new Set(["key", "value", "description"]),
};

const UPDATE_FIELDS: Record<string, Set<string>> = {
    documents: CREATE_FIELDS.documents,
    folders: CREATE_FIELDS.folders,
    boards: CREATE_FIELDS.boards,
    tasks: CREATE_FIELDS.tasks,
    users: new Set(["name", "avatar", "oldPassword", "password", "passwordConfirm", "emailVisibility"]),
    settings: new Set(["value", "description"]),
};

const ADMIN_USER_UPDATE_FIELDS = new Set([
    "email", "name", "admin", "password", "passwordConfirm", "verified",
    "emailVisibility", "avatar",
]);

const ALLOWED_COLLECTIONS = new Set([
    "documents", "folders", "boards", "tasks", "document_versions",
    "trash_documents", "trash_folders", "users", "settings",
]);

interface ParsedBody {
    raw: ArrayBuffer;
    json?: Record<string, unknown>;
    form?: FormData;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function parseBody(req: Request): Promise<ParsedBody | Response> {
    const raw = await readRawBody(req);
    if (raw.byteLength === 0) return { raw, json: {} };

    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(raw));
            if (!isPlainObject(parsed)) return jsonError(400, "Invalid request body.");
            return { raw, json: parsed };
        } catch {
            return jsonError(400, "Invalid request body.");
        }
    }

    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
        try {
            const form = await new Response(raw, {
                headers: { "content-type": req.headers.get("content-type") ?? "" },
            }).formData();
            return { raw, form };
        } catch {
            return jsonError(400, "Invalid request body.");
        }
    }

    return { raw };
}

function recordPath(collection: string, id?: string): string {
    const base = `/api/collections/${encodeURIComponent(collection)}/records`;
    return id ? `${base}/${encodeURIComponent(id)}` : base;
}

function pickJson(
    data: Record<string, unknown>,
    fields: Set<string>,
    author?: string,
    isCreate = false,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        if (field in data) out[field] = data[field];
    }
    if (author) {
        out.author = author;
    } else if (isCreate) {
        delete out.author;
    } else {
        delete out.author;
    }
    return out;
}

function pickForm(form: FormData, fields: Set<string>, author?: string): FormData {
    const out = new FormData();
    for (const [key, value] of form.entries()) {
        if (fields.has(key)) out.append(key, value);
    }
    if (author) out.set("author", author);
    else out.delete("author");
    return out;
}

async function sanitizeDocumentContent(
    collection: string,
    data: Record<string, unknown> | FormData,
): Promise<void> {
    if (collection !== "documents") return;

    if (data instanceof FormData) {
        const content = data.get("content");
        if (typeof content === "string") data.set("content", await sanitizeHtml(content));
        return;
    }

    if (typeof data.content === "string") {
        data.content = await sanitizeHtml(data.content);
    }
}

async function relationIsOwned(
    auth: BrowserAuth,
    collection: string,
    id: unknown,
    options: { archived?: boolean; visible?: boolean } = {},
): Promise<boolean> {
    if (typeof id !== "string" || !id) return true;
    const response = await fetch(
        `${serverConfig.pocketbaseUrl}${recordPath(collection, id)}`,
        {
            headers: {
                Authorization: auth.token,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(8_000),
        },
    );
    if (!response.ok) return false;
    try {
        const record = (await response.json()) as Record<string, unknown>;
        if (record.author !== auth.userId) return false;
        if (options.archived && record.archived === true) return false;
        if (options.visible && String(record.deleted_at ?? "") !== "") return false;
        return true;
    } catch {
        return false;
    }
}

async function validateRelations(
    auth: BrowserAuth,
    collection: string,
    data: Record<string, unknown>,
    targetId?: string,
): Promise<Response | null> {
    if (collection === "folders") {
        if (typeof data.parent === "string" && data.parent) {
            if (data.parent === targetId) return jsonError(400, "A folder cannot be its own parent.");
            if (!(await relationIsOwned(auth, "folders", data.parent, { visible: true }))) {
                return jsonError(404, "Not found.");
            }
        }
    }

    if (collection === "documents" || collection === "boards") {
        if (typeof data.folder === "string" && data.folder) {
            if (!(await relationIsOwned(auth, "folders", data.folder, { visible: true }))) {
                return jsonError(404, "Not found.");
            }
        }
    }

    if (collection === "tasks") {
        if (data.board !== undefined) {
            if (typeof data.board !== "string" || !data.board) {
                return jsonError(400, "A task requires a board.");
            }
            if (!(await relationIsOwned(auth, "boards", data.board, { archived: true }))) {
                return jsonError(404, "Not found.");
            }
        } else if (!targetId) {
            return jsonError(400, "A task requires a board.");
        }

        if (typeof data.document === "string" && data.document) {
            if (!(await relationIsOwned(auth, "documents", data.document, { visible: true }))) {
                return jsonError(404, "Not found.");
            }
        }
    }

    return null;
}

async function optionalAuth(req: Request): Promise<BrowserAuth | null> {
    try {
        return requireBrowserAuth(req);
    } catch {
        return null;
    }
}

function formRelations(form: FormData): Record<string, unknown> {
    const relations: Record<string, unknown> = {};
    for (const key of ["parent", "folder", "board", "document"]) {
        const value = form.get(key);
        if (typeof value === "string") relations[key] = value;
    }
    return relations;
}

async function handleRead(req: Request, collection: string, id?: string): Promise<Response> {
    if (!ALLOWED_COLLECTIONS.has(collection)) return jsonError(404, "Not found.");

    if (ADMIN_ONLY.has(collection)) {
        try {
            const auth = await requireBrowserAdmin(req);
            return forwardToPocketBase(req, recordPath(collection, id), { token: auth.token });
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }

    try {
        const auth = requireBrowserAuth(req);
        return forwardToPocketBase(req, recordPath(collection, id), { token: auth.token });
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }
}

async function handleCreate(req: Request, collection: string): Promise<Response> {
    if (!ALLOWED_COLLECTIONS.has(collection)) return jsonError(404, "Not found.");
    if (READ_ONLY.has(collection)) return jsonError(405, "Method not allowed.");

    const parsed = await parseBody(req);
    if (parsed instanceof Response) return parsed;

    // First-user onboarding is public. PocketBase locks this rule after the
    // first account; an admin may also create users with a token.
    if (collection === "users") {
        const fields = CREATE_FIELDS.users;
        if (parsed.form) {
            return forwardToPocketBase(req, recordPath(collection), {
                token: (await optionalAuth(req))?.token,
                body: pickForm(parsed.form, fields),
            });
        }
        return forwardJson(req, recordPath(collection), {
            token: (await optionalAuth(req))?.token,
            body: pickJson(parsed.json ?? {}, fields),
        });
    }

    let auth: BrowserAuth;
    try {
        auth = ADMIN_ONLY.has(collection)
            ? await requireBrowserAdmin(req)
            : requireBrowserAuth(req);
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }

    const fields = CREATE_FIELDS[collection];
    if (!fields) return jsonError(405, "Method not allowed.");

    if (parsed.form) {
        const data = pickForm(parsed.form, fields, auth.userId);
        await sanitizeDocumentContent(collection, data);
        const invalid = await validateRelations(auth, collection, formRelations(parsed.form));
        if (invalid) return invalid;
        return forwardToPocketBase(req, recordPath(collection), {
            token: auth.token,
            body: data,
        });
    }

    const data = pickJson(parsed.json ?? {}, fields, auth.userId, true);
    await sanitizeDocumentContent(collection, data);
    const invalid = await validateRelations(auth, collection, data);
    if (invalid) return invalid;
    return forwardJson(req, recordPath(collection), { token: auth.token, body: data });
}

async function handleUpdate(req: Request, collection: string, id: string): Promise<Response> {
    if (!ALLOWED_COLLECTIONS.has(collection)) return jsonError(404, "Not found.");
    if (READ_ONLY.has(collection)) return jsonError(405, "Method not allowed.");

    const parsed = await parseBody(req);
    if (parsed instanceof Response) return parsed;

    let auth: BrowserAuth;
    try {
        auth = requireBrowserAuth(req);
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }

    let fields = UPDATE_FIELDS[collection];
    if (!fields) return jsonError(405, "Method not allowed.");

    if (collection === "settings") {
        try {
            auth = await requireBrowserAdmin(req);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }

    if (collection === "users") {
        if (id !== auth.userId) {
            try {
                await requireBrowserAdmin(req);
            } catch (error) {
                if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
                throw error;
            }
            fields = ADMIN_USER_UPDATE_FIELDS;
        }
    }

    if (parsed.form) {
        const data = pickForm(parsed.form, fields);
        await sanitizeDocumentContent(collection, data);
        if (collection !== "users" && collection !== "settings") {
            const invalid = await validateRelations(auth, collection, formRelations(parsed.form), id);
            if (invalid) return invalid;
        }
        return forwardToPocketBase(req, recordPath(collection, id), {
            token: auth.token,
            body: data,
        });
    }

    const data = pickJson(parsed.json ?? {}, fields);
    await sanitizeDocumentContent(collection, data);
    const invalid = await validateRelations(auth, collection, data, id);
    if (invalid) return invalid;
    return forwardJson(req, recordPath(collection, id), { token: auth.token, body: data });
}

async function handleDelete(req: Request, collection: string, id: string): Promise<Response> {
    if (!ALLOWED_COLLECTIONS.has(collection)) return jsonError(404, "Not found.");
    if (READ_ONLY.has(collection)) return jsonError(405, "Method not allowed.");

    let auth: BrowserAuth;
    try {
        auth = requireBrowserAuth(req);
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }

    if (collection === "users" || collection === "settings") {
        try {
            auth = await requireBrowserAdmin(req);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }

    return forwardToPocketBase(req, recordPath(collection, id), { token: auth.token });
}

export const browserRecordRoutes = new Elysia({ name: "nana-browser-records" })
    .get("/api/v1/records/:collection", ({ request, params }) =>
        handleRead(request, params.collection), { detail: { hide: true } })
    .get("/api/v1/records/:collection/:id", ({ request, params }) =>
        handleRead(request, params.collection, params.id), { detail: { hide: true } })
    .post("/api/v1/records/:collection", ({ request, params }) =>
        handleCreate(request, params.collection), {
        parse: "none",
        detail: { hide: true },
    })
    .patch("/api/v1/records/:collection/:id", ({ request, params }) =>
        handleUpdate(request, params.collection, params.id), {
        parse: "none",
        detail: { hide: true },
    })
    .delete("/api/v1/records/:collection/:id", ({ request, params }) =>
        handleDelete(request, params.collection, params.id), {
        parse: "none",
        detail: { hide: true },
    });
