import { Elysia } from "elysia";
import { serverConfig } from "../../../lib/config";
import { forwardRaw, forwardToPocketBase } from "./proxy";

export interface BrowserAuth {
    token: string;
    userId: string;
}

export class BrowserAuthError extends Error {
    constructor(
        message: string,
        readonly status = 401,
    ) {
        super(message);
        this.name = "BrowserAuthError";
    }
}

function extractToken(req: Request): string | null {
    const header = req.headers.get("authorization");
    if (!header) return null;
    const trimmed = header.trim();
    if (!trimmed) return null;
    const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
    const token = (bearer?.[1] ?? trimmed).trim();
    return token || null;
}

interface TokenPayload {
    id?: string;
    exp?: number;
    type?: string;
}

function decodePayload(token: string): TokenPayload | null {
    try {
        const part = token.split(".")[1];
        if (!part) return null;
        const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        const decoded = Buffer.from(padded, "base64").toString("utf8");
        const payload = JSON.parse(decoded) as TokenPayload;
        return payload && typeof payload === "object" ? payload : null;
    } catch {
        return null;
    }
}

/**
 * Browser authentication is deliberately cheap: decode the PocketBase JWT for
 * the caller id, then let PocketBase verify the token on the upstream call.
 * A forged token cannot write anything because every facade request is still
 * authorized by PocketBase itself.
 */
export function requireBrowserAuth(req: Request): BrowserAuth {
    const token = extractToken(req);
    if (!token) throw new BrowserAuthError("Missing or invalid authorization token", 401);

    const payload = decodePayload(token);
    if (!payload?.id || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) {
        throw new BrowserAuthError("Invalid or expired auth token", 401);
    }

    return { token, userId: payload.id };
}

export function jsonError(status: number, message: string): Response {
    return Response.json({ code: status, message, data: {} }, { status });
}

export async function getUserRecord(auth: BrowserAuth): Promise<Record<string, unknown> | null> {
    const response = await fetch(
        `${serverConfig.pocketbaseUrl}/api/collections/users/records/${encodeURIComponent(auth.userId)}`,
        {
            headers: {
                Authorization: auth.token,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(8_000),
        },
    );
    if (!response.ok) return null;
    try {
        return (await response.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export async function requireBrowserAdmin(req: Request): Promise<BrowserAuth> {
    const auth = requireBrowserAuth(req);
    const record = await getUserRecord(auth);
    if (!record) throw new BrowserAuthError("Invalid or expired auth token", 401);
    if (record.admin !== true) throw new BrowserAuthError("Admin access required", 403);
    return auth;
}

/** Copy the request body and forward it to a PocketBase auth endpoint. */
async function forwardAuth(req: Request, path: string, token?: string): Promise<Response> {
    return forwardRaw(req, path, await req.arrayBuffer(), { token });
}

const OAUTH_REDIRECT_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nana sign-in</title></head>
<body>
<p>Completing sign-in…</p>
<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var payload = {};
    params.forEach(function (value, key) { payload[key] = value; });
    if (window.opener) {
      window.opener.postMessage({ type: "nana-oauth2", query: payload }, window.location.origin);
    }
    window.close();
  })();
</script>
</body>
</html>`;

export const browserAuthRoutes = new Elysia({ name: "nana-browser-auth" })
    .get("/api/v1/check-users", ({ request }) =>
        forwardToPocketBase(request, "/api/check-users"), {
        detail: { hide: true },
    })
    .get("/api/v1/auth/methods", ({ request }) =>
        forwardToPocketBase(request, "/api/collections/users/auth-methods"), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/login", ({ request }) =>
        forwardAuth(request, "/api/collections/users/auth-with-password"), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/refresh", ({ request }) => {
        try {
            const auth = requireBrowserAuth(request);
            return forwardAuth(request, "/api/collections/users/auth-refresh", auth.token);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, { detail: { hide: true } })
    .post("/api/v1/auth/logout", () => new Response(null, { status: 204 }), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/password-reset/request", ({ request }) =>
        forwardAuth(request, "/api/collections/users/request-password-reset"), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/password-reset/confirm", ({ request }) =>
        forwardAuth(request, "/api/collections/users/confirm-password-reset"), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/email-change/request", ({ request }) => {
        try {
            const auth = requireBrowserAuth(request);
            return forwardAuth(request, "/api/collections/users/request-email-change", auth.token);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, { detail: { hide: true } })
    .post("/api/v1/auth/email-change/confirm", ({ request }) =>
        forwardAuth(request, "/api/collections/users/confirm-email-change"), {
        detail: { hide: true },
    })
    .post("/api/v1/auth/oauth2", ({ request }) =>
        forwardAuth(request, "/api/collections/users/auth-with-oauth2"), {
        detail: { hide: true },
    })
    .get("/api/v1/auth/oauth2/callback", () =>
        new Response(OAUTH_REDIRECT_HTML, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            },
        }), {
        detail: { hide: true },
    })
    .get("/api/v1/me", async ({ request }) => {
        try {
            const auth = requireBrowserAuth(request);
            return forwardToPocketBase(
                request,
                `/api/collections/users/records/${encodeURIComponent(auth.userId)}`,
                { token: auth.token },
            );
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, { detail: { hide: true } });
