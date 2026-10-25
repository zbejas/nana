import { Elysia } from "elysia";
import { BrowserAuthError, jsonError, requireBrowserAdmin, requireBrowserAuth } from "./auth";
import { forwardRaw, forwardToPocketBase } from "./proxy";

const TRASH_ACTIONS = new Set([
    "move-document",
    "restore-document",
    "permanent-delete-document",
    "move-folder",
    "restore-folder",
    "permanent-delete-folder",
]);

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
// their own trash; PocketBase's ownership checks still run upstream.
async function forwardUserTrash(req: Request, action: string): Promise<Response> {
    if (!TRASH_ACTIONS.has(action)) return jsonError(404, "Not found.");
    try {
        const auth = requireBrowserAuth(req);
        const body = await req.arrayBuffer();
        return forwardRaw(req, `/api/trash/${action}`, body, { token: auth.token });
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
