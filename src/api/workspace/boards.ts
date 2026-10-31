import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { badRequest, notFound } from "./errors";
import { recordIsLocked, workspaceVisibilityConditions } from "./privacy";
import {
    assertFolderVisible,
    assertRecordId,
    assertWritable,
    clampPaging,
    normalizeFolderId,
    unwrap,
    visibilityFor,
} from "./shared";
import type { BoardColumnDto, BoardDto, ListResult, Surface } from "./types";

interface PBBoardRecord {
    id: string;
    name?: string;
    description?: string;
    archived?: boolean;
    folder?: string;
    icon?: string;
    task_counter?: number;
    is_private?: boolean;
    author?: string;
    created?: string;
    updated?: string;
}

interface PBBoardColumnRecord {
    id: string;
    board?: string;
    name?: string;
    slug?: string;
    position?: number;
    icon?: string;
    color?: string;
    is_final?: boolean;
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
    icon?: string;
    isPrivate?: boolean;
}

export interface UpdateBoardInput {
    name?: string;
    description?: string;
    archived?: boolean;
    folderId?: string | null;
    icon?: string;
    isPrivate?: boolean;
}

export interface CreateBoardColumnInput {
    name: string;
    slug?: string;
    position?: number;
    icon?: string;
    color?: string;
    isFinal?: boolean;
}

export interface UpdateBoardColumnInput {
    name?: string;
    slug?: string;
    position?: number;
    icon?: string;
    color?: string;
    isFinal?: boolean;
}

const COLUMN_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/;

function toBoardDto(record: PBBoardRecord): BoardDto {
    return {
        id: record.id,
        name: (record.name || "Untitled board").trim(),
        description: record.description || "",
        archived: record.archived === true,
        folderId: record.folder || null,
        icon: record.icon || "",
        isPrivate: record.is_private === true,
        taskCounter: typeof record.task_counter === "number" ? record.task_counter : 0,
        created: record.created || "",
        updated: record.updated || "",
    };
}

function toBoardColumnDto(record: PBBoardColumnRecord): BoardColumnDto {
    return {
        id: record.id,
        boardId: record.board || "",
        name: (record.name || "").trim(),
        slug: record.slug || "",
        position: typeof record.position === "number" ? record.position : 0,
        icon: record.icon || "",
        color: record.color || "",
        isFinal: record.is_final === true,
        created: record.created || "",
        updated: record.updated || "",
    };
}

function slugifyColumnName(name: string): string {
    return (name || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "column";
}

function normalizeColumnSlug(value: string | undefined, name: string): string {
    const slug = value === undefined ? slugifyColumnName(name) : value.trim().toLowerCase();
    if (!COLUMN_SLUG_PATTERN.test(slug)) {
        throw badRequest("A column key may contain lowercase letters, numbers, hyphens, and underscores.");
    }
    if (slug === "planned" || slug === "archived") {
        throw badRequest("That column key is reserved for the virtual backlog.");
    }
    return slug;
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
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, record)) throw notFound();
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

    const visibility = await visibilityFor(context, surface);
    conditions.push(...workspaceVisibilityConditions(visibility, surface));

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
    assertWritable(context);

    const name = (input.name || "").trim();
    if (!name) throw badRequest("A board name is required.");

    const folderId = normalizeFolderId(input.folderId);
    const visibility = await visibilityFor(context, surface);
    if (folderId) {
        await assertFolderVisible(context, surface, folderId, visibility);
    } else if (!visibility.rootAllowed) {
        throw notFound();
    }

    const body: Record<string, unknown> = {
        name,
        description: input.description ?? "",
        archived: false,
        author: context.userId,
        icon: (input.icon ?? "").slice(0, 40),
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
    assertWritable(context);

    const current = await loadBoardRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

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
    if (patch.icon !== undefined) {
        body.icon = patch.icon.slice(0, 40);
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
            if (!visibility.rootAllowed) throw notFound();
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
 * Move a board to trash. The record keeps its id, columns, and tasks; the
 * trash flag hides it from active lists and task writes.
 */
export async function deleteBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<void> {
    assertWritable(context);

    const current = await loadVisibleBoard(context, surface, id);
    unwrap(await pbRequest<{ boardId?: string }>(
        "/api/trash/move-board",
        context,
        { method: "POST", body: { boardId: current.id } },
    ));
}

/** Restore a trashed board and its tasks. */
export async function restoreBoard(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<BoardDto> {
    assertWritable(context);

    const current = await loadBoardRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

    unwrap(await pbRequest<{ boardId?: string }>(
        "/api/trash/restore-board",
        context,
        { method: "POST", body: { trashBoardId: current.id } },
    ));
    return toBoardDto(await loadBoardRecord(context, id));
}

// ── Workflow columns ────────────────────────────────────────────────

const BOARD_COLUMN_FIELDS =
    "id,board,name,slug,position,icon,color,is_final,created,updated";

async function loadBoardColumnRecord(
    context: ToolContext,
    id: string,
): Promise<PBBoardColumnRecord> {
    const columnId = assertRecordId(id, "That column id is not valid.");
    const path = `/api/collections/board_columns/records/${encodeURIComponent(columnId)}${queryString({
        fields: BOARD_COLUMN_FIELDS,
    })}`;
    const record = unwrap(await pbRequest<PBBoardColumnRecord>(path, context));
    if (typeof record.id !== "string") throw notFound();
    return record;
}

async function queryBoardColumns(
    context: ToolContext,
    boardId: string,
): Promise<PBBoardColumnRecord[]> {
    const path = `/api/collections/board_columns/records${queryString({
        filter: `board="${escapeFilterString(boardId)}"`,
        sort: "position,created",
        fields: BOARD_COLUMN_FIELDS,
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBBoardColumnRecord>>(path, context));
    return (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string");
}

/** Ordered workflow columns for a visible board. */
export async function listBoardColumns(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
): Promise<BoardColumnDto[]> {
    await loadVisibleBoard(context, surface, boardId);
    const records = await queryBoardColumns(context, boardId);
    return records.map(toBoardColumnDto);
}

export async function createBoardColumn(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
    input: CreateBoardColumnInput,
): Promise<BoardColumnDto> {
    assertWritable(context);
    const board = await loadBoardRecord(context, boardId);
    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        if (recordIsLocked(visibility, surface, board)) throw notFound();
    }

    const name = (input.name || "").trim();
    if (!name) throw badRequest("A column name is required.");
    if (name.length > 80) throw badRequest("That column name is too long.");

    const slug = normalizeColumnSlug(input.slug, name);
    const existing = await queryBoardColumns(context, board.id);
    if (existing.some((column) => column.slug === slug)) {
        throw badRequest("A column with that key already exists.");
    }

    let position = input.position;
    if (position === undefined) {
        position = existing.reduce(
            (max, column) => Math.max(max, typeof column.position === "number" ? column.position : 0),
            -1,
        ) + 1;
    }
    if (!Number.isFinite(position) || position < 0) {
        throw badRequest("That column position is not valid.");
    }

    const body = {
        board: board.id,
        name,
        slug,
        position: Math.trunc(position),
        icon: (input.icon || "dot").slice(0, 40),
        color: (input.color || "muted").slice(0, 20),
        is_final: input.isFinal === true,
    };

    const path = "/api/collections/board_columns/records";
    const record = unwrap(await pbRequest<PBBoardColumnRecord>(path, context, { method: "POST", body }));
    return toBoardColumnDto(record);
}

export async function updateBoardColumn(
    context: ToolContext,
    surface: Surface = "user",
    columnId: string,
    patch: UpdateBoardColumnInput,
): Promise<BoardColumnDto> {
    assertWritable(context);
    const current = await loadBoardColumnRecord(context, columnId);
    if (!current.board) throw notFound();
    const board = await loadBoardRecord(context, current.board);
    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        if (recordIsLocked(visibility, surface, board)) throw notFound();
    }

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw badRequest("A column name is required.");
        if (name.length > 80) throw badRequest("That column name is too long.");
        body.name = name;
        changed = true;
    }
    if (patch.slug !== undefined) {
        body.slug = normalizeColumnSlug(patch.slug, current.name || "");
        changed = true;
    }
    if (patch.position !== undefined) {
        if (!Number.isFinite(patch.position) || patch.position < 0) {
            throw badRequest("That column position is not valid.");
        }
        body.position = Math.trunc(patch.position);
        changed = true;
    }
    if (patch.icon !== undefined) {
        body.icon = patch.icon.slice(0, 40);
        changed = true;
    }
    if (patch.color !== undefined) {
        body.color = patch.color.slice(0, 20);
        changed = true;
    }
    if (patch.isFinal !== undefined) {
        body.is_final = patch.isFinal === true;
        changed = true;
    }

    if (!changed) return toBoardColumnDto(current);

    const path = `/api/collections/board_columns/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBBoardColumnRecord>(path, context, { method: "PATCH", body }));
    return toBoardColumnDto(record);
}

/**
 * Delete a column. PocketBase refuses while tasks reference its slug and when
 * it is the board's last column.
 */
export async function deleteBoardColumn(
    context: ToolContext,
    surface: Surface = "user",
    columnId: string,
): Promise<void> {
    assertWritable(context);
    const current = await loadBoardColumnRecord(context, columnId);
    if (!current.board) throw notFound();
    const board = await loadBoardRecord(context, current.board);
    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        if (recordIsLocked(visibility, surface, board)) throw notFound();
    }

    const path = `/api/collections/board_columns/records/${encodeURIComponent(current.id)}`;
    unwrap(await pbRequest<Record<string, never>>(path, context, { method: "DELETE" }));
}

/** Persist a complete column order. Every id must belong to the board. */
export async function reorderBoardColumns(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
    orderedIds: string[],
): Promise<BoardColumnDto[]> {
    assertWritable(context);
    const board = await loadBoardRecord(context, boardId);
    if (surface === "ai") {
        const visibility = await visibilityFor(context, surface);
        if (recordIsLocked(visibility, surface, board)) throw notFound();
    }

    const current = await queryBoardColumns(context, board.id);
    const known = new Set(current.map((column) => column.id));
    const unique = new Set(orderedIds);

    if (
        orderedIds.length !== current.length
        || unique.size !== orderedIds.length
        || orderedIds.some((id) => !known.has(id))
    ) {
        throw badRequest("The column order must include every column exactly once.");
    }

    await Promise.all(orderedIds.map((id, position) =>
        pbRequest<PBBoardColumnRecord>(
            `/api/collections/board_columns/records/${encodeURIComponent(id)}`,
            context,
            { method: "PATCH", body: { position } },
        ).then((result) => unwrap(result))
    ));

    const records = await queryBoardColumns(context, board.id);
    return records.map(toBoardColumnDto);
}

/** The board's first non-final column, then the virtual planned backlog. */
export function defaultColumnSlug(columns: BoardColumnDto[]): string {
    const open = columns.find((column) => !column.isFinal);
    return open?.slug ?? "planned";
}
