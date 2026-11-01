import { serverConfig } from "../../lib/config";
import type { ApiKeyPermission } from "../api-keys/types";

/**
 * Shared PocketBase REST client for server-side workspace access.
 *
 * Every request carries the caller's own user token. For a long-lived API key,
 * the server mints an equivalent user token through PocketBase impersonation;
 * the superuser token itself is never accepted here. PocketBase collection
 * rules and the explicit author/scope checks in the workspace services both
 * stay in force.
 */

export interface ToolContext {
    /** The caller's raw PocketBase Authorization header value. */
    authHeader: string;
    /** The authenticated user's PocketBase record id. */
    userId: string;
    /** Present only when the caller authenticated with an API key. */
    apiKey?: ApiKeyPermission;
    /**
     * Request actor. Chat writes use `"ai"` so PocketBase hooks stamp the
     * version/activity rows as Nana instead of inventing a user record.
     */
    actor?: "ai";
}

export type ToolErrorCode =
    | "unauthorized"
    | "not_found"
    | "invalid_input"
    | "conflict"
    | "unavailable";

export interface ToolFailure {
    ok: false;
    code: ToolErrorCode;
    /** Generic, model-safe failure text. This is the only field persisted as tool activity. */
    message: string;
    /**
     * Optional bounded retry suggestions for the model. Never persisted or
     * streamed as tool activity; only `message` is.
     */
    candidates?: Array<{ line: number; text: string }>;
}

export type ToolResult<T> = ({ ok: true } & T) | ToolFailure;

export interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}

export interface PbRequestOptions {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
}

const POCKETBASE_URL = serverConfig.pocketbaseUrl;
// Workspace writes can move documents and folders through the soft-delete
// trash routes. Chat passes its own 8-second signal; REST and MCP use this
// wider default.
const DEFAULT_TIMEOUT_MS = 30_000;

function failure(code: ToolErrorCode, message: string): ToolFailure {
    return { ok: false, code, message };
}

function mapStatus(status: number): ToolFailure {
    if (status === 401) {
        return failure("unauthorized", "Your session expired. Sign in again and retry.");
    }
    if (status === 403 || status === 404) {
        // PocketBase hides records the caller cannot view. Use one generic
        // answer so results never reveal another user's record ids.
        return failure("not_found", "That item was not found.");
    }
    if (status === 400 || status === 422) {
        return failure("invalid_input", "That request was not valid.");
    }
    if (status === 409) {
        return failure("conflict", "That item changed since it was loaded.");
    }
    if (status === 429) {
        return failure("unavailable", "The workspace is busy. Try again in a moment.");
    }
    return failure("unavailable", "The workspace is unavailable right now.");
}

/**
 * Call a PocketBase REST path with the caller's token.
 *
 * Only status codes become failures. Response bodies are never echoed,
 * logged, or attached to an error.
 */
export async function pbRequest<T extends object = Record<string, never>>(
    path: string,
    context: ToolContext,
    options: PbRequestOptions = {},
): Promise<ToolResult<T>> {
    if (!context.authHeader) {
        return failure("unauthorized", "Sign in to use the workspace.");
    }

    const { method = "GET", body, signal: externalSignal } = options;
    const signal = externalSignal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = {
        Authorization: context.authHeader,
        Accept: "application/json",
    };
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }
    if (context.actor === "ai") {
        headers["X-Nana-Actor"] = "ai";
    }

    let response: Response;
    try {
        response = await fetch(`${POCKETBASE_URL}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
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

    if (response.status === 204) {
        return { ok: true } as ToolResult<T>;
    }

    let text: string;
    try {
        text = await response.text();
    } catch {
        return failure("unavailable", "The workspace returned an unreadable response.");
    }

    if (!text.trim()) {
        return { ok: true } as ToolResult<T>;
    }

    try {
        const data = JSON.parse(text) as unknown;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return failure("unavailable", "The workspace returned an unreadable response.");
        }
        return { ok: true, ...(data as T) };
    } catch {
        return failure("unavailable", "The workspace returned an unreadable response.");
    }
}

/** Convenience wrapper for read-only PocketBase requests. */
export async function pbGet<T extends object>(
    path: string,
    context: ToolContext,
    signal?: AbortSignal,
): Promise<ToolResult<T>> {
    return pbRequest<T>(path, context, { method: "GET", signal });
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
