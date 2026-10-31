import { tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { createLogger } from "../../../lib/logger";
import {
    listNotes,
    listNotesInputSchema,
    readNote,
    readNoteInputSchema,
    type ListNotesInput,
    type ReadNoteInput,
    type ReadNoteResult,
} from "./notes";
import {
    listBoards,
    listBoardsInputSchema,
    readBoard,
    readBoardInputSchema,
    type ListBoardsInput,
    type ReadBoardInput,
    type ReadBoardResult,
} from "./boards";
import {
    listFoldersForChat,
    listFoldersInputSchema,
} from "./folders";
import {
    listBoardTasks,
    listTasksInputSchema,
    readTask,
    readTaskInputSchema,
    type ListTasksInput,
    type ListTasksResult,
    type ReadTaskInput,
    type ReadTaskResult,
} from "./tasks";
import {
    appendNoteInputSchema,
    appendNoteTool,
    createBoardInputSchema,
    createBoardTool,
    createFolderInputSchema,
    createFolderTool,
    createNoteInputSchema,
    createNoteTool,
    createTaskInputSchema,
    createTaskTool,
    deleteBoardInputSchema,
    deleteBoardTool,
    deleteFolderInputSchema,
    deleteFolderTool,
    deleteNoteInputSchema,
    deleteNoteTool,
    deleteTaskInputSchema,
    deleteTaskTool,
    editNoteInputSchema,
    editNoteTool,
    moveBoardInputSchema,
    moveBoardTool,
    moveFolderInputSchema,
    moveFolderTool,
    moveNoteInputSchema,
    moveNoteTool,
    moveTaskInputSchema,
    moveTaskTool,
    renameFolderInputSchema,
    renameFolderTool,
    updateBoardInputSchema,
    updateBoardTool,
    updateNoteInputSchema,
    updateNoteTool,
    updateTaskInputSchema,
    updateTaskTool,
    type AppendNoteInput,
    type CreateBoardInput,
    type CreateFolderInput,
    type CreateNoteInput,
    type CreateTaskInput,
    type DeleteBoardInput,
    type DeleteFolderInput,
    type DeleteNoteInput,
    type DeleteTaskInput,
    type EditNoteInput,
    type MoveBoardInput,
    type MoveFolderInput,
    type MoveNoteInput,
    type MoveTaskInput,
    type RenameFolderInput,
    type UpdateBoardInput,
    type UpdateNoteInput,
    type UpdateTaskInput,
} from "./writes";
import { ChatRunRecorder } from "./recorder";
import type { ToolContext } from "./http";
import type { ChatMode } from "../types";

const log = createLogger("ChatTools");

export {
    CHAT_READ_TOOL_NAMES,
    CHAT_WRITE_TOOL_NAMES,
    CHAT_TOOL_NAMES,
} from "../tool-names";

export interface ChatToolOptions {
    mode?: ChatMode;
    recorder?: ChatRunRecorder;
    conversationId?: string;
}

function resultCount(result: unknown): number {
    if (!result || typeof result !== "object") return 0;
    const value = result as Record<string, unknown>;
    if (Array.isArray(value.notes)) return value.notes.length;
    if (Array.isArray(value.boards)) return value.boards.length;
    if (Array.isArray(value.tasks)) return value.tasks.length;
    if (typeof value.content === "string") return 1;
    return 0;
}

/**
 * Wrap an executor so only the tool name, duration and result count are
 * logged. Inputs, outputs, auth headers and note/task text never reach logs.
 */
function instrument<TInput, TOutput>(
    name: string,
    execute: (input: TInput, abortSignal?: AbortSignal) => Promise<TOutput>,
    after?: (result: TOutput) => void,
): (input: TInput, options: ToolExecutionOptions) => Promise<TOutput | { ok: false; code: "unavailable"; message: string }> {
    return async (input: TInput, options: ToolExecutionOptions) => {
        const startedAt = Date.now();
        let result: TOutput | { ok: false; code: "unavailable"; message: string };

        try {
            result = await execute(input, options.abortSignal);
            if (after) after(result as TOutput);
        } catch {
            result = {
                ok: false,
                code: "unavailable",
                message: "The workspace is unavailable right now.",
            };
        }

        log.debug("Tool finished", {
            tool: name,
            durationMs: Date.now() - startedAt,
            count: resultCount(result),
        });

        return result;
    };
}

function isOk(value: unknown): value is { ok: true } {
    return Boolean(value) && typeof value === "object" && (value as { ok?: unknown }).ok === true;
}

/**
 * Build the workspace tools for one authenticated user.
 *
 * Ask mode registers reads only. Work (edit) mode adds the folder, note, board,
 * and task write tools; the private lock and author scoping still run inside
 * every executor.
 */
export function createChatTools(context: ToolContext, options: ChatToolOptions = {}): ToolSet {
    const recorder = options.recorder ?? new ChatRunRecorder();
    const mode = options.mode ?? "ask";
    const readTools: ToolSet = {
        list_notes: tool({
            description:
                "List note metadata owned by the signed-in user (id, title, tags, dates, folder). " +
                "Search is limited to titles and tags and never searches note bodies. " +
                "Call this before read_note, then read only the notes you need.",
            inputSchema: listNotesInputSchema,
            execute: instrument<ListNotesInput, Awaited<ReturnType<typeof listNotes>>>(
                "list_notes",
                (input, signal) => listNotes(context, input, signal),
            ),
        }),

        read_note: tool({
            description:
                "Read a bounded Markdown line window from one note id returned by list_notes. " +
                "Use offset/nextOffset to page through long notes. Never guess note ids. " +
                "The result includes `revision` and `versionToken`; pass either back as expectedRevision when editing.",
            inputSchema: readNoteInputSchema,
            execute: instrument<ReadNoteInput, Awaited<ReturnType<typeof readNote>>>(
                "read_note",
                (input, signal) => readNote(context, input, signal),
                (result) => {
                    if (!isOk(result)) return;
                    const note = result as ReadNoteResult;
                    recorder.addSource({ type: "document", id: note.id, title: note.title });
                },
            ),
        }),

        list_folders: tool({
            description:
                "List every folder visible to the signed-in user with id, name, parent id, and public/private flags. " +
                "Use this before moving a note, board, or folder so you pass a real folder id.",
            inputSchema: listFoldersInputSchema,
            execute: instrument<{}, Awaited<ReturnType<typeof listFoldersForChat>>>(
                "list_folders",
                () => listFoldersForChat(context),
            ),
        }),
        list_boards: tool({
            description:
                "List the signed-in user's active boards with open/done/total task counts and " +
                "per-column counts. Trashed boards are excluded unless includeArchived is true. " +
                "Call this before read_board.",
            inputSchema: listBoardsInputSchema,
            execute: instrument<ListBoardsInput, Awaited<ReturnType<typeof listBoards>>>(
                "list_boards",
                (input, signal) => listBoards(context, input, signal),
            ),
        }),

        read_board: tool({
            description:
                "Read one board's tasks, optionally limited to a single column. " +
                "Returns paged task summaries and a short plain-text description excerpt. " +
                "Use only board ids returned by list_boards.",
            inputSchema: readBoardInputSchema,
            execute: instrument<ReadBoardInput, Awaited<ReturnType<typeof readBoard>>>(
                "read_board",
                (input, signal) => readBoard(context, input, signal),
                (result) => {
                    if (!isOk(result)) return;
                    const board = (result as ReadBoardResult).board;
                    recorder.addSource({ type: "board", id: board.id, title: board.name });
                },
            ),
        }),

        list_tasks: tool({
            description:
                "List one board's tasks, optionally filtered to a column. " +
                "Use list_boards/read_board first; this is a compact task list for a known board id.",
            inputSchema: listTasksInputSchema,
            execute: instrument<ListTasksInput, Awaited<ReturnType<typeof listBoardTasks>>>(
                "list_tasks",
                (input) => listBoardTasks(context, input),
                (result) => {
                    if (!isOk(result)) return;
                    const board = (result as ListTasksResult).board;
                    recorder.addSource({ type: "board", id: board.id, title: board.name });
                },
            ),
        }),

        read_task: tool({
            description:
                "Read one task with its description and board name. Use ids from read_board or list_tasks.",
            inputSchema: readTaskInputSchema,
            execute: instrument<ReadTaskInput, Awaited<ReturnType<typeof readTask>>>(
                "read_task",
                (input) => readTask(context, input),
                (result) => {
                    if (!isOk(result)) return;
                    const board = (result as ReadTaskResult).board;
                    recorder.addSource({ type: "board", id: board.id, title: board.name });
                },
            ),
        }),
    };

    if (mode !== "edit") return readTools;

    const write = { context, recorder, conversationId: options.conversationId };
    const writeTools: ToolSet = {
        create_folder: tool({
            description:
                "Create a folder owned by the signed-in user. A parent must be a visible folder. " +
                "Use only when the user asked for a new folder.",
            inputSchema: createFolderInputSchema,
            execute: instrument<CreateFolderInput, Awaited<ReturnType<typeof createFolderTool>>>(
                "create_folder",
                (input) => createFolderTool(write, input),
            ),
        }),
        rename_folder: tool({
            description:
                "Rename a visible folder owned by the signed-in user. Use it when the user asks to rename a folder.",
            inputSchema: renameFolderInputSchema,
            execute: instrument<RenameFolderInput, Awaited<ReturnType<typeof renameFolderTool>>>(
                "rename_folder",
                (input) => renameFolderTool(write, input),
            ),
        }),
        move_folder: tool({
            description:
                "Move a visible folder under another visible folder, or to the workspace root with parentId null. " +
                "Use it to reorganize folders. A folder cannot move inside itself.",
            inputSchema: moveFolderInputSchema,
            execute: instrument<MoveFolderInput, Awaited<ReturnType<typeof moveFolderTool>>>(
                "move_folder",
                (input) => moveFolderTool(write, input),
            ),
        }),
        create_note: tool({
            description:
                "Create a note owned by the signed-in user. Use the optional folder id for a visible folder. " +
                "Use only when the user asked you to write. Never create a note in a private folder.",
            inputSchema: createNoteInputSchema,
            execute: instrument<CreateNoteInput, Awaited<ReturnType<typeof createNoteTool>>>(
                "create_note",
                (input) => createNoteTool(write, input),
            ),
        }),
        append_note: tool({
            description:
                "Append Markdown to the end of an existing note. Requires the revision or versionToken from read_note. " +
                "The whole edit is rejected if the note changed since it was read.",
            inputSchema: appendNoteInputSchema,
            execute: instrument<AppendNoteInput, Awaited<ReturnType<typeof appendNoteTool>>>(
                "append_note",
                (input) => appendNoteTool(write, input),
            ),
        }),
        edit_note: tool({
            description:
                "Edit a note by section. Read the note first, then pass the current revision (or versionToken) and one or more " +
                "section operations. A missing or ambiguous heading aborts the whole edit; re-read and retry. " +
                "Untouched sections are preserved. Do not replace whole documents.",
            inputSchema: editNoteInputSchema,
            execute: instrument<EditNoteInput, Awaited<ReturnType<typeof editNoteTool>>>(
                "edit_note",
                (input) => editNoteTool(write, input),
            ),
        }),
        update_note: tool({
            description:
                "Rename a note or change its tags. Use edit_note for body content. Requires the current revision or versionToken.",
            inputSchema: updateNoteInputSchema,
            execute: instrument<UpdateNoteInput, Awaited<ReturnType<typeof updateNoteTool>>>(
                "update_note",
                (input) => updateNoteTool(write, input),
            ),
        }),
        move_note: tool({
            description:
                "Move a visible note into a visible folder, or to the workspace root with folderId null. " +
                "Use it to organize notes; it does not edit title, tags, or body.",
            inputSchema: moveNoteInputSchema,
            execute: instrument<MoveNoteInput, Awaited<ReturnType<typeof moveNoteTool>>>(
                "move_note",
                (input) => moveNoteTool(write, input),
            ),
        }),
        create_board: tool({
            description:
                "Create an empty board with the default workflow columns. Use only when the user asked for a new board.",
            inputSchema: createBoardInputSchema,
            execute: instrument<CreateBoardInput, Awaited<ReturnType<typeof createBoardTool>>>(
                "create_board",
                (input) => createBoardTool(write, input),
            ),
        }),
        update_board: tool({
            description:
                "Rename a visible board or update its description. " +
                "Use only when the user asked to change the board itself.",
            inputSchema: updateBoardInputSchema,
            execute: instrument<UpdateBoardInput, Awaited<ReturnType<typeof updateBoardTool>>>(
                "update_board",
                (input) => updateBoardTool(write, input),
            ),
        }),
        move_board: tool({
            description:
                "Move a visible board into a visible folder, or to the workspace root with folderId null. " +
                "Use it to organize boards; it does not change the board's name or description.",
            inputSchema: moveBoardInputSchema,
            execute: instrument<MoveBoardInput, Awaited<ReturnType<typeof moveBoardTool>>>(
                "move_board",
                (input) => moveBoardTool(write, input),
            ),
        }),
        create_task: tool({
            description:
                "Create a task on an existing board. Status must be a column slug on that board, `planned`, or `archived`. " +
                "The board must not be in trash.",
            inputSchema: createTaskInputSchema,
            execute: instrument<CreateTaskInput, Awaited<ReturnType<typeof createTaskTool>>>(
                "create_task",
                (input) => createTaskTool(write, input),
            ),
        }),
        update_task: tool({
            description:
                "Update a task's title, description, status, priority, due date, or assignee. " +
                "Only assign someone who can already access the board.",
            inputSchema: updateTaskInputSchema,
            execute: instrument<UpdateTaskInput, Awaited<ReturnType<typeof updateTaskTool>>>(
                "update_task",
                (input) => updateTaskTool(write, input),
            ),
        }),
        move_task: tool({
            description:
                "Move a task to another column on the same board. Use a column slug, `planned`, or `archived`.",
            inputSchema: moveTaskInputSchema,
            execute: instrument<MoveTaskInput, Awaited<ReturnType<typeof moveTaskTool>>>(
                "move_task",
                (input) => moveTaskTool(write, input),
            ),
        }),
        delete_note: tool({
            description:
                "Request deletion of a visible note by moving it to trash. This only creates a confirmation card; " +
                "the note is not deleted until the user confirms. Never say it was deleted before confirmation.",
            inputSchema: deleteNoteInputSchema,
            execute: instrument<DeleteNoteInput, Awaited<ReturnType<typeof deleteNoteTool>>>(
                "delete_note",
                (input) => deleteNoteTool(write, input),
            ),
        }),
        delete_task: tool({
            description:
                "Request permanent deletion of a visible task. This only creates a confirmation card; " +
                "the task is not deleted until the user confirms. Never say it was deleted before confirmation.",
            inputSchema: deleteTaskInputSchema,
            execute: instrument<DeleteTaskInput, Awaited<ReturnType<typeof deleteTaskTool>>>(
                "delete_task",
                (input) => deleteTaskTool(write, input),
            ),
        }),
        delete_folder: tool({
            description:
                "Request moving a visible folder subtree to trash. Boards inside are rehomed to the root by the " +
                "workspace. This only creates a confirmation card; never say it was deleted before confirmation.",
            inputSchema: deleteFolderInputSchema,
            execute: instrument<DeleteFolderInput, Awaited<ReturnType<typeof deleteFolderTool>>>(
                "delete_folder",
                (input) => deleteFolderTool(write, input),
            ),
        }),
        delete_board: tool({
            description:
                "Request moving a visible board to trash. This only creates a confirmation card; " +
                "the board is not moved until the user confirms. You can restore it later from Trash.",
            inputSchema: deleteBoardInputSchema,
            execute: instrument<DeleteBoardInput, Awaited<ReturnType<typeof deleteBoardTool>>>(
                "delete_board",
                (input) => deleteBoardTool(write, input),
            ),
        }),
    };

    return { ...readTools, ...writeTools };
}

export type ChatTools = ReturnType<typeof createChatTools>;
export type { ChatRunRecorder } from "./recorder";
