import { serverConfig } from "../../lib/config";
import { isApiKeyToken, mintUserToken, resolveApiKeyToken } from "../api-keys";
import type { ApiKeyPermission } from "../api-keys/types";
import { AuthError } from "../auth";

export { AuthError } from "../auth";

export interface ApiAuth {
    /** The authenticated PocketBase user record id. */
    userId: string;
    /** The refreshed PocketBase user token. */
    token: string;
    /** Raw token value used in the downstream Authorization header. */
    authHeader: string;
    /** Present when the caller used a long-lived API key. */
    apiKey?: ApiKeyPermission;
}

function extractToken(header: string | null): string | null {
    if (!header) return null;
    const trimmed = header.trim();
    if (!trimmed) return null;

    const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
    const token = (bearer?.[1] ?? trimmed).trim();
    return token || null;
}

/**
 * Validate a REST or MCP caller.
 *
 * A `nana_…` value is a long-lived API key: it is hashed and matched against
 * the server-managed key store, then exchanged for a normal user token through
 * PocketBase impersonation. Everything else is treated as a PocketBase token
 * and refreshed against `auth-refresh`. The minted or refreshed token is used
 * only for downstream calls; neither the token nor a response body is logged.
 */
export async function authenticateApiRequest(req: Request): Promise<ApiAuth> {
    const token = extractToken(req.headers.get("Authorization"));
    if (!token) {
        throw new AuthError("Missing or invalid Authorization header", 401);
    }

    if (token.startsWith("nana_")) {
        if (!isApiKeyToken(token)) {
            throw new AuthError("Invalid API key", 401);
        }

        let resolved;
        try {
            resolved = await resolveApiKeyToken(token);
        } catch {
            throw new AuthError("Unable to verify the API key", 401);
        }
        if (!resolved) {
            throw new AuthError("Invalid API key", 401);
        }

        let userToken: string;
        try {
            userToken = await mintUserToken(resolved.userId);
        } catch {
            throw new AuthError("Unable to verify the API key", 401);
        }

        return {
            userId: resolved.userId,
            token: userToken,
            authHeader: userToken,
            apiKey: resolved.permission,
        };
    }

    let response: Response;
    try {
        response = await fetch(`${serverConfig.pocketbaseUrl}/api/collections/users/auth-refresh`, {
            method: "POST",
            headers: {
                Authorization: token,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(8_000),
        });
    } catch {
        throw new AuthError("Unable to verify the session", 401);
    }

    if (!response.ok) {
        throw new AuthError("Invalid or expired auth token", 401);
    }

    let data: { record?: { id?: string }; token?: string };
    try {
        data = (await response.json()) as { record?: { id?: string }; token?: string };
    } catch {
        throw new AuthError("Unable to verify the session", 401);
    }

    const userId = data.record?.id;
    if (!userId) {
        throw new AuthError("Could not resolve user identity", 401);
    }

    const refreshed = typeof data.token === "string" && data.token ? data.token : token;
    return {
        userId,
        token: refreshed,
        authHeader: refreshed,
    };
}
