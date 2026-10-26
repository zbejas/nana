import { stripMarkdown } from "../../lib/tasks/text";
import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { badRequest, conflict, notFound } from "./errors";
import { loadVisibleNoteReference } from "./notes";
import { getBoard } from "./boards";
import {
    assertRecordId,
    assertWritable,
    clampPaging,
    normalizeStringArray,
    unwrap,
} from "./shared";
import {
    isTaskPriority,
    isTaskStatus,
    type ListResult,
    type Surface,
    type TaskDto,
    type TaskPriority,
    type TaskStatus,
} from "./types";

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
    board?: string;
    created?: string;
    updated?: string;
}

export interface ListTasksParams {
    status?: TaskStatus;
    page?: number;
    perPage?: number;
}

export interface CreateTaskInput {
    boardId: string;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority | "";
    dueDate?: string;
    boardOrder?: number;
    labels?: string[];
    noteId?: string | null;
}

export interface UpdateTaskInput {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority | "";
    dueDate?: string;
    boardOrder?: number;
    labels?: string[];
    noteId?: string | null;
    boardId?: string;
}

export interface MoveTaskInput {
    boardId?: string;
    status?: TaskStatus;
    boardOrder?: number;
}

const TASK_FIELDS = [
    "id",
    "title",
    "description",
    "status",
    "priority",
    "due_date",
    "board_order",
    "labels",
    "document",
    "board",
    "created",
    "updated",
].join(",");

function toTaskDto(record: PBTaskRecord): TaskDto {
    return {
        id: record.id,
        title: (record.title || "Untitled task").trim() || "Untitled task",
        description: record.description || "",
        status: isTaskStatus(record.status) ? record.status : "backlog",
        priority: isTaskPriority(record.priority) ? record.priority : "",
        dueDate: record.due_date || null,
        boardOrder: typeof record.board_order === "number" ? record.board_order : 0,
        labels: normalizeStringArray(record.labels),
        noteId: record.document || null,
        boardId: record.board || "",
        created: record.created || "",
        updated: record.updated || "",
    };
}

async function loadTaskRecord(context: ToolContext, id: string): Promise<PBTaskRecord> {
    const taskId = assertRecordId(id, "That task id is not valid.");
    const path = `/api/collections/tasks/records/${encodeURIComponent(taskId)}${queryString({
        fields: TASK_FIELDS,
    })}`;
    const record = unwrap(await pbRequest<PBTaskRecord>(path, context));
    if (typeof record.id !== "string") throw notFound();
    return record;
}

async function activeBoard(context: ToolContext, surface: Surface, boardId: string) {
    const board = await getBoard(context, surface, boardId);
    if (board.archived) throw conflict("That board is archived.");
    return board;
}

function normalizeBoardOrder(value: number | undefined, fallback = 0): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw badRequest("That board order is not valid.");
    }
    return value;
}

function normalizeOptionalId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/** List one board column or the whole board, ordered for the UI. */
export async function listTasks(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
    params: ListTasksParams = {},
): Promise<ListResult<TaskDto>> {
    await getBoard(context, surface, boardId);

    if (params.status !== undefined && !isTaskStatus(params.status)) {
        throw badRequest("That task status is not valid.");
    }

    const { page, perPage } = clampPaging(params.page, params.perPage, 50, 50);
    const conditions = [
        `board="${escapeFilterString(assertRecordId(boardId, "That board id is not valid."))}"`,
    ];
    if (params.status) conditions.push(`status="${params.status}"`);

    const path = `/api/collections/tasks/records${queryString({
        filter: conditions.join(" && "),
        sort: "board_order,created",
        page,
        perPage,
        fields: TASK_FIELDS,
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBTaskRecord>>(path, context));
    const items = (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string")
        .map(toTaskDto);

    return {
        items,
        page: typeof result.page === "number" ? result.page : page,
        perPage: typeof result.perPage === "number" ? result.perPage : perPage,
        totalItems: typeof result.totalItems === "number" ? result.totalItems : items.length,
        totalPages: typeof result.totalPages === "number" ? result.totalPages : 1,
    };
}

export async function getTask(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<TaskDto> {
    const task = await loadTaskRecord(context, id);
    if (!task.board) throw notFound();
    await getBoard(context, surface, task.board);
    return toTaskDto(task);
}

export async function createTask(
    context: ToolContext,
    surface: Surface = "user",
    input: CreateTaskInput,
): Promise<TaskDto> {
    assertWritable(context);
    await activeBoard(context, surface, input.boardId);

    const status = input.status ?? "backlog";
    if (!isTaskStatus(status)) throw badRequest("That task status is not valid.");
    const priority = input.priority ?? "";
    if (priority !== "" && !isTaskPriority(priority)) {
        throw badRequest("That task priority is not valid.");
    }
    const boardOrder = normalizeBoardOrder(input.boardOrder);

    const noteId = normalizeOptionalId(input.noteId);
    if (noteId) await loadVisibleNoteReference(context, surface, noteId, "id,author,is_private,folder");

    const body: Record<string, unknown> = {
        title: (input.title || "").trim() || "Untitled task",
        description: input.description ?? "",
        status,
        priority,
        due_date: input.dueDate ?? "",
        board_order: boardOrder,
        labels: normalizeStringArray(input.labels),
        board: input.boardId,
    };
    if (noteId) body.document = noteId;

    const path = "/api/collections/tasks/records";
    const record = unwrap(await pbRequest<PBTaskRecord>(path, context, { method: "POST", body }));
    return toTaskDto(record);
}

export async function updateTask(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    patch: UpdateTaskInput,
): Promise<TaskDto> {
    assertWritable(context);
    const current = await loadTaskRecord(context, id);

    let targetBoardId = current.board;
    if (patch.boardId !== undefined) {
        const candidate = typeof patch.boardId === "string" ? patch.boardId.trim() : "";
        if (!candidate) throw badRequest("A board id is required.");
        targetBoardId = assertRecordId(candidate, "That board id is not valid.");
    }
    if (!targetBoardId) throw notFound();
    await activeBoard(context, surface, targetBoardId);

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.title !== undefined) {
        body.title = (patch.title || "").trim() || "Untitled task";
        changed = true;
    }
    if (patch.description !== undefined) {
        body.description = patch.description;
        changed = true;
    }
    if (patch.status !== undefined) {
        if (!isTaskStatus(patch.status)) throw badRequest("That task status is not valid.");
        body.status = patch.status;
        changed = true;
    }
    if (patch.priority !== undefined) {
        if (patch.priority !== "" && !isTaskPriority(patch.priority)) {
            throw badRequest("That task priority is not valid.");
        }
        body.priority = patch.priority;
        changed = true;
    }
    if (patch.dueDate !== undefined) {
        body.due_date = patch.dueDate || "";
        changed = true;
    }
    if (patch.boardOrder !== undefined) {
        body.board_order = normalizeBoardOrder(patch.boardOrder);
        changed = true;
    }
    if (patch.labels !== undefined) {
        body.labels = normalizeStringArray(patch.labels);
        changed = true;
    }
    if (patch.noteId !== undefined) {
        const noteId = normalizeOptionalId(patch.noteId);
        if (noteId) {
            await loadVisibleNoteReference(context, surface, noteId, "id,author,is_private,folder");
            body.document = noteId;
        } else {
            body.document = "";
        }
        changed = true;
    }
    if (patch.boardId !== undefined) {
        body.board = targetBoardId;
        changed = true;
    }

    if (!changed) return toTaskDto(current);

    const path = `/api/collections/tasks/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBTaskRecord>(path, context, { method: "PATCH", body }));
    return toTaskDto(record);
}

/** Move a task to another column/board, optionally changing its order. */
export async function moveTask(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    target: MoveTaskInput,
): Promise<TaskDto> {
    return updateTask(context, surface, id, target);
}

/** Permanently delete a task. Tasks have no trash flow. */
export async function deleteTask(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<void> {
    assertWritable(context);
    const task = await loadTaskRecord(context, id);
    if (task.board) await getBoard(context, surface, task.board);

    const path = `/api/collections/tasks/records/${encodeURIComponent(task.id)}`;
    unwrap(await pbRequest<Record<string, never>>(path, context, { method: "DELETE" }));
}

/**
 * Copy an owned note into a board as a task: plain-text excerpt, up to six
 * labels, and the note relation. The note itself is never modified.
 */
export async function addNoteToBoard(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
    noteId: string,
    status: TaskStatus = "backlog",
): Promise<TaskDto> {
    assertWritable(context);
    await activeBoard(context, surface, boardId);
    if (!isTaskStatus(status)) throw badRequest("That task status is not valid.");

    const note = await loadVisibleNoteReference(context, surface, noteId);
    const title = (note.title || "Untitled note").trim() || "Untitled note";
    const description = stripMarkdown(note.content ?? "").slice(0, 4000);
    const labels = normalizeStringArray(note.tags, 6);

    return createTask(context, surface, {
        boardId,
        title,
        description,
        status,
        labels,
        noteId: note.id,
    });
}
