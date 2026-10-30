import { z } from "zod";
import type { ToolContext } from "../../pocketbase/client";
import { getBoard } from "../../workspace/boards";
import { getTask, listTasks } from "../../workspace/tasks";
import type { TaskDto } from "../../workspace/types";
import { failureFromError } from "./errors";
import { isValidRecordId } from "./text";

const recordId = z.string().min(1).max(64);
const pageSchema = z.number().int().min(1).max(1000).default(1);
const perPageSchema = z.number().int().min(1).max(50).default(20);

export const listTasksInputSchema = z.object({
    boardId: recordId.describe("The board id from a list_boards or read_board result."),
    status: z.string().min(1).max(60).optional().describe("Optional column slug, or `planned`/`archived`."),
    page: pageSchema.describe("1-based page, default 1."),
    perPage: perPageSchema.describe("Tasks per page, default 20, maximum 50."),
});

export type ListTasksInput = z.input<typeof listTasksInputSchema>;

export const readTaskInputSchema = z.object({
    taskId: recordId.describe("The task id from a board or task-list result."),
});

export type ReadTaskInput = z.input<typeof readTaskInputSchema>;

export interface ChatTaskSummary {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    startDate: string | null;
    taskNumber: number | null;
    labels: string[];
    assigneeId: string | null;
    noteId: string | null;
    boardId: string;
    boardOrder: number;
    updated: string;
}

function summarizeTask(task: TaskDto): ChatTaskSummary {
    return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        startDate: task.startDate,
        taskNumber: task.taskNumber,
        labels: task.labels,
        assigneeId: task.assigneeId,
        noteId: task.noteId,
        boardId: task.boardId,
        boardOrder: task.boardOrder,
        updated: task.updated,
    };
}

export interface ListTasksResult {
    ok: true;
    board: { id: string; name: string };
    status: string | null;
    tasks: ChatTaskSummary[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
}

/** List one board's tasks through the same AI-scoped workspace service as MCP. */
export async function listBoardTasks(
    context: ToolContext,
    input: ListTasksInput | unknown,
): Promise<ListTasksResult | ReturnType<typeof failureFromError>> {
    const parsed = listTasksInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The task list parameters were not valid." };
    }

    const { boardId, status, page, perPage } = parsed.data;
    if (!isValidRecordId(boardId)) {
        return { ok: false, code: "invalid_input", message: "That board id is not valid." };
    }

    try {
        const board = await getBoard(context, "ai", boardId);
        if (board.archived) {
            return { ok: false, code: "not_found", message: "That board was not found." };
        }
        const result = await listTasks(context, "ai", board.id, { status, page, perPage });
        return {
            ok: true,
            board: { id: board.id, name: board.name },
            status: status ?? null,
            tasks: result.items.map(summarizeTask),
            page: result.page,
            perPage: result.perPage,
            totalItems: result.totalItems,
            totalPages: result.totalPages,
            hasMore: result.page < result.totalPages,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export interface ReadTaskResult {
    ok: true;
    task: ChatTaskSummary & {
        description: string;
        descriptionTruncated: boolean;
        completedAt: string | null;
        created: string;
        recurrence: TaskDto["recurrence"];
    };
    board: { id: string; name: string };
}

/** Read one task with a bounded description and its board name. */
export async function readTask(
    context: ToolContext,
    input: ReadTaskInput | unknown,
): Promise<ReadTaskResult | ReturnType<typeof failureFromError>> {
    const parsed = readTaskInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "That task id is not valid." };
    }
    if (!isValidRecordId(parsed.data.taskId)) {
        return { ok: false, code: "invalid_input", message: "That task id is not valid." };
    }

    try {
        const task = await getTask(context, "ai", parsed.data.taskId);
        const board = await getBoard(context, "ai", task.boardId);
        if (board.archived) {
            return { ok: false, code: "not_found", message: "That task was not found." };
        }
        const description = task.description;
        const descriptionTruncated = description.length > 20_000;
        return {
            ok: true,
            task: {
                ...summarizeTask(task),
                description: description.slice(0, 20_000),
                descriptionTruncated,
                completedAt: task.completedAt,
                created: task.created,
                recurrence: task.recurrence,
            },
            board: { id: board.id, name: board.name },
        };
    } catch (error) {
        return failureFromError(error);
    }
}
