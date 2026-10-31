import { z } from "zod";
import { aiVisibilityConditions, boardIsLocked, loadAiVisibility } from "../../workspace/privacy";
import { isVirtualTaskStatus } from "../../workspace/types";
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

export const listBoardsInputSchema = z.object({
    includeArchived: z.boolean().default(false).describe("Include trashed boards. Default false (active boards only)."),
    page: pageSchema.describe("1-based page, default 1."),
    perPage: perPageSchema.describe("Boards per page, default 20, maximum 50."),
});

export type ListBoardsInput = z.input<typeof listBoardsInputSchema>;

export const readBoardInputSchema = z.object({
    boardId: z.string().min(1).max(64).describe("The board id from a list_boards result."),
    column: z
        .string()
        .min(1)
        .max(60)
        .optional()
        .describe("Optional column slug, or `planned`/`archived`."),
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
    icon?: string;
    is_private?: boolean;
    author?: string;
    created?: string;
    updated?: string;
}

interface PBColumnRecord {
    id: string;
    board?: string;
    name?: string;
    slug?: string;
    position?: number;
    icon?: string;
    color?: string;
    is_final?: boolean;
}

interface PBTaskAssignee {
    id: string;
    name?: string;
}

interface PBTaskRecord {
    id: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    due_date?: string;
    start_date?: string;
    completed_at?: string;
    board_order?: number;
    labels?: unknown;
    document?: string;
    note?: string;
    board?: string;
    assignee?: string;
    task_number?: number;
    created?: string;
    updated?: string;
    expand?: {
        assignee?: PBTaskAssignee;
    };
}

export interface BoardColumnSummary {
    slug: string;
    name: string;
    position: number;
    icon: string;
    color: string;
    isFinal: boolean;
    count: number;
}

interface TaskCounts {
    open: number;
    done: number;
    total: number;
    planned: number;
    archived: number;
    columns: Record<string, number>;
}

export interface BoardSummary {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    icon: string;
    columns: BoardColumnSummary[];
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
    startDate: string | null;
    completedAt: string | null;
    taskNumber: number | null;
    assignee: { id: string; name: string } | null;
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
        icon: string;
        columns: Omit<BoardColumnSummary, "count">[];
        taskCounts: TaskCounts;
    };
    column: string | null;
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

function boardSummary(record: PBBoardRecord): Omit<BoardSummary, "columns" | "taskCounts"> {
    return {
        id: record.id,
        name: truncate((record.name || "Untitled board").trim(), 120),
        description: truncate((record.description || "").trim(), 500),
        archived: Boolean(record.archived),
        icon: record.icon || "",
    };
}

function taskSummary(record: PBTaskRecord): BoardTaskSummary {
    const assignee = record.expand?.assignee;
    return {
        id: record.id,
        title: truncate((record.title || "Untitled task").trim(), 240),
        status: typeof record.status === "string" && record.status ? record.status : "planned",
        priority: typeof record.priority === "string" && record.priority ? record.priority : null,
        dueDate: typeof record.due_date === "string" && record.due_date ? record.due_date : null,
        startDate: typeof record.start_date === "string" && record.start_date ? record.start_date : null,
        completedAt: typeof record.completed_at === "string" && record.completed_at ? record.completed_at : null,
        taskNumber: typeof record.task_number === "number" && record.task_number > 0
            ? record.task_number
            : null,
        assignee: record.assignee
            ? {
                id: record.assignee,
                name: assignee?.name ? truncate(assignee.name, 80) : "Member",
            }
            : null,
        labels: normalizeStringList(record.labels),
        boardOrder: typeof record.board_order === "number" ? record.board_order : 0,
        noteId: record.document || record.note || null,
        descriptionExcerpt: plainTextExcerpt(record.description || "", 400),
        created: record.created || "",
        updated: record.updated || "",
    };
}

function toColumnSummary(record: PBColumnRecord): Omit<BoardColumnSummary, "count"> {
    return {
        slug: record.slug || "",
        name: truncate((record.name || record.slug || "").trim(), 80),
        position: typeof record.position === "number" ? record.position : 0,
        icon: record.icon || "",
        color: record.color || "",
        isFinal: record.is_final === true,
    };
}

/** Load columns for every board in one query. */
async function loadColumns(
    context: ToolContext,
    boardIds: string[],
    signal: AbortSignal,
): Promise<{ ok: true; columns: Map<string, PBColumnRecord[]> } | ToolFailure> {
    const columns = new Map<string, PBColumnRecord[]>();
    if (boardIds.length === 0) return { ok: true, columns };

    const filter = boardIds
        .map((id) => `board="${escapeFilterString(id)}"`)
        .join(" || ");
    const path = `/api/collections/board_columns/records${queryString({
        filter,
        sort: "position,created",
        page: 1,
        perPage: 500,
        fields: "id,board,name,slug,position,icon,color,is_final",
    })}`;

    const result = await pbGet<PBListResponse<PBColumnRecord>>(path, context, signal);
    if (!result.ok) return result;

    for (const column of result.items ?? []) {
        if (!column || typeof column.id !== "string" || !column.board) continue;
        const entry = columns.get(column.board) ?? [];
        entry.push(column);
        columns.set(column.board, entry);
    }

    for (const entry of columns.values()) {
        entry.sort((a, b) =>
            (a.position ?? 0) - (b.position ?? 0)
            || String(a.name || "").localeCompare(String(b.name || "")),
        );
    }

    return { ok: true, columns };
}

/**
 * Count every task status for the visible boards. One paginated task query is
 * cheaper than a count request per column and still bounded by the boards page.
 */
async function loadTaskCounts(
    context: ToolContext,
    boardIds: string[],
    signal: AbortSignal,
): Promise<{ ok: true; counts: Map<string, Record<string, number>> } | ToolFailure> {
    const counts = new Map<string, Record<string, number>>();
    if (boardIds.length === 0) return { ok: true, counts };

    const filter = boardIds
        .map((id) => `board="${escapeFilterString(id)}"`)
        .join(" || ");

    for (let page = 1; page <= 20; page += 1) {
        const path = `/api/collections/tasks/records${queryString({
            filter,
            page,
            perPage: 500,
            fields: "board,status",
        })}`;
        const result = await pbGet<PBListResponse<{ board?: string; status?: string }>>(path, context, signal);
        if (!result.ok) return result;

        for (const task of result.items ?? []) {
            if (!task?.board) continue;
            const entry = counts.get(task.board) ?? {};
            const status = task.status || "planned";
            entry[status] = (entry[status] ?? 0) + 1;
            counts.set(task.board, entry);
        }

        const totalPages = typeof result.totalPages === "number" ? result.totalPages : 1;
        if (page >= totalPages) break;
    }

    return { ok: true, counts };
}

function buildColumnSummaries(
    columns: PBColumnRecord[],
    statusCounts: Record<string, number>,
): { columns: BoardColumnSummary[]; taskCounts: TaskCounts } {
    const summaries = columns.map((column) => {
        const summary = toColumnSummary(column);
        return { ...summary, count: statusCounts[summary.slug] ?? 0 };
    });

    const columnsBySlug: Record<string, number> = {};
    for (const summary of summaries) {
        columnsBySlug[summary.slug] = summary.count;
    }

    const total = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
    const done = summaries
        .filter((summary) => summary.isFinal)
        .reduce((sum, summary) => sum + summary.count, 0);

    return {
        columns: summaries,
        taskCounts: {
            open: total - done,
            done,
            total,
            planned: statusCounts.planned ?? 0,
            archived: statusCounts.archived ?? 0,
            columns: columnsBySlug,
        },
    };
}

// ── list_boards ──────────────────────────────────────────────────────

/**
 * List the caller's boards with their workflow columns and per-column counts.
 * Trashed boards are excluded unless explicitly requested.
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
    const boardIds = boards.map((board) => board.id);

    const [columnResult, countResult] = await Promise.all([
        loadColumns(context, boardIds, signal),
        loadTaskCounts(context, boardIds, signal),
    ]);
    if (!columnResult.ok) return columnResult;
    if (!countResult.ok) return countResult;

    const resultPage = typeof result.page === "number" ? result.page : page;
    const resultPerPage = typeof result.perPage === "number" ? result.perPage : perPage;
    const totalPages = typeof result.totalPages === "number" ? result.totalPages : 1;

    return {
        ok: true,
        boards: boards.map((record) => {
            const counts = countResult.counts.get(record.id) ?? {};
            const built = buildColumnSummaries(columnResult.columns.get(record.id) ?? [], counts);
            return {
                ...boardSummary(record),
                columns: built.columns,
                taskCounts: built.taskCounts,
            };
        }),
        page: resultPage,
        perPage: resultPerPage,
        totalBoards: typeof result.totalItems === "number" ? result.totalItems : boards.length,
        totalPages,
        hasMore: resultPage < totalPages,
    };
}

// ── read_board ───────────────────────────────────────────────────────

/**
 * Read one owned, non-trashed board and a bounded page of its tasks. Tasks are
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

    const [columnResult, countResult] = await Promise.all([
        loadColumns(context, [board.id], signal),
        loadTaskCounts(context, [board.id], signal),
    ]);
    if (!columnResult.ok) return columnResult;
    if (!countResult.ok) return countResult;

    const boardColumns = columnResult.columns.get(board.id) ?? [];
    const built = buildColumnSummaries(boardColumns, countResult.counts.get(board.id) ?? {});

    if (column && !isVirtualTaskStatus(column) && !built.columns.some((item) => item.slug === column)) {
        return invalidInput(
            `That column is not on this board. Use ${built.columns.map((item) => item.slug).join(", ")}, planned, or archived.`,
        );
    }

    const conditions = [
        `board="${escapeFilterString(boardId)}"`,
    ];
    if (column) conditions.push(`status="${escapeFilterString(column)}"`);

    const sort = column ? "board_order,created" : "status,board_order,created";
    const path = `/api/collections/tasks/records${queryString({
        filter: conditions.join(" && "),
        sort,
        page,
        perPage,
        expand: "assignee",
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
        board: {
            ...boardSummary(board),
            columns: built.columns.map(({ count: _count, ...summary }) => summary),
            taskCounts: built.taskCounts,
        },
        column: column ?? null,
        tasks: tasks.map(taskSummary),
        page: resultPage,
        perPage: resultPerPage,
        totalItems: typeof tasksResult.totalItems === "number" ? tasksResult.totalItems : tasks.length,
        totalPages,
        hasMore: resultPage < totalPages,
    };
}
