import { Elysia } from "elysia";
import { BrowserAuthError, jsonError, requireBrowserAuth } from "./auth";
import { forwardRaw } from "./proxy";

/**
 * Session-only user-sharing proxy.
 *
 * The SPA never talks to PocketBase's /api/sharing routes directly. This is the
 * only browser-facing path: the caller's session JWT is decoded here and then
 * forwarded unchanged, so PocketBase still authorizes every request. API keys
 * are not JWTs and are rejected by requireBrowserAuth.
 *
 * Upstream bodies are never echoed on failure. The facade maps a known status
 * to a short message so an internal PocketBase error cannot leak through.
 */
function mapStatus(status: number): number {
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 429) return status;
    if (status === 422) return 400;
    if (status >= 400 && status < 500) return 400;
    return 502;
}

function messageFor(status: number): string {
    switch (status) {
        case 401:
            return "Authentication required.";
        case 403:
            return "You do not have permission to do that.";
        case 404:
            return "Not found.";
        case 429:
            return "Too many requests. Try again shortly.";
        case 502:
            return "The sharing service is unavailable right now.";
        default:
            return "Invalid sharing request.";
    }
}

async function forwardSharing(req: Request, path: string): Promise<Response> {
    try {
        const auth = requireBrowserAuth(req);
        const method = req.method.toUpperCase();
        const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
        const upstream = await forwardRaw(req, path, body, { token: auth.token });

        if (upstream.ok) return upstream;

        try {
            await upstream.body?.cancel();
        } catch {
            // Body already consumed/closed; nothing to release.
        }

        const status = mapStatus(upstream.status);
        return jsonError(status, messageFor(status));
    } catch (error) {
        if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
        throw error;
    }
}

export const browserSharingRoutes = new Elysia({ name: "nana-browser-sharing" })
    .get("/api/v1/sharing/users", ({ request }) =>
        forwardSharing(request, "/api/sharing/users"), { detail: { hide: true } })
    .get("/api/v1/sharing/shared", ({ request }) =>
        forwardSharing(request, "/api/sharing/shared"), { detail: { hide: true } })
    .get("/api/v1/sharing/access", ({ request }) =>
        forwardSharing(request, "/api/sharing/access"), { detail: { hide: true } })
    .get("/api/v1/sharing/folders/:id", ({ request, params }) =>
        forwardSharing(request, `/api/sharing/folders/${encodeURIComponent(params.id)}`), {
        detail: { hide: true },
    })
    .get("/api/v1/sharing/links", ({ request }) =>
        forwardSharing(request, "/api/sharing/links"), { detail: { hide: true } })
    .post("/api/v1/sharing/links", ({ request }) =>
        forwardSharing(request, "/api/sharing/links"), {
        parse: "none",
        detail: { hide: true },
    })
    .delete("/api/v1/sharing/links/:id", ({ request, params }) =>
        forwardSharing(request, `/api/sharing/links/${encodeURIComponent(params.id)}`), {
        parse: "none",
        detail: { hide: true },
    })
    .get("/api/v1/sharing/comments", ({ request }) =>
        forwardSharing(request, "/api/sharing/comments"), { detail: { hide: true } })
    .post("/api/v1/sharing/comments", ({ request }) =>
        forwardSharing(request, "/api/sharing/comments"), {
        parse: "none",
        detail: { hide: true },
    })
    .patch("/api/v1/sharing/comments/:id", ({ request, params }) =>
        forwardSharing(request, `/api/sharing/comments/${encodeURIComponent(params.id)}`), {
        parse: "none",
        detail: { hide: true },
    })
    .delete("/api/v1/sharing/comments/:id", ({ request, params }) =>
        forwardSharing(request, `/api/sharing/comments/${encodeURIComponent(params.id)}`), {
        parse: "none",
        detail: { hide: true },
    });
