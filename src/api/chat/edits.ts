import { deleteNote, restoreNoteSnapshot, type NoteSnapshot } from "../workspace/notes";
import { deleteBoard } from "../workspace/boards";
import { deleteFolder } from "../workspace/folders";
import { deleteTask } from "../workspace/tasks";
import { ApiError, conflict, notFound } from "../workspace/errors";
import type { ToolContext } from "../pocketbase/client";
import { getSuperuserToken } from "./superuser";
import { pbFetchWithToken } from "./pocketbase";
import type {
    PBConversation,
    PBListResponse,
    PBChatEdit,
    ChatEditChanges,
    ChatEditDto,
    ChatEditSection,
    ChatEditStatus,
    ChatEditTarget,
    ChatEditUndoKind,
    ChatEditTargetType,
} from "./types";

interface ChatEditOperations {
    kind?: string;
    targetTitle?: string;
    targetBoardId?: string;
    changed?: ChatEditChanges;
    operations?: unknown[];
    before?: NoteSnapshot;
    versionId?: string;
    afterRevision?: number;
    afterUpdated?: string;
    undoKind?: ChatEditUndoKind;
}

export interface RecordChatEditInput {
    conversationId: string;
    messageId?: string | null;
    tool: string;
    targetType: ChatEditTargetType;
    targetId: string;
    targetTitle: string;
    targetBoardId?: string;
    summary: string;
    changed?: ChatEditChanges;
    operations?: unknown[];
    before?: NoteSnapshot;
    versionId?: string;
    afterRevision?: number;
    afterUpdated?: string;
    undoKind?: ChatEditUndoKind;
    /** Pending actions wait for the user; all other writes are already applied. */
    status?: "pending" | "applied";
    kind?: "create" | "edit" | "delete";
}

interface PBVersionRecord {
    id: string;
    document?: string;
    version_number?: number;
    source?: string;
    snapshot?: unknown;
}

function parseJsonObject(value: unknown): ChatEditOperations {
    if (typeof value === "string") {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            return {};
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as ChatEditOperations;
}

function parseSnapshot(value: unknown): NoteSnapshot | null {
    const raw = parseJsonObject(value) as Partial<NoteSnapshot> & Record<string, unknown>;
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.content !== "string" && typeof raw.title !== "string") return null;
    return {
        title: typeof raw.title === "string" ? raw.title : "Untitled",
        content: typeof raw.content === "string" ? raw.content : "",
        tags: Array.isArray(raw.tags)
            ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20)
            : [],
        folder: typeof raw.folder === "string" ? raw.folder : "",
        isPrivate: raw.isPrivate === true || raw.is_private === true,
    };
}

function parseSections(value: unknown): ChatEditSection[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const sections: ChatEditSection[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const candidate = entry as Partial<ChatEditSection>;
        if (typeof candidate.from !== "number" || typeof candidate.to !== "number") continue;
        sections.push({
            heading: typeof candidate.heading === "string" ? candidate.heading : null,
            path: Array.isArray(candidate.path)
                ? candidate.path.filter((part): part is string => typeof part === "string").slice(0, 12)
                : [],
            op: typeof candidate.op === "string" ? candidate.op : "replace_section",
            from: candidate.from,
            to: candidate.to,
        });
        if (sections.length >= 50) break;
    }
    return sections.length > 0 ? sections : undefined;
}

function parseChanges(value: unknown): ChatEditChanges {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const candidate = value as { sections?: unknown; fields?: unknown };
    const changes: ChatEditChanges = {};
    const sections = parseSections(candidate.sections);
    if (sections) changes.sections = sections;
    if (Array.isArray(candidate.fields)) {
        const fields = candidate.fields
            .filter((field): field is string => typeof field === "string")
            .slice(0, 20);
        if (fields.length > 0) changes.fields = fields;
    }
    return changes;
}

function targetUrl(type: ChatEditTargetType, id: string, boardId?: string): string {
    if (type === "document") return `/document/${id}`;
    if (type === "folder") return `/folders/${id}`;
    if (type === "task") {
        return boardId ? `/board/${boardId}?task=${id}` : `/board`;
    }
    return `/board/${id}`;
}

function undoKindFor(tool: string, operations: ChatEditOperations): ChatEditUndoKind {
    if (operations.undoKind) return operations.undoKind;
    if (tool === "create_note") return "trash";
    if (tool === "append_note" || tool === "edit_note" || tool === "update_note") return "restore";
    return "none";
}

function toChatEditDto(record: PBChatEdit): ChatEditDto {
    const operations = parseJsonObject(record.operations);
    const kind = undoKindFor(record.tool, operations);
    const title = (operations.targetTitle || "").trim()
        || (record.target_type === "document"
            ? "Untitled note"
            : record.target_type === "board"
                ? "Untitled board"
                : record.target_type === "folder"
                    ? "Untitled folder"
                    : "Untitled task");
    const target: ChatEditTarget = {
        type: record.target_type,
        id: record.target_id,
        title,
        url: targetUrl(record.target_type, record.target_id, operations.targetBoardId),
    };

    return {
        id: record.id,
        conversationId: record.conversation,
        messageId: record.message || null,
        target,
        tool: record.tool,
        summary: record.summary || "",
        status: record.status,
        actorType: "ai",
        actorLabel: record.actor_label || "Nana",
        changed: parseChanges(operations.changed),
        undo: {
            kind,
            available: record.status === "applied" && kind !== "none",
        },
        created: record.created,
        updated: record.updated,
    };
}

async function conversationForCaller(
    authHeader: string,
    conversationId: string,
): Promise<PBConversation> {
    return pbFetchWithToken<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
    );
}

async function superuserRequest<T>(path: string, options: RequestInit): Promise<T> {
    const token = await getSuperuserToken();
    return pbFetchWithToken<T>(path, token, options);
}

/**
 * Persist one applied AI write. The row is server-owned (`chat_edits` has no
 * create rule), so the write uses the server's superuser credential after the
 * caller's token has proved that they own the conversation. The AI is not a
 * user and no `users` row is created.
 */
export async function recordChatEdit(
    authHeader: string,
    input: RecordChatEditInput,
): Promise<ChatEditDto> {
    await conversationForCaller(authHeader, input.conversationId);

    const operations: ChatEditOperations = {
        kind: input.kind ?? (input.tool.startsWith("create_") ? "create" : "edit"),
        targetTitle: input.targetTitle.slice(0, 200),
        ...(input.targetBoardId ? { targetBoardId: input.targetBoardId } : {}),
        changed: input.changed ?? {},
        ...(input.operations && input.operations.length > 0 ? { operations: input.operations } : {}),
        ...(input.before ? { before: input.before } : {}),
        ...(input.versionId ? { versionId: input.versionId } : {}),
        ...(typeof input.afterRevision === "number" ? { afterRevision: input.afterRevision } : {}),
        ...(input.afterUpdated ? { afterUpdated: input.afterUpdated } : {}),
        undoKind: input.undoKind ?? undoKindFor(input.tool, {}),
    };

    const body: Record<string, unknown> = {
        conversation: input.conversationId,
        actor_type: "ai",
        actor_label: "Nana",
        target_type: input.targetType,
        target_id: input.targetId,
        tool: input.tool,
        summary: input.summary.slice(0, 500),
        operations,
        status: input.status ?? "applied",
    };
    if (input.messageId) body.message = input.messageId;

    const created = await superuserRequest<PBChatEdit>(
        "/api/collections/chat_edits/records",
        { method: "POST", body: JSON.stringify(body) },
    );
    return toChatEditDto(created);
}

/** Attach later-created assistant message ids to the edit rows. Best effort. */
export async function attachChatEditMessage(
    editIds: string[],
    messageId: string,
): Promise<void> {
    if (!messageId || editIds.length === 0) return;
    for (const id of editIds) {
        try {
            await superuserRequest<PBChatEdit>(
                `/api/collections/chat_edits/records/${encodeURIComponent(id)}`,
                { method: "PATCH", body: JSON.stringify({ message: messageId }) },
            );
        } catch {
            // The edit row already exists; a missing message link is cosmetic.
        }
    }
}

export async function getChatEdit(
    authHeader: string,
    editId: string,
): Promise<ChatEditDto> {
    const record = await pbFetchWithToken<PBChatEdit>(
        `/api/collections/chat_edits/records/${encodeURIComponent(editId)}`,
        authHeader,
    );
    return toChatEditDto(record);
}

/** Edit cards for one conversation, oldest first (newest last). */
export async function listChatEdits(
    authHeader: string,
    conversationId: string,
): Promise<ChatEditDto[]> {
    await conversationForCaller(authHeader, conversationId);

    const edits: ChatEditDto[] = [];
    let page = 1;
    let totalPages = 1;

    do {
        const filter = encodeURIComponent(`conversation="${conversationId}"`);
        const result = await pbFetchWithToken<PBListResponse<PBChatEdit>>(
            `/api/collections/chat_edits/records?filter=${filter}&sort=created,id&perPage=200&page=${page}`,
            authHeader,
        );
        for (const record of result.items ?? []) {
            if (record && typeof record.id === "string") edits.push(toChatEditDto(record));
        }
        totalPages = typeof result.totalPages === "number" && result.totalPages > 0
            ? result.totalPages
            : page;
        page += 1;
    } while (page <= totalPages && page <= 5);

    return edits;
}

async function loadVersionSnapshot(
    authHeader: string,
    versionId: string,
    documentId: string,
): Promise<NoteSnapshot | null> {
    try {
        const version = await pbFetchWithToken<PBVersionRecord>(
            `/api/collections/document_versions/records/${encodeURIComponent(versionId)}`,
            authHeader,
        );
        if (version.document !== documentId) return null;
        return parseSnapshot(version.snapshot);
    } catch {
        return null;
    }
}

export interface UndoChatEditResult {
    edit: ChatEditDto;
    alreadyUndone: boolean;
}

/**
 * Undo one AI write.
 *
 * A created note goes to trash. A note edit restores the version snapshot the
 * PocketBase hook wrote before the edit. Repeated calls are idempotent: they
 * return the current `undone` row instead of restoring twice.
 */
export async function undoChatEdit(
    context: ToolContext,
    editId: string,
): Promise<UndoChatEditResult> {
    const edit = await getChatEdit(context.authHeader, editId);
    if (edit.status !== "applied") {
        return { edit, alreadyUndone: true };
    }

    // The chat_edits view rule already scopes this to the conversation author,
    // but verify explicitly before writing with the server credential.
    const record = await pbFetchWithToken<PBChatEdit>(
        `/api/collections/chat_edits/records/${encodeURIComponent(editId)}`,
        context.authHeader,
    );
    const conversation = await conversationForCaller(context.authHeader, record.conversation);
    if (conversation.author !== context.userId) throw notFound();
    if (record.actor_type !== "ai") throw conflict("That edit was not made by Nana.");

    const operations = parseJsonObject(record.operations);
    const kind = undoKindFor(record.tool, operations);

    if (record.target_type !== "document" || kind === "none") {
        throw conflict("That edit cannot be undone from chat.");
    }

    if (kind === "trash") {
        try {
            await deleteNote(context, "ai", record.target_id);
        } catch (error) {
            // Already trashed or removed: the desired end state is reached.
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
    } else {
        const afterRevision = typeof operations.afterRevision === "number"
            ? operations.afterRevision
            : null;
        if (afterRevision === null) throw conflict("That edit has no saved revision to restore.");

        let snapshot: NoteSnapshot | null = null;
        if (operations.versionId) {
            snapshot = await loadVersionSnapshot(context.authHeader, operations.versionId, record.target_id);
        }
        if (!snapshot) snapshot = parseSnapshot(operations.before);
        if (!snapshot) throw conflict("That edit has no saved snapshot to restore.");

        await restoreNoteSnapshot(
            context,
            "ai",
            record.target_id,
            snapshot,
            afterRevision,
            typeof operations.afterUpdated === "string" ? operations.afterUpdated : undefined,
        );
    }

    const updated = await superuserRequest<PBChatEdit>(
        `/api/collections/chat_edits/records/${encodeURIComponent(editId)}`,
        { method: "PATCH", body: JSON.stringify({ status: "undone" }) },
    );

    return { edit: toChatEditDto(updated), alreadyUndone: false };
}

async function loadPendingAction(
    context: ToolContext,
    editId: string,
): Promise<PBChatEdit> {
    // Read the server-owned row, then prove conversation ownership with the
    // caller's token. This keeps pending actions reliable even if a collection
    // view rule is narrowed, and still fails closed for every other user.
    const record = await superuserRequest<PBChatEdit>(
        `/api/collections/chat_edits/records/${encodeURIComponent(editId)}`,
        { method: "GET" },
    );
    const conversation = await conversationForCaller(context.authHeader, record.conversation);
    if (conversation.author !== context.userId) throw notFound();
    if (record.actor_type !== "ai") throw conflict("That action was not made by Nana.");
    return record;
}

async function setActionStatus(editId: string, status: ChatEditStatus): Promise<PBChatEdit> {
    return superuserRequest<PBChatEdit>(
        `/api/collections/chat_edits/records/${encodeURIComponent(editId)}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
    );
}

/**
 * Execute one pending delete after the user explicitly confirmed it. The
 * pending row is created by a delete tool; the model never has a path that
 * performs the delete directly. Ownership, visibility, and board/archive
 * rules are checked again by the workspace service at confirmation time.
 */
export async function confirmChatEdit(
    context: ToolContext,
    editId: string,
): Promise<ChatEditDto> {
    const record = await loadPendingAction(context, editId);
    if (record.status === "applied") return toChatEditDto(record);
    if (record.status !== "pending") throw conflict("That action is no longer waiting for confirmation.");

    try {
        if (record.tool === "delete_note") {
            await deleteNote(context, "ai", record.target_id);
        } else if (record.tool === "delete_task") {
            await deleteTask(context, "ai", record.target_id);
        } else if (record.tool === "delete_folder") {
            await deleteFolder(context, "ai", record.target_id);
        } else if (record.tool === "delete_board") {
            await deleteBoard(context, "ai", record.target_id);
        } else {
            throw conflict("That pending action cannot be confirmed.");
        }
    } catch (error) {
        // Keep the row pending so a transient failure can be retried after the
        // user fixes the cause (for example, archiving a board first).
        throw error;
    }

    return toChatEditDto(await setActionStatus(record.id, "applied"));
}

/** Decline a pending delete without touching its target. */
export async function cancelChatEdit(
    context: ToolContext,
    editId: string,
): Promise<ChatEditDto> {
    const record = await loadPendingAction(context, editId);
    if (record.status === "cancelled") return toChatEditDto(record);
    if (record.status !== "pending") throw conflict("That action is no longer waiting for confirmation.");
    return toChatEditDto(await setActionStatus(record.id, "cancelled"));
}
