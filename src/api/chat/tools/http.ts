import { serverConfig } from "../../../lib/config";

export interface ToolContext {
    /** The caller's raw Authorization header. Never the superuser token. */
    authHeader: string;
    /** The authenticated user's PocketBase record id. */
    userId: string;
}

export type ToolErrorCode = "unauthorized" | "not_found" | "invalid_input" | "unavailable";

export interface ToolFailure {
    ok: false;
    code: ToolErrorCode;
    message: string;
}

export type ToolResult<T> = ({ ok: true } & T) | ToolFailure;

export interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

function failure(code: ToolErrorCode, message: string): ToolFailure {
    return { ok: false, code, message };
}

function mapStatus(status: number): ToolFailure {
    if (status === 401) {
        return failure("unauthorized", "Your session expired. Sign in again and retry.");
    }
    if (status === 403 || status === 404) {
        // PocketBase deliberately hides records the caller cannot view. Use the
        // same generic answer so tool results do not reveal other users' IDs.
        return failure("not_found", "That item was not found.");
    }
    if (status === 400 || status === 422) {
        return failure("invalid_input", "That lookup was not valid.");
    }
    if (status === 429) {
        return failure("unavailable", "The workspace is busy. Try again in a moment.");
    }
    return failure("unavailable", "The workspace is unavailable right now.");
}

/**
 * Fetch a PocketBase REST path with the user's own token.
 *
 * Only status codes are translated into model-safe failures; response bodies
 * are never echoed to the model and are not logged here.
 */
export async function pbGet<T extends object>(
    path: string,
    context: ToolContext,
    signal: AbortSignal,
): Promise<ToolResult<T>> {
    if (!context.authHeader) {
        return failure("unauthorized", "Sign in to use workspace tools.");
    }

    let response: Response;
    try {
        response = await fetch(`${POCKETBASE_URL}${path}`, {
            method: "GET",
            headers: {
                Authorization: context.authHeader,
                Accept: "application/json",
            },
            signal,
        });
    } catch {
        if (signal.aborted) {
            return failure("unavailable", "The workspace took too long to respond.");
        }
        return failure("unavailable", "The workspace is unavailable right now.");
    }

    if (!response.ok) {
        return mapStatus(response.status);
    }

    try {
        const data = (await response.json()) as T;
        return { ok: true, ...data };
    } catch {
        return failure("unavailable", "The workspace returned an unreadable response.");
    }
}

/** Build a query string from already-safe values. */
export function queryString(params: Record<string, string | number | boolean | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        search.set(key, String(value));
    }
    const encoded = search.toString();
    return encoded ? `?${encoded}` : "";
}
