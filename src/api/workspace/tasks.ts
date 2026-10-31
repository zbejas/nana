import { stripMarkdown } from "../../lib/tasks/text";
import { sanitizeHtml } from "../../lib/sanitize";
import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { badRequest, conflict, notFound } from "./errors";
import { loadVisibleNoteReference } from "./notes";
import { defaultColumnSlug, getBoard, listBoardColumns } from "./boards";
import {
    assertRecordId,
    assertWritable,
    clampPaging,
    normalizeStringArray,
    unwrap,
} from "./shared";
import {
    isTaskPriority,
    isTaskRelationType,
    isVirtualTaskStatus,
    RECURRENCE_FREQUENCIES,
    type ListResult,
    type Surface,
    type TaskActivityDto,
    type TaskDto,
    type TaskPriority,
    type TaskRecurrenceDto,
    type TaskRelationDto,
    type TaskRelationType,
    type TaskStatus,
} from "./types";

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
    board?: string;
    assignee?: string;
    recurrence?: unknown;
    task_number?: number;
    created?: string;
    updated?: string;
}

interface PBTaskRelationRecord {
    id: string;
    source?: string;
    target?: string;
    type?: string;
    created?: string;
    updated?: string;
    expand?: {
        source?: PBTaskRecord;
        target?: PBTaskRecord;
    };
}

interface PBTaskActivityRecord {
    id: string;
    task?: string;
    board?: string;
    actor?: string;
    type?: string;
    data?: unknown;
    created?: string;
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
    startDate?: string;
    boardOrder?: number;
    labels?: string[];
    noteId?: string | null;
    assigneeId?: string | null;
    recurrence?: TaskRecurrenceDto | null;
}

export interface UpdateTaskInput {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority | "";
    dueDate?: string;
    startDate?: string;
    boardOrder?: number;
    labels?: string[];
    noteId?: string | null;
    assigneeId?: string | null;
    recurrence?: TaskRecurrenceDto | null;
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
    "start_date",
    "completed_at",
    "board_order",
    "labels",
    "document",
    "board",
    "assignee",
    "recurrence",
    "task_number",
    "created",
    "updated",
].join(",");

function normalizeRecurrenceValue(value: unknown): TaskRecurrenceDto | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Partial<TaskRecurrenceDto>;
    if (!RECURRENCE_FREQUENCIES.includes(candidate.frequency as never)) return null;
    const interval = typeof candidate.interval === "number" && Number.isFinite(candidate.interval)
        ? Math.trunc(candidate.interval)
        : 1;
    if (interval < 1 || interval > 365) return null;

    const recurrence: TaskRecurrenceDto = {
        frequency: candidate.frequency as TaskRecurrenceDto["frequency"],
        interval,
    };
    if (Array.isArray(candidate.weekdays)) {
        const days = candidate.weekdays
            .filter((day): day is number => typeof day === "number" && Number.isInteger(day))
            .map((day) => Math.min(7, Math.max(1, day)));
        if (days.length > 0) recurrence.weekdays = Array.from(new Set(days));
    }
    if (typeof candidate.timeZone === "string" && candidate.timeZone.trim()) {
        recurrence.timeZone = candidate.timeZone.trim().slice(0, 80);
    }
    return recurrence;
}

function normalizeRecurrenceInput(value: TaskRecurrenceDto | null | undefined): TaskRecurrenceDto | null {
    if (value === undefined || value === null) return null;
    const recurrence = normalizeRecurrenceValue(value);
    if (!recurrence) throw badRequest("That recurrence is not valid.");
    return recurrence;
}

function toTaskDto(record: PBTaskRecord): TaskDto {
    return {
        id: record.id,
        title: (record.title || "Untitled task").trim() || "Untitled task",
        description: record.description || "",
        status: record.status || "planned",
        priority: isTaskPriority(record.priority) ? record.priority : "",
        dueDate: record.due_date || null,
        startDate: record.start_date || null,
        completedAt: record.completed_at || null,
        boardOrder: typeof record.board_order === "number" ? record.board_order : 0,
        labels: normalizeStringArray(record.labels),
        noteId: record.document || null,
        boardId: record.board || "",
        assigneeId: record.assignee || null,
        recurrence: normalizeRecurrenceValue(record.recurrence),
        taskNumber: typeof record.task_number === "number" && record.task_number > 0
            ? record.task_number
            : null,
        created: record.created || "",
        updated: record.updated || "",
    };
}

function toTaskRelationDto(record: PBTaskRelationRecord): TaskRelationDto {
    const source = record.expand?.source;
    const target = record.expand?.target;
    return {
        id: record.id,
        sourceTaskId: record.source || "",
        targetTaskId: record.target || "",
        type: isTaskRelationType(record.type) ? record.type : "related",
        sourceTitle: source ? (source.title || "Untitled task").trim() : null,
        targetTitle: target ? (target.title || "Untitled task").trim() : null,
        targetStatus: target?.status || null,
        created: record.created || "",
        updated: record.updated || "",
    };
}

function toTaskActivityDto(record: PBTaskActivityRecord): TaskActivityDto {
    const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
        ? record.data as Record<string, unknown>
        : {};
    return {
        id: record.id,
        taskId: record.task || "",
        boardId: record.board || "",
        actorId: record.actor || null,
        type: record.type || "updated",
        data,
        created: record.created || "",
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
    if (board.archived) throw conflict("That board is in trash.");
    return board;
}

/**
 * Validate a status against the board's workflow. `planned` and `archived` are
 * always valid virtual statuses; every other value must be a column slug.
 */
async function assertTaskStatus(
    context: ToolContext,
    surface: Surface,
    boardId: string,
    status: string,
): Promise<string> {
    const value = (status || "").trim();
    if (!value) throw badRequest("Choose a task status.");
    if (value.length > 60) throw badRequest("That task status is not valid.");
    if (isVirtualTaskStatus(value)) return value;

    const columns = await listBoardColumns(context, surface, boardId);
    if (!columns.some((column) => column.slug === value)) {
        throw badRequest("That task status is not valid on this board.");
    }
    return value;
}

async function resolveCreateStatus(
    context: ToolContext,
    surface: Surface,
    boardId: string,
    status: string | undefined,
): Promise<string> {
    if (status !== undefined) {
        return assertTaskStatus(context, surface, boardId, status);
    }
    const columns = await listBoardColumns(context, surface, boardId);
    return defaultColumnSlug(columns);
}

function normalizeOptionalId(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeBoardOrder(value: number | undefined, fallback = 0): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw badRequest("That board order is not valid.");
    }
    return value;
}

/** List one board column or the whole board, ordered for the UI. */
export async function listTasks(
    context: ToolContext,
    surface: Surface = "user",
    boardId: string,
    params: ListTasksParams = {},
): Promise<ListResult<TaskDto>> {
    await getBoard(context, surface, boardId);

    if (params.status !== undefined) {
        await assertTaskStatus(context, surface, boardId, params.status);
    }

    const { page, perPage } = clampPaging(params.page, params.perPage, 50, 50);
    const conditions = [
        `board="${escapeFilterString(assertRecordId(boardId, "That board id is not valid."))}"`,
    ];
    if (params.status) {
        conditions.push(`status="${escapeFilterString(params.status)}"`);
    }

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

    const status = await resolveCreateStatus(context, surface, input.boardId, input.status);
    const priority = input.priority ?? "";
    if (priority !== "" && !isTaskPriority(priority)) {
        throw badRequest("That task priority is not valid.");
    }
    const boardOrder = normalizeBoardOrder(input.boardOrder);

    const noteId = normalizeOptionalId(input.noteId);
    if (noteId) await loadVisibleNoteReference(context, surface, noteId, "id,author,is_private,folder");

    const assigneeId = normalizeOptionalId(input.assigneeId);
    const recurrence = normalizeRecurrenceInput(input.recurrence);

    const body: Record<string, unknown> = {
        title: (input.title || "").trim() || "Untitled task",
        description: await sanitizeHtml(input.description ?? ""),
        status,
        priority,
        due_date: input.dueDate ?? "",
        start_date: input.startDate ?? "",
        board_order: boardOrder,
        labels: normalizeStringArray(input.labels),
        board: input.boardId,
    };
    if (noteId) body.document = noteId;
    if (assigneeId) body.assignee = assigneeId;
    if (recurrence) body.recurrence = recurrence;

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

    if (patch.boardId !== undefined && targetBoardId !== current.board) {
        throw badRequest("A task cannot move to another board.");
    }

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.title !== undefined) {
        body.title = (patch.title || "").trim() || "Untitled task";
        changed = true;
    }
    if (patch.description !== undefined) {
        body.description = await sanitizeHtml(patch.description);
        changed = true;
    }
    if (patch.status !== undefined) {
        body.status = await assertTaskStatus(context, surface, targetBoardId, patch.status);
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
    if (patch.startDate !== undefined) {
        body.start_date = patch.startDate || "";
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
    if (patch.assigneeId !== undefined) {
        body.assignee = normalizeOptionalId(patch.assigneeId) ?? "";
        changed = true;
    }
    if (patch.recurrence !== undefined) {
        body.recurrence = normalizeRecurrenceInput(patch.recurrence);
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

// ── Relations ───────────────────────────────────────────────────────

const TASK_RELATION_FIELDS = "id,source,target,type,created,updated";

async function loadTaskRelationRecord(
    context: ToolContext,
    id: string,
): Promise<PBTaskRelationRecord> {
    const relationId = assertRecordId(id, "That relation id is not valid.");
    const path = `/api/collections/task_relations/records/${encodeURIComponent(relationId)}${queryString({
        fields: TASK_RELATION_FIELDS,
    })}`;
    const record = unwrap(await pbRequest<PBTaskRelationRecord>(path, context));
    if (typeof record.id !== "string") throw notFound();
    return record;
}

/** Every relation edge touching a visible task, in either direction. */
export async function listTaskRelations(
    context: ToolContext,
    surface: Surface = "user",
    taskId: string,
): Promise<TaskRelationDto[]> {
    const task = await loadTaskRecord(context, taskId);
    if (!task.board) throw notFound();
    await getBoard(context, surface, task.board);

    const path = `/api/collections/task_relations/records${queryString({
        filter: `source="${escapeFilterString(task.id)}" || target="${escapeFilterString(task.id)}"`,
        sort: "created",
        expand: "source,target",
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBTaskRelationRecord>>(path, context));
    return (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string")
        .map(toTaskRelationDto);
}

export async function createTaskRelation(
    context: ToolContext,
    surface: Surface = "user",
    input: { sourceTaskId: string; targetTaskId: string; type: TaskRelationType },
): Promise<TaskRelationDto> {
    assertWritable(context);

    const sourceId = assertRecordId(input.sourceTaskId, "That task id is not valid.");
    const targetId = assertRecordId(input.targetTaskId, "That task id is not valid.");
    if (sourceId === targetId) throw badRequest("A task cannot relate to itself.");
    if (!isTaskRelationType(input.type)) throw badRequest("That relation type is not valid.");

    const source = await loadTaskRecord(context, sourceId);
    const target = await loadTaskRecord(context, targetId);
    if (!source.board || !target.board) throw notFound();
    await getBoard(context, surface, source.board);
    await getBoard(context, surface, target.board);

    const body = { source: source.id, target: target.id, type: input.type };
    const path = "/api/collections/task_relations/records";
    const record = unwrap(await pbRequest<PBTaskRelationRecord>(path, context, { method: "POST", body }));
    return toTaskRelationDto(record);
}

export async function deleteTaskRelation(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<void> {
    assertWritable(context);
    const relation = await loadTaskRelationRecord(context, id);
    if (!relation.source) throw notFound();

    const source = await loadTaskRecord(context, relation.source);
    if (!source.board) throw notFound();
    await getBoard(context, surface, source.board);

    const path = `/api/collections/task_relations/records/${encodeURIComponent(relation.id)}`;
    unwrap(await pbRequest<Record<string, never>>(path, context, { method: "DELETE" }));
}

/** Append-only task audit, newest first. */
export async function listTaskActivity(
    context: ToolContext,
    surface: Surface = "user",
    taskId: string,
): Promise<TaskActivityDto[]> {
    const task = await loadTaskRecord(context, taskId);
    if (!task.board) throw notFound();
    await getBoard(context, surface, task.board);

    const path = `/api/collections/task_activity/records${queryString({
        filter: `task="${escapeFilterString(task.id)}"`,
        sort: "-created",
        page: 1,
        perPage: 100,
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBTaskActivityRecord>>(path, context));
    return (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string")
        .map(toTaskActivityDto);
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
    status?: TaskStatus,
): Promise<TaskDto> {
    assertWritable(context);
    await activeBoard(context, surface, boardId);
    if (status !== undefined) {
        await assertTaskStatus(context, surface, boardId, status);
    }

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
