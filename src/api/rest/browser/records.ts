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
 * API rules, guards, hooks, cascades, and trash logic.
 */

const READ_ONLY = new Set(["trash_documents", "trash_folders", "task_relations", "task_activity"]);
const ADMIN_ONLY = new Set(["settings"]);

const CREATE_FIELDS: Record<string, Set<string>> = {
    documents: new Set([
        "title", "slug", "content", "tags", "folder",
        "is_public", "is_private", "share_attachments", "public_share_token",
        "public_expires_at", "attachments",
    ]),
    folders: new Set([
        "name", "color", "parent", "is_public", "is_private",
        "share_attachments", "public_share_token", "public_expires_at",
    ]),
    boards: new Set([
        "name", "description", "archived", "folder", "icon", "is_private",
        "is_public", "public_share_token", "public_expires_at",
    ]),
    board_columns: new Set([
        "board", "name", "slug", "position", "icon", "color", "is_final",
    ]),
    labels: new Set(["name", "color"]),
    tasks: new Set([
        "title", "description", "status", "priority", "due_date", "start_date",
        "board_order", "labels", "board", "document", "assignee", "recurrence",
    ]),
    users: new Set([
        "email", "password", "passwordConfirm", "name", "admin", "emailVisibility",
    ]),
    settings: new Set(["key", "value", "description"]),
};

// A task's board is fixed at creation; the facade never forwards it on update.
const TASK_UPDATE_FIELDS = new Set([
    "title", "description", "status", "priority", "due_date", "start_date",
    "board_order", "labels", "document", "assignee", "recurrence",
]);

const UPDATE_FIELDS: Record<string, Set<string>> = {
    // `revision` is the optimistic-concurrency token for content/title/tags.
    // It is server-validated by the PocketBase revision guard; dropping it here
    // silently turns every stale save into an overwrite.
    documents: new Set([...CREATE_FIELDS.documents, "revision"]),
    folders: CREATE_FIELDS.folders,
    boards: CREATE_FIELDS.boards,
    board_columns: new Set(["name", "slug", "position", "icon", "color", "is_final"]),
    labels: CREATE_FIELDS.labels,
    tasks: TASK_UPDATE_FIELDS,
    users: new Set(["name", "avatar", "oldPassword", "password", "passwordConfirm", "emailVisibility"]),
    settings: new Set(["value", "description"]),
};

const ADMIN_USER_UPDATE_FIELDS = new Set([
    "email", "name", "admin", "password", "passwordConfirm", "verified",
    "emailVisibility", "avatar",
]);

const ALLOWED_COLLECTIONS = new Set([
    "documents", "folders", "boards", "board_columns", "labels", "tasks",
    "task_relations", "task_activity",
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

async function sanitizeRichContent(
    collection: string,
    data: Record<string, unknown> | FormData,
): Promise<void> {
    const field = collection === "documents"
        ? "content"
        : collection === "tasks"
            ? "description"
            : "";

    if (!field) return;

    if (data instanceof FormData) {
        const value = data.get(field);
        if (typeof value === "string") data.set(field, await sanitizeHtml(value));
        return;
    }

    if (typeof data[field] === "string") {
        data[field] = await sanitizeHtml(data[field] as string);
    }
}

async function prepareBoardColumn(
    collection: string,
    data: Record<string, unknown> | FormData,
): Promise<void> {
    if (collection !== "board_columns") return;

    const read = (key: string): unknown =>
        data instanceof FormData ? data.get(key) : data[key];
    const write = (key: string, value: string): void => {
        if (data instanceof FormData) data.set(key, value);
        else data[key] = value;
    };

    const existing = read("slug");
    if (typeof existing === "string" && existing.trim()) return;

    const name = read("name");
    const slug = String(typeof name === "string" ? name : "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "column";
    write("slug", slug);
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

async function pbGetJson(
    auth: BrowserAuth,
    path: string,
): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${serverConfig.pocketbaseUrl}${path}`, {
        headers: {
            Authorization: auth.token,
            Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    try {
        return (await response.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

async function loadRecord(
    auth: BrowserAuth,
    collection: string,
    id: string,
    fields?: string,
): Promise<Record<string, unknown> | null> {
    const query = fields ? `?${new URLSearchParams({ fields })}` : "";
    return pbGetJson(auth, `${recordPath(collection, id)}${query}`);
}

async function listRecords(
    auth: BrowserAuth,
    collection: string,
    filter: string,
    fields?: string,
    perPage = 1,
): Promise<Array<Record<string, unknown>> | null> {
    const params = new URLSearchParams({
        filter,
        perPage: String(perPage),
    });
    if (fields) params.set("fields", fields);
    const result = await pbGetJson(
        auth,
        `${recordPath(collection)}?${params.toString()}`,
    );
    if (!result || !Array.isArray(result.items)) return null;
    return result.items as Array<Record<string, unknown>>;
}

/** Column slugs for a board, or null when the lookup itself failed. */
async function boardColumnSlugs(auth: BrowserAuth, boardId: string): Promise<Set<string> | null> {
    const items = await listRecords(
        auth,
        "board_columns",
        `board="${boardId}"`,
        "slug",
        200,
    );
    if (!items) return null;
    return new Set(
        items
            .map((item) => (typeof item.slug === "string" ? item.slug.trim() : ""))
            .filter(Boolean),
    );
}

const TASK_STATUS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/;

async function validateTaskStatus(
    auth: BrowserAuth,
    boardId: string,
    status: string,
): Promise<Response | null> {
    const value = status.trim();
    if (!value) return jsonError(400, "Choose a task status.");
    if (value === "planned" || value === "archived") return null;
    if (!TASK_STATUS_PATTERN.test(value)) {
        return jsonError(400, "That task status is not valid.");
    }

    const slugs = await boardColumnSlugs(auth, boardId);
    // A failed column read falls through to the PocketBase status guard, which
    // resolves the same set inside the write transaction.
    if (slugs && !slugs.has(value)) {
        return jsonError(400, "That task status does not exist on this board.");
    }
    return null;
}

/** Whether the caller can reach the task's board at all; PB rules decide edit. */
async function taskBoardWritable(auth: BrowserAuth, boardId: string): Promise<Response | null> {
    const board = await loadRecord(auth, "boards", boardId, "id,archived");
    if (!board) return jsonError(404, "Not found.");
    if (board.archived === true) {
        return jsonError(400, "Boards in trash cannot be changed.");
    }
    return null;
}

async function validateTaskWrite(
    auth: BrowserAuth,
    data: Record<string, unknown>,
    targetId?: string,
): Promise<Response | null> {
    const isCreate = !targetId;
    let current: Record<string, unknown> | null = null;

    if (!isCreate) {
        current = await loadRecord(auth, "tasks", targetId, "id,board,status");
        if (!current) return jsonError(404, "Not found.");
    }

    const boardId = typeof data.board === "string" && data.board
        ? data.board
        : typeof current?.board === "string"
            ? current.board
            : "";
    if (!boardId) return jsonError(400, "A task requires a board.");

    const submittedStatus = typeof data.status === "string";
    const status = submittedStatus
        ? data.status as string
        : isCreate
            ? ""
            : typeof current?.status === "string"
                ? current.status
                : "";

    if (!status) return jsonError(400, "Choose a task status.");
    // Validate the slug when it is submitted (create/status move). A legacy
    // task with a nonconforming stored status can still be edited; the PB status
    // guard resolves the stored value against the board's real columns.
    if (isCreate || submittedStatus) {
        const invalidStatus = await validateTaskStatus(auth, boardId, status);
        if (invalidStatus) return invalidStatus;
    }

    if (data.assignee !== undefined && typeof data.assignee !== "string") {
        return jsonError(400, "That assignee is not valid.");
    }

    // Assignability is enforced by the PocketBase assignee guard with the same
    // effective-access resolver the rules use. Duplicating the share walk here
    // blocked edit grantees and could disagree with folder/privacy resolution.
    return null;
}

async function boardColumnIsOwned(auth: BrowserAuth, id: string): Promise<boolean> {
    const column = await loadRecord(auth, "board_columns", id, "id,board");
    if (!column || typeof column.board !== "string" || !column.board) return false;
    return relationIsOwned(auth, "boards", column.board);
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

    if (collection === "board_columns") {
        if (typeof data.slug === "string") {
            const slug = data.slug.trim().toLowerCase();
            if (slug === "planned" || slug === "archived") {
                return jsonError(400, "That column key is reserved for the virtual backlog.");
            }
        }
        if (data.board !== undefined) {
            if (typeof data.board !== "string" || !data.board) {
                return jsonError(400, "A column requires a board.");
            }
            if (!(await relationIsOwned(auth, "boards", data.board))) {
                return jsonError(404, "Not found.");
            }
        } else if (!targetId) {
            return jsonError(400, "A column requires a board.");
        }
    }

    if (collection === "tasks") {
        if (data.board !== undefined) {
            if (typeof data.board !== "string" || !data.board) {
                return jsonError(400, "A task requires a board.");
            }
            // Read access is enough at the facade; PocketBase's create/update
            // rule requires the owner or an edit grant. This is what lets an
            // edit grantee add tasks to a board shared with them.
            const invalidBoard = await taskBoardWritable(auth, data.board);
            if (invalidBoard) return invalidBoard;
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
    for (const key of ["parent", "folder", "board", "document", "assignee"]) {
        const value = form.get(key);
        if (typeof value === "string") relations[key] = value;
    }
    return relations;
}

function formScalars(form: FormData): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
        if (typeof value === "string") values[key] = value;
    }
    return values;
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
        await prepareBoardColumn(collection, data);
        await sanitizeRichContent(collection, data);
        const invalid = await validateRelations(auth, collection, formRelations(parsed.form));
        if (invalid) return invalid;
        if (collection === "tasks") {
            const invalidTask = await validateTaskWrite(auth, formScalars(parsed.form));
            if (invalidTask) return invalidTask;
        }
        return forwardToPocketBase(req, recordPath(collection), {
            token: auth.token,
            body: data,
        });
    }

    const data = pickJson(parsed.json ?? {}, fields, auth.userId, true);
    await prepareBoardColumn(collection, data);
    await sanitizeRichContent(collection, data);
    const invalid = await validateRelations(auth, collection, data);
    if (invalid) return invalid;
    if (collection === "tasks") {
        const invalidTask = await validateTaskWrite(auth, data);
        if (invalidTask) return invalidTask;
    }
    return forwardJson(req, recordPath(collection), { token: auth.token, body: data });
}

async function handleUpdate(req: Request, collection: string, id: string): Promise<Response> {
    if (!ALLOWED_COLLECTIONS.has(collection)) return jsonError(404, "Not found.");
    if (READ_ONLY.has(collection)) return jsonError(405, "Method not allowed.");

    const parsed = await parseBody(req);
    if (parsed instanceof Response) return parsed;

    if (
        collection === "tasks" &&
        ((parsed.json && Object.prototype.hasOwnProperty.call(parsed.json, "board")) ||
            (parsed.form && parsed.form.has("board")))
    ) {
        return jsonError(400, "A task cannot move to another board.");
    }

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
        await sanitizeRichContent(collection, data);
        if (collection !== "users" && collection !== "settings") {
            const invalid = await validateRelations(auth, collection, formRelations(parsed.form), id);
            if (invalid) return invalid;
        }
        if (collection === "tasks") {
            const invalidTask = await validateTaskWrite(auth, formScalars(parsed.form), id);
            if (invalidTask) return invalidTask;
        }
        if (collection === "board_columns" && !(await boardColumnIsOwned(auth, id))) {
            return jsonError(404, "Not found.");
        }
        return forwardToPocketBase(req, recordPath(collection, id), {
            token: auth.token,
            body: data,
        });
    }

    const data = pickJson(parsed.json ?? {}, fields);
    await sanitizeRichContent(collection, data);
    const invalid = await validateRelations(auth, collection, data, id);
    if (invalid) return invalid;
    if (collection === "tasks") {
        const invalidTask = await validateTaskWrite(auth, data, id);
        if (invalidTask) return invalidTask;
    }
    if (collection === "board_columns" && !(await boardColumnIsOwned(auth, id))) {
        return jsonError(404, "Not found.");
    }
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

    if (collection === "board_columns" && !(await boardColumnIsOwned(auth, id))) {
        return jsonError(404, "Not found.");
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
