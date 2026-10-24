import { tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { createLogger } from "../../../lib/logger";
import {
    listNotes,
    listNotesInputSchema,
    readNote,
    readNoteInputSchema,
    type ListNotesInput,
    type ReadNoteInput,
} from "./notes";
import {
    listBoards,
    listBoardsInputSchema,
    readBoard,
    readBoardInputSchema,
    type ListBoardsInput,
    type ReadBoardInput,
} from "./boards";
import type { ToolContext } from "./http";

const log = createLogger("ChatTools");

export const CHAT_TOOL_NAMES = ["list_notes", "read_note", "list_boards", "read_board"] as const;

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
): (input: TInput, options: ToolExecutionOptions) => Promise<TOutput | { ok: false; code: "unavailable"; message: string }> {
    return async (input: TInput, options: ToolExecutionOptions) => {
        const startedAt = Date.now();
        let result: TOutput | { ok: false; code: "unavailable"; message: string };

        try {
            result = await execute(input, options.abortSignal);
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

/**
 * Build the read-only workspace tools for one authenticated user.
 * Every request is made with that user's raw Authorization header.
 */
export function createChatTools(context: ToolContext): ToolSet {
    return {
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
                "Use offset/nextOffset to page through long notes. Never guess note ids.",
            inputSchema: readNoteInputSchema,
            execute: instrument<ReadNoteInput, Awaited<ReturnType<typeof readNote>>>(
                "read_note",
                (input, signal) => readNote(context, input, signal),
            ),
        }),

        list_boards: tool({
            description:
                "List the signed-in user's active boards with open/done/total task counts and " +
                "per-column counts. Archived boards are excluded unless includeArchived is true. " +
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
            ),
        }),
    };
}

export type ChatTools = ReturnType<typeof createChatTools>;
