import { serverConfig } from "../../lib/config";
import { AuthError } from "../auth";

export { AuthError } from "../auth";

export interface ApiAuth {
    /** The authenticated PocketBase user record id. */
    userId: string;
    /** The refreshed PocketBase user token. */
    token: string;
    /** Raw token value used in the downstream Authorization header. */
    authHeader: string;
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
 * Validate a REST caller against PocketBase `auth-refresh`.
 *
 * Accepts either a raw PocketBase token or `Bearer <token>`. The refreshed
 * token is returned for downstream calls; neither the token nor the response
 * body is logged.
 */
export async function authenticateApiRequest(req: Request): Promise<ApiAuth> {
    const token = extractToken(req.headers.get("Authorization"));
    if (!token) {
        throw new AuthError("Missing or invalid Authorization header", 401);
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
