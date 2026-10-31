import { Elysia } from "elysia";
import { serverConfig } from "../../../lib/config";
import { createLogger } from "../../../lib/logger";
import { removeDocumentVersions } from "../../versioning/service";
import { BrowserAuthError, jsonError, requireBrowserAdmin, requireBrowserAuth } from "./auth";
import { forwardRaw, forwardToPocketBase } from "./proxy";

const log = createLogger("BrowserTrash");

const TRASH_ACTIONS = new Set([
    "move-document",
    "restore-document",
    "permanent-delete-document",
    "move-folder",
    "restore-folder",
    "permanent-delete-folder",
]);

const TRASH_PAGE_SIZE = 200;
const TRASH_PAGE_LIMIT = 1_000;

function parseTrashBody(raw: ArrayBuffer): Record<string, unknown> {
    if (raw.byteLength === 0) return {};
    try {
        const parsed = JSON.parse(new TextDecoder().decode(raw)) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

function bodyId(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    return typeof value === "string" ? value.trim() : "";
}

/** Page through a read-only trash view with the caller's token. */
async function listTrashRecords(
    auth: { token: string },
    collection: "trash_folders" | "trash_documents",
    fields: string,
): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];

    for (let page = 1; page <= TRASH_PAGE_LIMIT; page++) {
        const params = new URLSearchParams({
            page: String(page),
            perPage: String(TRASH_PAGE_SIZE),
            fields,
        });
        const response = await fetch(
            `${serverConfig.pocketbaseUrl}/api/collections/${collection}/records?${params.toString()}`,
            {
                headers: { Authorization: auth.token, Accept: "application/json" },
                signal: AbortSignal.timeout(8_000),
            },
        );
        if (!response.ok) throw new Error(`Could not read ${collection}.`);

        const payload = (await response.json()) as { items?: unknown; totalPages?: unknown };
        const batch = Array.isArray(payload.items)
            ? payload.items.filter((item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object" && !Array.isArray(item))
            : [];
        items.push(...batch);

        const totalPages = Number(payload.totalPages);
        if (batch.length === 0 || batch.length < TRASH_PAGE_SIZE) break;
        if (Number.isFinite(totalPages) && page >= totalPages) break;
    }

    return items;
}

/**
 * Document ids inside a trashed folder subtree. The delete is hard, so these
 * repositories must be removed after PocketBase confirms the cascade.
 */
async function collectTrashFolderDocumentIds(
    auth: { token: string },
    rootFolderId: string,
): Promise<string[]> {
    const [folders, documents] = await Promise.all([
        listTrashRecords(auth, "trash_folders", "id,parent"),
        listTrashRecords(auth, "trash_documents", "id,folder"),
    ]);

    const children = new Map<string, string[]>();
    for (const folder of folders) {
        const id = typeof folder.id === "string" ? folder.id : "";
        const parent = typeof folder.parent === "string" ? folder.parent : "";
        if (!id || !parent) continue;
        const siblings = children.get(parent) ?? [];
        siblings.push(id);
        children.set(parent, siblings);
    }

    const folderIds = new Set<string>([rootFolderId]);
    const stack = [rootFolderId];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const child of children.get(current) ?? []) {
            if (folderIds.has(child)) continue;
            folderIds.add(child);
            stack.push(child);
        }
    }

    const documentIds = new Set<string>();
    for (const document of documents) {
        const id = typeof document.id === "string" ? document.id : "";
        const folder = typeof document.folder === "string" ? document.folder : "";
        if (id && folder && folderIds.has(folder)) documentIds.add(id);
    }
    return [...documentIds];
}

async function cleanupVersionRepos(documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    await Promise.allSettled(documentIds.map((id) => removeDocumentVersions(id)));
}

async function forwardAdmin(req: Request, path: string): Promise<Response> {
    try {
        const auth = await requireBrowserAdmin(req);
        const body = req.method === "GET" || req.method === "HEAD"
            ? undefined
            : await req.arrayBuffer();
        return forwardRaw(req, path, body, { token: auth.token });
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }
}

// Trash routes use the user token, not an admin check. Ordinary users manage
// their own trash; PocketBase's ownership checks still run upstream. Permanent
// deletes also remove the per-note git repositories after PB succeeds.
async function forwardUserTrash(req: Request, action: string): Promise<Response> {
    if (!TRASH_ACTIONS.has(action)) return jsonError(404, "Not found.");
    try {
        const auth = requireBrowserAuth(req);
        const body = await req.arrayBuffer();
        const permanentDocument = action === "permanent-delete-document";
        const permanentFolder = action === "permanent-delete-folder";
        const parsed = permanentDocument || permanentFolder ? parseTrashBody(body) : {};

        let folderDocumentIds: string[] = [];
        if (permanentFolder) {
            const folderId = bodyId(parsed, "trashFolderId");
            if (folderId) {
                try {
                    folderDocumentIds = await collectTrashFolderDocumentIds(auth, folderId);
                } catch (error) {
                    log.warn("Could not collect version repositories for a deleted folder", error);
                }
            }
        }

        const response = await forwardRaw(req, `/api/trash/${action}`, body, { token: auth.token });

        if (response.ok) {
            try {
                if (permanentDocument) {
                    const documentId = bodyId(parsed, "trashDocumentId");
                    if (documentId) await cleanupVersionRepos([documentId]);
                } else if (permanentFolder) {
                    await cleanupVersionRepos(folderDocumentIds);
                }
            } catch (error) {
                // The document/folder is already gone. A storage cleanup failure
                // must not turn a successful delete into an error response.
                log.error("Failed to clean up version repositories", error);
            }
        }

        return response;
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }
}

export const browserExtraRoutes = new Elysia({ name: "nana-browser-extras" })
    // ── Public share reads ────────────────────────────────────────────
    .get("/api/v1/public/documents/:token", ({ request, params }) =>
        forwardToPocketBase(request, `/api/public/documents/${encodeURIComponent(params.token)}`), {
        detail: { hide: true },
    })
    .get("/api/v1/public/documents/:token/files/:filename", ({ request, params }) =>
        forwardToPocketBase(
            request,
            `/api/public/documents/${encodeURIComponent(params.token)}/files/${encodeURIComponent(params.filename)}`,
            { timeoutMs: 5 * 60_000 },
        ), { detail: { hide: true } })
    .get("/api/v1/public/folders/:token", ({ request, params }) =>
        forwardToPocketBase(request, `/api/public/folders/${encodeURIComponent(params.token)}`), {
        detail: { hide: true },
    })
    .get("/api/v1/public/folders/:token/files/:documentId/:filename", ({ request, params }) =>
        forwardToPocketBase(
            request,
            `/api/public/folders/${encodeURIComponent(params.token)}/files/${encodeURIComponent(params.documentId)}/${encodeURIComponent(params.filename)}`,
            { timeoutMs: 5 * 60_000 },
        ), { detail: { hide: true } })
    .get("/api/v1/public/boards/:token", ({ request, params }) =>
        forwardToPocketBase(request, `/api/public/boards/${encodeURIComponent(params.token)}`), {
        detail: { hide: true },
    })

    // ── Trash ─────────────────────────────────────────────────────────
    .post("/api/v1/trash/:action", ({ request, params }) =>
        forwardUserTrash(request, params.action), {
        parse: "none",
        detail: { hide: true },
    })

    // ── Admin ─────────────────────────────────────────────────────────
    .patch("/api/v1/admin/users/:id", ({ request, params }) =>
        forwardAdmin(request, `/api/admin/users/${encodeURIComponent(params.id)}`), {
        parse: "none",
        detail: { hide: true },
    })
    .post("/api/v1/admin/users/:id/request-email-change", ({ request, params }) =>
        forwardAdmin(request, `/api/admin/users/${encodeURIComponent(params.id)}/request-email-change`), {
        parse: "none",
        detail: { hide: true },
    })
    .get("/api/v1/admin/smtp", ({ request }) =>
        forwardAdmin(request, "/api/admin/smtp"), { detail: { hide: true } })
    .patch("/api/v1/admin/smtp", ({ request }) =>
        forwardAdmin(request, "/api/admin/smtp"), {
        parse: "none",
        detail: { hide: true },
    })
    .post("/api/v1/admin/smtp/test", ({ request }) =>
        forwardAdmin(request, "/api/admin/smtp/test"), {
        parse: "none",
        detail: { hide: true },
    })
    .post("/api/v1/admin/smtp/send-password", ({ request }) =>
        forwardAdmin(request, "/api/admin/smtp/send-password"), {
        parse: "none",
        detail: { hide: true },
    })
    .get("/api/v1/admin/attachments", ({ request }) =>
        forwardAdmin(request, "/api/admin/attachments"), { detail: { hide: true } })
    .patch("/api/v1/admin/attachments", ({ request }) =>
        forwardAdmin(request, "/api/admin/attachments"), {
        parse: "none",
        detail: { hide: true },
    })
    .get("/api/v1/admin/oauth/providers", ({ request }) =>
        forwardAdmin(request, "/api/admin/oauth/providers"), { detail: { hide: true } })
    .patch("/api/v1/admin/oauth/providers", ({ request }) =>
        forwardAdmin(request, "/api/admin/oauth/providers"), {
        parse: "none",
        detail: { hide: true },
    })
    .patch("/api/v1/admin/app-url", ({ request }) =>
        forwardAdmin(request, "/api/admin/app-url"), {
        parse: "none",
        detail: { hide: true },
    });
