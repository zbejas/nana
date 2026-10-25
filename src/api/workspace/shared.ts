import { isValidRecordId } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type ToolContext,
    type ToolFailure,
    type ToolResult,
} from "../pocketbase/client";
import { ApiError, badRequest, notFound, unauthorized, upstream } from "./errors";
import {
    folderIsLocked,
    loadAiVisibility,
    type AiVisibility,
} from "./privacy";
import type { Surface } from "./types";

interface PBFolderReference {
    id: string;
    author?: string;
    parent?: string;
    is_private?: boolean;
}

/**
 * Convert the shared client's model-safe failure into a public API error.
 * Messages are placeholders chosen by the client, never upstream bodies.
 */
export function apiErrorFromToolFailure(failure: ToolFailure): ApiError {
    switch (failure.code) {
        case "unauthorized":
            return unauthorized(failure.message);
        case "not_found":
            return notFound(failure.message);
        case "invalid_input":
            return badRequest(failure.message);
        default:
            return upstream(failure.message);
    }
}

/** Unwrap a successful ToolResult or throw the matching ApiError. */
export function unwrap<T extends object>(result: ToolResult<T>): T {
    if (!result.ok) throw apiErrorFromToolFailure(result);
    const { ok: _ok, ...value } = result;
    return value as T;
}

/** AI surfaces get the computed hidden subtree; user surfaces see everything. */
export async function visibilityFor(
    context: ToolContext,
    surface: Surface,
    signal?: AbortSignal,
): Promise<AiVisibility> {
    if (surface !== "ai") return { hiddenFolderIds: new Set<string>() };
    return unwrap(await loadAiVisibility(context, signal));
}

export function assertRecordId(value: unknown, message = "That id is not valid."): string {
    if (!isValidRecordId(value)) throw badRequest(message);
    return value;
}

/** Empty or null clears a relation; otherwise return the trimmed id. */
export function normalizeFolderId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/**
 * Validate a folder relation for create/update. The folder must belong to the
 * caller; AI surfaces additionally refuse hidden folders as not found.
 */
export async function assertFolderVisible(
    context: ToolContext,
    surface: Surface,
    folderId: string,
    visibility: AiVisibility,
): Promise<PBFolderReference> {
    const id = assertRecordId(folderId, "That folder id is not valid.");
    if (surface === "ai" && folderIsLocked(visibility, id)) throw notFound();

    const path = `/api/collections/folders/records/${encodeURIComponent(id)}${queryString({
        fields: "id,parent,is_private,author",
    })}`;
    const folder = unwrap(await pbRequest<PBFolderReference>(path, context));
    if (folder.author !== context.userId) throw notFound();
    return folder;
}

export function clampPaging(
    page: number | undefined,
    perPage: number | undefined,
    maxPerPage = 50,
    defaultPerPage = 20,
): { page: number; perPage: number } {
    const safePage = typeof page === "number" && Number.isFinite(page) && page >= 1
        ? Math.min(Math.trunc(page), 1_000_000)
        : 1;
    const requestedPerPage = typeof perPage === "number" && Number.isFinite(perPage)
        ? Math.trunc(perPage)
        : defaultPerPage;
    const safePerPage = Math.min(Math.max(requestedPerPage, 1), maxPerPage);
    return { page: safePage, perPage: safePerPage };
}

/** Trim, drop empties, deduplicate, and bound a JSON string list. */
export function normalizeStringArray(value: unknown, maxItems = 20, maxChars = 60): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim().slice(0, maxChars);
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
        if (result.length >= maxItems) break;
    }
    return result;
}
