import { pbFetchWithToken } from "./pocketbase";
import { getSuperuserToken } from "./superuser";
import { ApiError, notFound, upstream } from "../workspace/errors";
import { resolveSharingAccess, type SharingRole } from "../workspace/sharing";
import type { ToolContext } from "../pocketbase/client";
import type { NoteChatStatus, PBConversation, PBListResponse } from "./types";

interface PBNoteChatDocument {
    id?: string;
    title?: string;
    author?: string;
    is_private?: boolean;
    deleted_at?: string;
}

interface LoadedNoteChatDocument extends PBNoteChatDocument {
    id: string;
    author: string;
}

interface NoteChatInspection {
    status: NoteChatStatus;
    /** Note owner id; needed when the server creates the group conversation. */
    authorId: string;
}

/** Disabled shared-note chat with a stable machine-readable reason. */
export class NoteChatError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "NoteChatError";
        this.status = status;
        this.code = code;
    }
}

function isValidId(value: string): boolean {
    return /^[A-Za-z0-9]{1,64}$/.test(value);
}

function safeNoteTitle(value: unknown): string {
    const text = typeof value === "string" ? value : "";
    const cleaned = text
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return (cleaned || "Untitled note").slice(0, 200);
}

function toConversation(record: PBConversation, canManage: boolean): PBConversation {
    return {
        id: record.id,
        title: record.title,
        author: record.author,
        scope: record.scope === "note" ? "note" : "personal",
        ...(typeof record.document === "string" && record.document
            ? { document: record.document }
            : {}),
        can_manage: canManage,
        created: record.created,
        updated: record.updated,
    };
}

async function superuserRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const token = await getSuperuserToken();
    return pbFetchWithToken<T>(path, token, options);
}

async function loadDocument(noteId: string): Promise<LoadedNoteChatDocument> {
    let record: PBNoteChatDocument;
    try {
        record = await superuserRequest<PBNoteChatDocument>(
            `/api/collections/documents/records/${encodeURIComponent(noteId)}?fields=id,title,author,is_private,deleted_at`,
        );
    } catch (error) {
        if (error instanceof Error && "status" in error) {
            const status = Number((error as { status?: unknown }).status);
            if (status === 404 || status === 403) throw notFound("That note was not found.");
        }
        throw upstream("The note chat is unavailable right now.");
    }
    if (!record || typeof record.id !== "string" || typeof record.author !== "string") {
        throw notFound("That note was not found.");
    }
    return record as LoadedNoteChatDocument;
}

async function hasOtherPersonGrants(documentId: string, ownerId: string): Promise<boolean> {
    const filter = encodeURIComponent(`document="${documentId}" && user!="${ownerId}"`);
    const result = await superuserRequest<PBListResponse<{ id: string }>>(
        `/api/collections/access_grants/records?filter=${filter}&perPage=1&fields=id`,
    );
    return Array.isArray(result.items) && result.items.length > 0;
}

async function findNoteConversation(documentId: string): Promise<PBConversation | null> {
    const filter = encodeURIComponent(`document="${documentId}" && scope="note"`);
    const result = await superuserRequest<PBListResponse<PBConversation>>(
        `/api/collections/conversations/records?filter=${filter}&perPage=1&sort=-created`,
    );
    const record = Array.isArray(result.items) ? result.items[0] : undefined;
    return record && typeof record.id === "string" ? record : null;
}

function disabledReason(
    reason: NoteChatStatus["reason"],
): { status: number; code: string; message: string } {
    if (reason === "not_shared") {
        return {
            status: 409,
            code: "note_not_shared",
            message: "Share this note with someone before starting its shared chat.",
        };
    }
    if (reason === "private") {
        return {
            status: 409,
            code: "note_private",
            message: "A private note does not have a shared chat.",
        };
    }
    if (reason === "trashed") {
        return {
            status: 409,
            code: "note_trashed",
            message: "A note in trash does not have a shared chat.",
        };
    }
    if (reason === "unavailable") {
        return {
            status: 503,
            code: "note_unavailable",
            message: "The shared note chat is unavailable right now.",
        };
    }
    return {
        status: 409,
        code: "note_chat_disabled",
        message: "This note does not have a shared chat.",
    };
}

/**
 * Resolve the caller's shared-note chat status.
 *
 * The document is loaded with the superuser credential so the owner can still
 * see an existing history for a private or trashed note. Everyone else must
 * pass the caller-token `/api/sharing/access` lookup; missing access is always
 * a 404, and public-link flags are ignored.
 */
async function inspectNoteChat(
    context: ToolContext,
    noteId: string,
): Promise<NoteChatInspection> {
    const id = noteId.trim();
    if (!isValidId(id)) {
        throw new ApiError(400, "invalid_input", "That note id is not valid.");
    }

    const document = await loadDocument(id);
    const owner = document.author === context.userId;

    let accessLevel = 0;
    let accessRole: SharingRole = "view";

    if (owner) {
        accessLevel = 3;
        accessRole = "owner";
    } else {
        const access = await resolveSharingAccess(context, "document", id);
        if (!access || access.level < 1) throw notFound("That note was not found.");
        accessLevel = access.level;
        accessRole = access.role;
    }

    const trashed = typeof document.deleted_at === "string" && document.deleted_at !== "";
    const isPrivate = document.is_private === true;
    let reason: NoteChatStatus["reason"] = trashed ? "trashed" : isPrivate ? "private" : null;

    let shared = !owner;
    let conversation: PBConversation | null = null;

    try {
        conversation = await findNoteConversation(id);
    } catch {
        if (reason === null) reason = "unavailable";
    }

    if (owner) {
        try {
            shared = await hasOtherPersonGrants(id, document.author);
        } catch {
            if (reason === null) reason = "unavailable";
        }
        if (reason === null && !shared) reason = "not_shared";
    }

    const enabled = reason === null && accessLevel >= 1;
    const canManage = owner;
    const status: NoteChatStatus = {
        noteId: id,
        noteTitle: safeNoteTitle(document.title),
        enabled,
        reason,
        shared,
        accessRole,
        accessLevel,
        canEdit: enabled && accessLevel >= 3,
        canManage,
        conversation: conversation ? toConversation(conversation, canManage) : null,
    };

    return { status, authorId: document.author };
}

/** GET /api/chat/notes/:id/chat — status and existing history. */
export async function getNoteChatStatus(
    context: ToolContext,
    noteId: string,
): Promise<NoteChatStatus> {
    const inspection = await inspectNoteChat(context, noteId);
    return inspection.status;
}

/**
 * POST /api/chat/notes/:id/chat — return the one group conversation for a note,
 * creating it with the server credential when the caller may participate.
 */
export async function ensureNoteConversation(
    context: ToolContext,
    noteId: string,
): Promise<{ status: NoteChatStatus; conversation: PBConversation }> {
    const inspection = await inspectNoteChat(context, noteId);
    const { status, authorId } = inspection;

    if (!status.enabled) {
        const disabled = disabledReason(status.reason);
        throw new NoteChatError(disabled.status, disabled.code, disabled.message);
    }

    if (status.conversation) {
        return { status, conversation: status.conversation };
    }

    try {
        const created = await superuserRequest<PBConversation>(
            "/api/collections/conversations/records",
            {
                method: "POST",
                body: JSON.stringify({
                    title: status.noteTitle,
                    author: authorId,
                    scope: "note",
                    document: status.noteId,
                }),
            },
        );
        const conversation = toConversation(created, status.canManage);
        return { status: { ...status, conversation }, conversation };
    } catch {
        // A concurrent open may have won the unique-index race. Re-fetch before
        // reporting a failure so both callers end on the same conversation.
        let existing: PBConversation | null = null;
        try {
            existing = await findNoteConversation(status.noteId);
        } catch {
            existing = null;
        }
        if (existing) {
            const conversation = toConversation(existing, status.canManage);
            return { status: { ...status, conversation }, conversation };
        }
        throw upstream("The shared note chat could not be started.");
    }
}
