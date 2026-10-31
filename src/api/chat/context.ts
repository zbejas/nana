import { pbGet, type ToolContext, type ToolFailure } from "../pocketbase/client";
import { folderIsLocked, loadAiVisibility, noteIsLocked, boardIsLocked } from "../workspace/privacy";
import { isValidRecordId, truncate } from "./tools/text";
import type { ChatContext, ChatContextInput } from "./types";

export interface ContextResolutionError {
    ok: false;
    status: number;
    code: ToolFailure["code"];
    message: string;
}

export type ContextResolution = { ok: true; context: ChatContext } | ContextResolutionError;

interface PBContextDocument {
    id?: string;
    title?: string;
    author?: string;
    is_private?: boolean;
    folder?: string;
    deleted_at?: string;
}

interface PBContextBoard {
    id?: string;
    name?: string;
    author?: string;
    is_private?: boolean;
    folder?: string;
}

interface PBContextFolder {
    id?: string;
    name?: string;
    author?: string;
    is_private?: boolean;
    parent?: string;
    deleted_at?: string;
}

function badRequest(message: string): ContextResolutionError {
    return { ok: false, status: 400, code: "invalid_input", message };
}

function notFound(): ContextResolutionError {
    return { ok: false, status: 404, code: "not_found", message: "That context was not found." };
}

function unavailable(): ContextResolutionError {
    return { ok: false, status: 503, code: "unavailable", message: "The workspace is unavailable right now." };
}

/** Titles are untrusted data; keep them single-line and bounded. */
function safeTitle(value: unknown, fallback: string): string {
    const text = typeof value === "string" ? value : "";
    const cleaned = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return truncate(cleaned || fallback, 200);
}

/**
 * Resolve a client-supplied `{ type, id }` context. The client never sends a
 * title or body: every value comes from PocketBase with the caller's token and
 * passes ownership, trash, and private-lock checks.
 */
export async function resolveChatContext(
    context: ToolContext,
    input: ChatContextInput | undefined,
    abortSignal?: AbortSignal,
): Promise<ContextResolution> {
    if (!input) return badRequest("A context type and id are required.");
    if (
        input.type !== "document"
        && input.type !== "board"
        && input.type !== "folder"
    ) {
        return badRequest("That context type is not valid.");
    }
    if (!isValidRecordId(input.id)) {
        return badRequest("That context id is not valid.");
    }

    const visibility = await loadAiVisibility(context, abortSignal);
    if (!visibility.ok) return unavailable();

    if (input.type === "document") {
        const result = await pbGet<PBContextDocument>(
            `/api/collections/documents/records/${encodeURIComponent(input.id)}?fields=id,title,author,is_private,folder,deleted_at`,
            context,
            abortSignal,
        );
        if (!result.ok) return notFound();
        const record = result;
        if (record.author !== context.userId || record.deleted_at) return notFound();
        if (noteIsLocked(visibility, record)) return notFound();
        return {
            ok: true,
            context: {
                type: "document",
                id: input.id,
                title: safeTitle(record.title, "Untitled note"),
            },
        };
    }

    if (input.type === "board") {
        const result = await pbGet<PBContextBoard>(
            `/api/collections/boards/records/${encodeURIComponent(input.id)}?fields=id,name,author,is_private,folder`,
            context,
            abortSignal,
        );
        if (!result.ok) return notFound();
        const record = result;
        if (record.author !== context.userId) return notFound();
        if (boardIsLocked(visibility, record)) return notFound();
        return {
            ok: true,
            context: {
                type: "board",
                id: input.id,
                title: safeTitle(record.name, "Untitled board"),
            },
        };
    }

    const result = await pbGet<PBContextFolder>(
        `/api/collections/folders/records/${encodeURIComponent(input.id)}?fields=id,name,author,is_private,parent,deleted_at`,
        context,
        abortSignal,
    );
    if (!result.ok) return notFound();
    const record = result;
    if (record.author !== context.userId || record.deleted_at) return notFound();
    // A private folder and every descendant are hidden from AI surfaces.
    if (record.is_private === true || folderIsLocked(visibility, input.id)) return notFound();
    return {
        ok: true,
        context: {
            type: "folder",
            id: input.id,
            title: safeTitle(record.name, "Untitled folder"),
        },
    };
}

/**
 * The system note added for the page the user is looking at. Only the id is
 * included; titles and content stay out of the prompt until a tool reads them.
 */
export function contextSystemNote(context: ChatContext): string {
    if (context.type === "document") {
        return `The user is viewing document id ${context.id}. Treat this as a hint, not as the note's content. Call read_note if the request depends on it.`;
    }
    if (context.type === "board") {
        return `The user is viewing board id ${context.id}. Treat this as a hint, not as the board's content. Call read_board if the request depends on it.`;
    }
    return `The user is viewing folder id ${context.id}. Treat this as a hint, not as the folder's contents. Call list_notes with folderId ${context.id} if you need its notes.`;
}
