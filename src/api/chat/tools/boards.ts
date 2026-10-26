import { z } from "zod";
import { aiVisibilityConditions, boardIsLocked, loadAiVisibility } from "../../workspace/privacy";
import { pbGet, queryString, type PBListResponse, type ToolContext, type ToolFailure, type ToolResult } from "./http";
import {
    createToolSignal,
    escapeFilterString,
    isValidRecordId,
    normalizeStringList,
    plainTextExcerpt,
    truncate,
} from "./text";

const pageSchema = z.number().int().min(1).max(1000).default(1);
const perPageSchema = z.number().int().min(1).max(50).default(20);

export const BOARD_STATUSES = ["backlog", "next", "progress", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const listBoardsInputSchema = z.object({
    includeArchived: z.boolean().default(false).describe("Include archived boards. Default false (active boards only)."),
    page: pageSchema.describe("1-based page, default 1."),
    perPage: perPageSchema.describe("Boards per page, default 20, maximum 50."),
});

export type ListBoardsInput = z.input<typeof listBoardsInputSchema>;

export const readBoardInputSchema = z.object({
    boardId: z.string().min(1).max(64).describe("The board id from a list_boards result."),
    column: z.enum(BOARD_STATUSES).optional().describe("Optional column to read."),
    page: pageSchema.describe("1-based page, default 1."),
    perPage: perPageSchema.describe("Tasks per page, default 20, maximum 50."),
});

export type ReadBoardInput = z.input<typeof readBoardInputSchema>;

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

interface PBTaskRecord {
    id: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    due_date?: string;
    board_order?: number;
    labels?: unknown;
    document?: string;
    note?: string;
    board?: string;
    created?: string;
    updated?: string;
}

interface TaskCounts {
    open: number;
    done: number;
    total: number;
    columns: Record<BoardStatus, number>;
}

export interface BoardSummary {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    taskCounts: TaskCounts;
}

export interface ListBoardsResult {
    boards: BoardSummary[];
    page: number;
    perPage: number;
    totalBoards: number;
    totalPages: number;
    hasMore: boolean;
}

export interface BoardTaskSummary {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    dueDate: string | null;
    labels: string[];
    boardOrder: number;
    noteId: string | null;
    descriptionExcerpt: string;
    created: string;
    updated: string;
}

export interface ReadBoardResult {
    board: {
        id: string;
        name: string;
        description: string;
        archived: boolean;
    };
    column: BoardStatus | null;
    tasks: BoardTaskSummary[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
}

function invalidInput(message: string): ToolFailure {
    return { ok: false, code: "invalid_input", message };
}

function notFound(): ToolFailure {
    return { ok: false, code: "not_found", message: "That board was not found." };
}

function boardSummary(record: PBBoardRecord): Omit<BoardSummary, "taskCounts"> {
    return {
        id: record.id,
        name: truncate((record.name || "Untitled board").trim(), 120),
        description: truncate((record.description || "").trim(), 500),
        archived: Boolean(record.archived),
    };
}

function taskSummary(record: PBTaskRecord): BoardTaskSummary {
    return {
        id: record.id,
        title: truncate((record.title || "Untitled task").trim(), 240),
        status: typeof record.status === "string" ? record.status : "backlog",
        priority: typeof record.priority === "string" && record.priority ? record.priority : null,
        dueDate: typeof record.due_date === "string" && record.due_date ? record.due_date : null,
        labels: normalizeStringList(record.labels),
        boardOrder: typeof record.board_order === "number" ? record.board_order : 0,
        noteId: record.document || record.note || null,
        descriptionExcerpt: plainTextExcerpt(record.description || "", 400),
        created: record.created || "",
        updated: record.updated || "",
    };
}

/** Run an async mapper with a small concurrency cap. */
async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor++;
            const item = items[index];
            if (item === undefined) continue;
            results[index] = await mapper(item);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

async function countTasks(
    context: ToolContext,
    boardId: string,
    status: BoardStatus,
    signal: AbortSignal,
): Promise<{ ok: true; count: number } | ToolFailure> {
    const filter = [
        `board="${escapeFilterString(boardId)}"`,
        `status="${status}"`,
    ].join(" && ");

    const path = `/api/collections/tasks/records${queryString({
        filter,
        page: 1,
        perPage: 1,
        fields: "id",
    })}`;

    const result = await pbGet<PBListResponse<{ id: string }>>(path, context, signal);
    if (!result.ok) return result;
    return { ok: true, count: typeof result.totalItems === "number" ? result.totalItems : 0 };
}

async function loadTaskCounts(
    context: ToolContext,
    boards: PBBoardRecord[],
    signal: AbortSignal,
): Promise<{ ok: true; counts: Map<string, TaskCounts> } | ToolFailure> {
    type CountRequest = { boardId: string; status: BoardStatus };
    const requests: CountRequest[] = boards.flatMap((board) =>
        BOARD_STATUSES.map((status) => ({ boardId: board.id, status })),
    );

    const results = await mapLimit(requests, 6, async (request) => {
        const count = await countTasks(context, request.boardId, request.status, signal);
        return { ...request, count };
    });

    const counts = new Map<string, TaskCounts>();
    for (const board of boards) {
        counts.set(board.id, {
            open: 0,
            done: 0,
            total: 0,
            columns: { backlog: 0, next: 0, progress: 0, done: 0 },
        });
    }

    for (const result of results) {
        if (!result.count.ok) return result.count;
        const entry = counts.get(result.boardId);
        if (!entry) continue;
        entry.columns[result.status] = result.count.count;
    }

    for (const entry of counts.values()) {
        entry.total = BOARD_STATUSES.reduce((sum, status) => sum + entry.columns[status], 0);
        entry.done = entry.columns.done;
        entry.open = entry.total - entry.done;
    }

    return { ok: true, counts };
}

// ── list_boards ──────────────────────────────────────────────────────

/**
 * List the caller's boards with per-column and open/done/total task counts.
 * Archived boards are excluded unless explicitly requested.
 */
export async function listBoards(
    context: ToolContext,
    input: ListBoardsInput | unknown,
    abortSignal?: AbortSignal,
): Promise<ToolResult<ListBoardsResult>> {
    const parsed = listBoardsInputSchema.safeParse(input);
    if (!parsed.success) {
        return invalidInput("The board list parameters were not valid.");
    }

    const { includeArchived, page, perPage } = parsed.data;
    const signal = createToolSignal(abortSignal);
    const visibility = await loadAiVisibility(context, signal);
    if (!visibility.ok) return visibility;

    const conditions = [`author="${escapeFilterString(context.userId)}"`];
    if (!includeArchived) conditions.push("archived=false");
    conditions.push(...aiVisibilityConditions(visibility));

    const path = `/api/collections/boards/records${queryString({
        filter: conditions.join(" && "),
        sort: "-updated",
        page,
        perPage,
    })}`;

    const result = await pbGet<PBListResponse<PBBoardRecord>>(path, context, signal);
    if (!result.ok) return result;

    const boards = (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string");
    const counts = await loadTaskCounts(context, boards, signal);
    if (!counts.ok) return counts;

    const resultPage = typeof result.page === "number" ? result.page : page;
    const resultPerPage = typeof result.perPage === "number" ? result.perPage : perPage;
    const totalPages = typeof result.totalPages === "number" ? result.totalPages : 1;

    return {
        ok: true,
        boards: boards.map((record) => ({
            ...boardSummary(record),
            taskCounts: counts.counts.get(record.id) ?? {
                open: 0,
                done: 0,
                total: 0,
                columns: { backlog: 0, next: 0, progress: 0, done: 0 },
            },
        })),
        page: resultPage,
        perPage: resultPerPage,
        totalBoards: typeof result.totalItems === "number" ? result.totalItems : boards.length,
        totalPages,
        hasMore: resultPage < totalPages,
    };
}

// ── read_board ───────────────────────────────────────────────────────

/**
 * Read one owned, non-archived board and a bounded page of its tasks. Tasks are
 * ordered by column then board order when reading the whole board, or by board
 * order within a single column.
 */
export async function readBoard(
    context: ToolContext,
    input: ReadBoardInput | unknown,
    abortSignal?: AbortSignal,
): Promise<ToolResult<ReadBoardResult>> {
    const parsed = readBoardInputSchema.safeParse(input);
    if (!parsed.success) {
        return invalidInput("The board read parameters were not valid.");
    }

    const { boardId, column, page, perPage } = parsed.data;
    if (!isValidRecordId(boardId)) {
        return invalidInput("That board id is not valid.");
    }

    const signal = createToolSignal(abortSignal);
    const boardResult = await pbGet<PBBoardRecord>(
        `/api/collections/boards/records/${encodeURIComponent(boardId)}`,
        context,
        signal,
    );
    if (!boardResult.ok) return boardResult;

    const board: PBBoardRecord = boardResult;
    if (!board || typeof board.id !== "string" || board.author !== context.userId || board.archived) {
        return notFound();
    }

    const visibility = await loadAiVisibility(context, signal);
    if (!visibility.ok) return visibility;
    if (boardIsLocked(visibility, board)) return notFound();

    const conditions = [
        `board="${escapeFilterString(boardId)}"`,
    ];
    if (column) conditions.push(`status="${column}"`);

    const sort = column ? "board_order,created" : "status,board_order,created";
    const path = `/api/collections/tasks/records${queryString({
        filter: conditions.join(" && "),
        sort,
        page,
        perPage,
    })}`;

    const tasksResult = await pbGet<PBListResponse<PBTaskRecord>>(path, context, signal);
    if (!tasksResult.ok) return tasksResult;

    const tasks = (Array.isArray(tasksResult.items) ? tasksResult.items : [])
        .filter((record) => record && typeof record.id === "string");
    const resultPage = typeof tasksResult.page === "number" ? tasksResult.page : page;
    const resultPerPage = typeof tasksResult.perPage === "number" ? tasksResult.perPage : perPage;
    const totalPages = typeof tasksResult.totalPages === "number" ? tasksResult.totalPages : 1;

    return {
        ok: true,
        board: boardSummary(board),
        column: column ?? null,
        tasks: tasks.map(taskSummary),
        page: resultPage,
        perPage: resultPerPage,
        totalItems: typeof tasksResult.totalItems === "number" ? tasksResult.totalItems : tasks.length,
        totalPages,
        hasMore: resultPage < totalPages,
    };
}
