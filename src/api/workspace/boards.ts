import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { ApiError, badRequest, conflict, notFound } from "./errors";
import { aiVisibilityConditions, boardIsLocked } from "./privacy";
import {
    assertFolderVisible,
    assertRecordId,
    clampPaging,
    normalizeFolderId,
    unwrap,
    visibilityFor,
} from "./shared";
import type { BoardDto, ListResult, Surface } from "./types";

interface PBBoardRecord {
    id: string;
    name?: string;
    description?: string;
    archived?: boolean;
    folder?: string;
    is_private?: boolean;
    author?: string;
    created?: string;
    updated?: string;
}

export interface ListBoardsParams {
    includeArchived?: boolean;
    folderId?: string;
    page?: number;
    perPage?: number;
}

export interface CreateBoardInput {
    name: string;
    description?: string;
    folderId?: string | null;
    isPrivate?: boolean;
}

export interface UpdateBoardInput {
    name?: string;
    description?: string;
    archived?: boolean;
    folderId?: string | null;
    isPrivate?: boolean;
}

function toBoardDto(record: PBBoardRecord): BoardDto {
    return {
        id: record.id,
        name: (record.name || "Untitled board").trim(),
        description: record.description || "",
        archived: record.archived === true,
        folderId: record.folder || null,
        isPrivate: record.is_private === true,
        created: record.created || "",
        updated: record.updated || "",
    };
}

async function loadBoardRecord(context: ToolContext, id: string): Promise<PBBoardRecord> {
    const boardId = assertRecordId(id, "That board id is not valid.");
    const path = `/api/collections/boards/records/${encodeURIComponent(boardId)}`;
    const record = unwrap(await pbRequest<PBBoardRecord>(path, context));
    if (typeof record.id !== "string" || record.author !== context.userId) throw notFound();
    return record;
}

async function loadVisibleBoard(
    context: ToolContext,
    surface: Surface,
    id: string,
): Promise<PBBoardRecord> {
    const record = await loadBoardRecord(context, id);
    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        if (boardIsLocked(visibility, record)) throw notFound();
    }
    return record;
}

/** List the caller's boards, newest updated first. */
export async function listBoards(
    context: ToolContext,
    surface: Surface = "user",
    params: ListBoardsParams = {},
): Promise<ListResult<BoardDto>> {
    const { page, perPage } = clampPaging(params.page, params.perPage, 50);
    const conditions = [`author="${escapeFilterString(context.userId)}"`];
    if (params.includeArchived !== true) conditions.push("archived=false");

    const folderId = normalizeFolderId(params.folderId);
    if (folderId) {
        conditions.push(`folder="${escapeFilterString(assertRecordId(folderId, "That folder id is not valid."))}"`);
    }

    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        conditions.push(...aiVisibilityConditions(visibility));
    }

    const path = `/api/collections/boards/records${queryString({
        filter: conditions.join(" && "),
        sort: "-updated",
        page,
        perPage,
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBBoardRecord>>(path, context));
    const items = (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string")
        .map(toBoardDto);

    return {
        items,
        page: typeof result.page === "number" ? result.page : page,
        perPage: typeof result.perPage === "number" ? result.perPage : perPage,
        totalItems: typeof result.totalItems === "number" ? result.totalItems : items.length,
        totalPages: typeof result.totalPages === "number" ? result.totalPages : 1,
    };
}

export async function getBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<BoardDto> {
    return toBoardDto(await loadVisibleBoard(context, surface, id));
}

export async function createBoard(
    context: ToolContext,
    surface: Surface = "user",
    input: CreateBoardInput,
): Promise<BoardDto> {
    const name = (input.name || "").trim();
    if (!name) throw badRequest("A board name is required.");

    const folderId = normalizeFolderId(input.folderId);
    if (folderId) {
        const visibility = await visibilityFor(context, surface);
        await assertFolderVisible(context, surface, folderId, visibility);
    }

    const body: Record<string, unknown> = {
        name,
        description: input.description ?? "",
        archived: false,
        author: context.userId,
        is_private: input.isPrivate === true,
    };
    if (folderId) body.folder = folderId;

    const path = "/api/collections/boards/records";
    const record = unwrap(await pbRequest<PBBoardRecord>(path, context, { method: "POST", body }));
    return toBoardDto(record);
}

export async function updateBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    patch: UpdateBoardInput,
): Promise<BoardDto> {
    const current = await loadBoardRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (surface === "ai" && boardIsLocked(visibility, current)) throw notFound();

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.name !== undefined) {
        const name = (patch.name || "").trim();
        if (!name) throw badRequest("A board name is required.");
        body.name = name;
        changed = true;
    }
    if (patch.description !== undefined) {
        body.description = patch.description;
        changed = true;
    }
    if (patch.archived !== undefined) {
        body.archived = patch.archived === true;
        changed = true;
    }
    if (patch.isPrivate !== undefined) {
        body.is_private = patch.isPrivate === true;
        if (patch.isPrivate === true) {
            // Public and private are mutually exclusive. Clear the token so a
            // privacy change cannot leave a stale public link behind.
            body.is_public = false;
            body.public_share_token = "";
            body.public_expires_at = "";
        }
        changed = true;
    }
    if (patch.folderId !== undefined) {
        const folderId = normalizeFolderId(patch.folderId);
        if (folderId) {
            await assertFolderVisible(context, surface, folderId, visibility);
            body.folder = folderId;
        } else {
            body.folder = "";
        }
        changed = true;
    }

    if (!changed) return toBoardDto(current);

    const path = `/api/collections/boards/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBBoardRecord>(path, context, { method: "PATCH", body }));
    return toBoardDto(record);
}

/** Move a board to a folder, or to the root with an empty/null folder id. */
export async function moveBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    folderId: string | null,
): Promise<BoardDto> {
    return updateBoard(context, surface, id, { folderId });
}

/**
 * Permanently delete an archived board. PocketBase cascades its tasks and its
 * delete rule rejects an active board; both outcomes stay safe here.
 */
export async function deleteBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<void> {
    const current = await loadVisibleBoard(context, surface, id);
    if (current.archived !== true) throw conflict("Archive the board before deleting it.");

    const path = `/api/collections/boards/records/${encodeURIComponent(current.id)}`;
    try {
        unwrap(await pbRequest<Record<string, never>>(path, context, { method: "DELETE" }));
    } catch (error) {
        if (error instanceof ApiError) {
            if (error.status === 400) throw conflict("Archive the board before deleting it.");
            if (error.status === 404 || error.status === 403) throw notFound();
        }
        throw error;
    }
}
