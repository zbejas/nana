import { z } from "zod";
import { sanitizeHtml } from "../../../lib/sanitize";
import { createLogger } from "../../../lib/logger";
import { applySectionEdits, MarkdownSectionError, type AppliedSectionEdit, type MarkdownEditOperation } from "../../../lib/markdown/sections";
import { pbGet, queryString, type ToolContext } from "../../pocketbase/client";
import { loadAiVisibility, noteIsLocked } from "../../workspace/privacy";
import { createBoard, getBoard, moveBoard, updateBoard } from "../../workspace/boards";
import { createFolder, listFolders, updateFolder } from "../../workspace/folders";
import {
    createNote,
    editNoteRecord,
    getNote,
    moveNote,
    type NoteSnapshot,
} from "../../workspace/notes";
import { createTask, getTask, moveTask, updateTask } from "../../workspace/tasks";
import type { FolderDto, TaskDto } from "../../workspace/types";
import { failureFromError } from "./errors";
import { recordChatEdit } from "../edits";
import type { ChatRunRecorder } from "./recorder";
import { isValidRecordId, truncate } from "./text";
import { noteVersionToken, revisionMatches } from "./version";
import type {
    ChatEditChanges,
    ChatEditSection,
    ChatEditTarget,
    ChatEditUndoKind,
} from "../types";
import type { ToolFailure } from "../../pocketbase/client";

const log = createLogger("ChatWrites");

const MAX_NOTE_CONTENT_CHARS = 2_000_000;
const MAX_FRAGMENT_CHARS = 200_000;
const MAX_TASK_DESCRIPTION_CHARS = 100_000;
const MAX_TITLE_CHARS = 200;

const recordId = z.string().min(1).max(64);
const expectedRevision = z.union([
    z.number().int().min(0),
    z.string().min(1).max(128),
]);
const summarySchema = z.string().min(1).max(500);
const tagsSchema = z.array(z.string().min(1).max(60)).max(20);

const sectionOperationSchema = z.discriminatedUnion("op", [
    z.object({
        op: z.literal("replace_section"),
        heading: z.string().min(1).max(200),
        markdown: z.string().max(MAX_FRAGMENT_CHARS),
    }),
    z.object({
        op: z.literal("insert_after"),
        heading: z.string().min(1).max(200),
        markdown: z.string().max(MAX_FRAGMENT_CHARS),
    }),
    z.object({
        op: z.literal("append"),
        markdown: z.string().max(MAX_FRAGMENT_CHARS),
    }),
    z.object({
        op: z.literal("replace_text"),
        find: z.string().min(1).max(20_000),
        markdown: z.string().max(MAX_FRAGMENT_CHARS),
    }),
]);

export const createNoteInputSchema = z.object({
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe("The note title."),
    content: z.string().max(MAX_NOTE_CONTENT_CHARS).optional().describe("Optional Markdown body."),
    tags: tagsSchema.optional().describe("Up to 20 short tags."),
    folder: z.string().min(1).max(64).optional().describe("Optional folder id; omit for the workspace root."),
});

export const appendNoteInputSchema = z.object({
    noteId: recordId.describe("The note id from read_note."),
    markdown: z.string().min(1).max(MAX_FRAGMENT_CHARS).describe("Markdown to add at the end of the note."),
    expectedRevision: expectedRevision.describe("The revision or versionToken returned by read_note."),
    summary: summarySchema.optional().describe("Optional one-line description of the append."),
});

export const editNoteInputSchema = z.object({
    noteId: recordId.describe("The note id from read_note."),
    expectedRevision: expectedRevision.describe("The revision or versionToken returned by read_note."),
    operations: z.array(sectionOperationSchema).min(1).max(20).describe("Section-scoped Markdown operations, applied in order."),
    summary: summarySchema.describe("One-line description of what changed."),
});

export const updateNoteInputSchema = z.object({
    noteId: recordId.describe("The note id from read_note."),
    expectedRevision: expectedRevision.describe("The revision or versionToken returned by read_note."),
    title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
    tags: tagsSchema.optional(),
    summary: summarySchema.optional(),
}).refine((value) => value.title !== undefined || value.tags !== undefined, {
    message: "Provide a title or tags. Note content is changed with edit_note.",
});

export const createFolderInputSchema = z.object({
    name: z.string().min(1).max(160),
    parentId: z.string().min(1).max(64).optional().describe("Optional parent folder id; omit for the root."),
});

export const moveNoteInputSchema = z.object({
    noteId: recordId.describe("The visible note id to move."),
    folderId: z.string().max(64).nullable().describe("Destination folder id, or null for the workspace root."),
    summary: summarySchema.optional(),
});

export const renameFolderInputSchema = z.object({
    folderId: recordId.describe("The visible folder id to rename."),
    name: z.string().min(1).max(160),
    summary: summarySchema.optional(),
});

export const moveFolderInputSchema = z.object({
    folderId: recordId.describe("The visible folder id to move."),
    parentId: z.string().max(64).nullable().describe("New parent folder id, or null for the workspace root."),
    summary: summarySchema.optional(),
});

export const createBoardInputSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(10_000).optional(),
    folder: z.string().min(1).max(64).optional().describe("Optional folder id; omit for the workspace root."),
});

export const updateBoardInputSchema = z.object({
    boardId: recordId.describe("The visible board id to update."),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(10_000).optional(),
    archived: z.boolean().optional().describe("Archive the board, or restore it with false."),
    summary: summarySchema.optional(),
}).refine((value) => (
    value.name !== undefined
    || value.description !== undefined
    || value.archived !== undefined
), {
    message: "Provide a name, description, or archive state.",
});

export const moveBoardInputSchema = z.object({
    boardId: recordId.describe("The visible board id to move."),
    folderId: z.string().max(64).nullable().describe("Destination folder id, or null for the workspace root."),
    summary: summarySchema.optional(),
});

export const deleteNoteInputSchema = z.object({
    noteId: recordId.describe("The visible note id to move to trash."),
    summary: summarySchema.optional(),
});

export const deleteTaskInputSchema = z.object({
    taskId: recordId.describe("The visible task id to delete permanently."),
    summary: summarySchema.optional(),
});

export const deleteFolderInputSchema = z.object({
    folderId: recordId.describe("The visible folder id to move to trash."),
    summary: summarySchema.optional(),
});

export const deleteBoardInputSchema = z.object({
    boardId: recordId.describe("The archived board id to delete permanently."),
    summary: summarySchema.optional(),
});

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const assigneeSchema = z.string().max(64).optional().describe("A user id, `me`, or `none`.");

export const createTaskInputSchema = z.object({
    boardId: recordId.describe("The board id from list_boards or read_board."),
    title: z.string().min(1).max(MAX_TITLE_CHARS),
    description: z.string().max(MAX_TASK_DESCRIPTION_CHARS).optional(),
    status: z.string().min(1).max(60).optional().describe("A column slug, `planned`, or `archived`."),
    priority: prioritySchema.optional(),
    dueDate: z.string().max(40).optional().describe("PocketBase date string or YYYY-MM-DD."),
    assignee: assigneeSchema,
});

export const updateTaskInputSchema = z.object({
    taskId: recordId.describe("The task id from read_task or read_board."),
    title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
    description: z.string().max(MAX_TASK_DESCRIPTION_CHARS).optional(),
    status: z.string().min(1).max(60).optional(),
    priority: prioritySchema.optional(),
    dueDate: z.string().max(40).optional(),
    assignee: assigneeSchema,
    summary: summarySchema.optional(),
});

export const moveTaskInputSchema = z.object({
    taskId: recordId.describe("The task id from read_task or read_board."),
    status: z.string().min(1).max(60).describe("A column slug, `planned`, or `archived`."),
    boardOrder: z.number().int().min(0).max(1_000_000).optional(),
    summary: summarySchema.optional(),
});

export type CreateNoteInput = z.input<typeof createNoteInputSchema>;
export type AppendNoteInput = z.input<typeof appendNoteInputSchema>;
export type EditNoteInput = z.input<typeof editNoteInputSchema>;
export type UpdateNoteInput = z.input<typeof updateNoteInputSchema>;
export type CreateFolderInput = z.input<typeof createFolderInputSchema>;
export type MoveNoteInput = z.input<typeof moveNoteInputSchema>;
export type RenameFolderInput = z.input<typeof renameFolderInputSchema>;
export type MoveFolderInput = z.input<typeof moveFolderInputSchema>;
export type CreateBoardInput = z.input<typeof createBoardInputSchema>;
export type UpdateBoardInput = z.input<typeof updateBoardInputSchema>;
export type MoveBoardInput = z.input<typeof moveBoardInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type MoveTaskInput = z.input<typeof moveTaskInputSchema>;
export type DeleteNoteInput = z.input<typeof deleteNoteInputSchema>;
export type DeleteTaskInput = z.input<typeof deleteTaskInputSchema>;
export type DeleteFolderInput = z.input<typeof deleteFolderInputSchema>;
export type DeleteBoardInput = z.input<typeof deleteBoardInputSchema>;

export interface ChatWriteToolResult {
    ok: true;
    target: ChatEditTarget;
    summary: string;
    changed: ChatEditChanges;
    undo: {
        kind: ChatEditUndoKind;
        available: boolean;
        editId: string | null;
    };
    /** Present on delete requests; the target is untouched until confirmed. */
    pending?: boolean;
    actionId?: string;
    revision?: number;
    versionToken?: string;
    [key: string]: unknown;
}

export type ChatWriteResult = ChatWriteToolResult | ToolFailure;

interface WriteContext {
    context: ToolContext;
    recorder: ChatRunRecorder;
    conversationId?: string;
}

interface EditableNote {
    id: string;
    title: string;
    content: string;
    tags: string[];
    folder: string;
    isPrivate: boolean;
    revision: number;
    versionToken: string;
}

interface PBEditableNote {
    id?: string;
    title?: string;
    content?: string;
    tags?: unknown;
    folder?: string;
    is_private?: boolean;
    updated?: string;
    revision?: number;
    author?: string;
}

function aiContext(context: ToolContext): ToolContext {
    return { ...context, actor: "ai" };
}

function targetFor(type: ChatEditTarget["type"], id: string, title: string, boardId?: string): ChatEditTarget {
    return {
        type,
        id,
        title: truncate(
            title || (type === "document"
                ? "Untitled note"
                : type === "board"
                    ? "Untitled board"
                    : type === "folder"
                        ? "Untitled folder"
                        : "Untitled task"),
            200,
        ),
        url: type === "document"
            ? `/document/${id}`
            : type === "folder"
                ? `/folders/${id}`
                : type === "task"
                    ? boardId ? `/board/${boardId}?task=${id}` : "/board"
                    : `/board/${id}`,
    };
}

function sectionsFromApplied(changed: AppliedSectionEdit[]): ChatEditSection[] {
    return changed.map((entry) => ({
        heading: entry.heading ?? null,
        path: entry.path ?? [],
        op: entry.op,
        from: entry.from,
        to: entry.to,
    }));
}

async function persistEdit(
    write: WriteContext,
    input: {
        tool: string;
        targetType: ChatEditTarget["type"];
        targetId: string;
        targetTitle: string;
        targetBoardId?: string;
        summary: string;
        changed: ChatEditChanges;
        operations?: unknown[];
        before?: NoteSnapshot;
        afterRevision?: number;
        afterUpdated?: string;
        undoKind: ChatEditUndoKind;
        status?: "pending" | "applied";
        kind?: "create" | "edit" | "delete";
    },
): Promise<string | null> {
    if (!write.conversationId) return null;
    try {
        const edit = await recordChatEdit(write.context.authHeader, {
            conversationId: write.conversationId,
            tool: input.tool,
            targetType: input.targetType,
            targetId: input.targetId,
            targetTitle: input.targetTitle,
            targetBoardId: input.targetBoardId,
            summary: input.summary,
            changed: input.changed,
            operations: input.operations,
            before: input.before,
            afterRevision: input.afterRevision,
            afterUpdated: input.afterUpdated,
            undoKind: input.undoKind,
            status: input.status,
            kind: input.kind,
        });
        write.recorder.addEdit(edit);
        return edit.id;
    } catch (error) {
        // The workspace write succeeded. Losing the card is preferable to
        // turning a successful edit into a model-visible failure.
        log.warn("Failed to record chat edit", {
            tool: input.tool,
            targetType: input.targetType,
            error: error instanceof Error ? error.name : "unknown",
        });
        return null;
    }
}

async function loadEditableNote(
    context: ToolContext,
    noteId: string,
): Promise<EditableNote | ToolFailure> {
    if (!isValidRecordId(noteId)) {
        return { ok: false, code: "invalid_input", message: "That note id is not valid." };
    }

    const path = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({
        fields: "id,title,content,tags,folder,is_private,updated,revision,author",
    })}`;
    const result = await pbGet<PBEditableNote>(path, context);
    if (!result.ok) return result;

    const record = result;
    if (typeof record.id !== "string" || record.author !== context.userId) {
        return { ok: false, code: "not_found", message: "That note was not found." };
    }

    const visibility = await loadAiVisibility(context);
    if (!visibility.ok) return visibility;
    if (noteIsLocked(visibility, record)) {
        return { ok: false, code: "not_found", message: "That note was not found." };
    }

    const content = typeof record.content === "string" ? record.content : "";
    if (content.length > MAX_NOTE_CONTENT_CHARS) {
        return {
            ok: false,
            code: "invalid_input",
            message: "That note is too large for a chat edit. Edit it in the editor.",
        };
    }

    return {
        id: record.id,
        title: typeof record.title === "string" ? record.title : "",
        content,
        tags: Array.isArray(record.tags)
            ? record.tags.filter((tag): tag is string => typeof tag === "string")
            : [],
        folder: typeof record.folder === "string" ? record.folder : "",
        isPrivate: record.is_private === true,
        revision: typeof record.revision === "number" && Number.isFinite(record.revision)
            ? record.revision
            : 0,
        versionToken: noteVersionToken({
            title: record.title,
            content: record.content,
            tags: record.tags,
            updated: record.updated,
        }),
    };
}

async function loadVisibleFolder(context: ToolContext, folderId: string): Promise<FolderDto | null> {
    const folders = await listFolders(context, "ai");
    return folders.find((folder) => folder.id === folderId) ?? null;
}

function snapshotOf(note: EditableNote): NoteSnapshot {
    return {
        title: note.title,
        content: note.content,
        tags: note.tags,
        folder: note.folder,
        isPrivate: note.isPrivate,
    };
}

function staleRevisionFailure(): ToolFailure {
    return {
        ok: false,
        code: "conflict",
        message: "This note changed since it was read. Call read_note again and retry.",
    };
}

async function sanitizeFragments(
    operations: MarkdownEditOperation[],
): Promise<MarkdownEditOperation[]> {
    return Promise.all(operations.map(async (operation) => {
        const markdown = operation.markdown.length > MAX_FRAGMENT_CHARS
            ? operation.markdown.slice(0, MAX_FRAGMENT_CHARS)
            : operation.markdown;
        return { ...operation, markdown: await sanitizeHtml(markdown) };
    }));
}

function resolveAssignee(value: string | undefined, userId: string): string | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "unassigned") {
        return null;
    }
    if (trimmed.toLowerCase() === "me") return userId;
    if (!isValidRecordId(trimmed)) return undefined;
    return trimmed;
}

function invalidAssignee(): ToolFailure {
    return {
        ok: false,
        code: "invalid_input",
        message: "Use a user id, `me`, or `none` for the assignee.",
    };
}

// ── Notes ────────────────────────────────────────────────────────────

export async function createNoteTool(
    write: WriteContext,
    input: CreateNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = createNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The note details were not valid." };
    }

    try {
        const note = await createNote(aiContext(write.context), "ai", {
            title: parsed.data.title,
            content: parsed.data.content ?? "",
            tags: parsed.data.tags,
            folderId: parsed.data.folder ?? null,
        });
        const summary = `Created note “${truncate(note.title, 120)}”.`;
        const changed: ChatEditChanges = { fields: ["title", "content", "tags"] };
        const target = targetFor("document", note.id, note.title);
        const editId = await persistEdit(write, {
            tool: "create_note",
            targetType: "document",
            targetId: note.id,
            targetTitle: note.title,
            summary,
            changed,
            undoKind: "trash",
        });
        write.recorder.addSource({ type: "document", id: note.id, title: note.title });
        return {
            ok: true,
            target,
            summary,
            changed,
            undo: { kind: "trash", available: editId !== null, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function createFolderTool(
    write: WriteContext,
    input: CreateFolderInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = createFolderInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The folder details were not valid." };
    }

    try {
        const folder = await createFolder(aiContext(write.context), "ai", {
            name: parsed.data.name,
            parentId: parsed.data.parentId ?? null,
        });
        const summary = `Created folder “${truncate(folder.name, 120)}”.`;
        const changed: ChatEditChanges = { fields: ["name"] };
        const editId = await persistEdit(write, {
            tool: "create_folder",
            targetType: "folder",
            targetId: folder.id,
            targetTitle: folder.name,
            summary,
            changed,
            undoKind: "none",
            kind: "create",
        });
        return {
            ok: true,
            target: targetFor("folder", folder.id, folder.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function renameFolderTool(
    write: WriteContext,
    input: RenameFolderInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = renameFolderInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The folder details were not valid." };
    }

    try {
        const folder = await loadVisibleFolder(write.context, parsed.data.folderId);
        if (!folder) {
            return { ok: false, code: "not_found", message: "That folder was not found." };
        }
        const updated = await updateFolder(aiContext(write.context), "ai", folder.id, {
            name: parsed.data.name,
        });
        const summary = parsed.data.summary?.trim()
            || `Renamed folder “${truncate(folder.name, 120)}” to “${truncate(updated.name, 120)}”.`;
        const changed: ChatEditChanges = { fields: ["name"] };
        const editId = await persistEdit(write, {
            tool: "rename_folder",
            targetType: "folder",
            targetId: updated.id,
            targetTitle: updated.name,
            summary,
            changed,
            undoKind: "none",
            kind: "edit",
        });
        return {
            ok: true,
            target: targetFor("folder", updated.id, updated.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function moveFolderTool(
    write: WriteContext,
    input: MoveFolderInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = moveFolderInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The folder move details were not valid." };
    }

    try {
        const folder = await loadVisibleFolder(write.context, parsed.data.folderId);
        if (!folder) {
            return { ok: false, code: "not_found", message: "That folder was not found." };
        }
        const parentId = parsed.data.parentId?.trim() || null;
        const updated = await updateFolder(aiContext(write.context), "ai", folder.id, {
            parentId,
        });
        const summary = parsed.data.summary?.trim()
            || (parentId
                ? `Moved folder “${truncate(updated.name, 120)}” into another folder.`
                : `Moved folder “${truncate(updated.name, 120)}” to the workspace root.`);
        const changed: ChatEditChanges = { fields: ["parent"] };
        const editId = await persistEdit(write, {
            tool: "move_folder",
            targetType: "folder",
            targetId: updated.id,
            targetTitle: updated.name,
            summary,
            changed,
            undoKind: "none",
            kind: "edit",
        });
        return {
            ok: true,
            target: targetFor("folder", updated.id, updated.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function appendNoteTool(
    write: WriteContext,
    input: AppendNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = appendNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The append request was not valid." };
    }

    if (!parsed.data.markdown.trim()) {
        return { ok: false, code: "invalid_input", message: "Nothing to append." };
    }

    const note = await loadEditableNote(write.context, parsed.data.noteId);
    if ("ok" in note) return note;
    if (!revisionMatches(parsed.data.expectedRevision, note)) return staleRevisionFailure();

    const before = snapshotOf(note);

    try {
        const [operation] = await sanitizeFragments([{ op: "append", markdown: parsed.data.markdown }]);
        if (!operation) return { ok: false, code: "invalid_input", message: "Nothing to append." };
        const applied = applySectionEdits(note.content, [operation]);
        const result = await editNoteRecord(
            aiContext(write.context),
            "ai",
            note.id,
            { content: applied.markdown },
            {
                revision: note.revision,
                versionToken: note.versionToken,
                sanitizeContent: false,
            },
        );

        const summary = parsed.data.summary?.trim()
            || `Added a section at the end of “${truncate(note.title, 100)}”.`;
        const changed: ChatEditChanges = { sections: sectionsFromApplied(applied.changed) };
        const editId = await persistEdit(write, {
            tool: "append_note",
            targetType: "document",
            targetId: note.id,
            targetTitle: result.note.title,
            summary,
            changed,
            operations: [operation],
            before,
            afterRevision: result.revision,
            afterUpdated: result.note.updated,
            undoKind: "restore",
        });
        write.recorder.addSource({ type: "document", id: note.id, title: result.note.title });

        return {
            ok: true,
            target: targetFor("document", note.id, result.note.title),
            summary,
            changed,
            undo: { kind: "restore", available: editId !== null, editId },
            revision: result.revision,
            versionToken: result.versionToken,
        };
    } catch (error) {
        if (error instanceof MarkdownSectionError) {
            return { ok: false, code: "invalid_input", message: error.message };
        }
        return failureFromError(error);
    }
}

export async function editNoteTool(
    write: WriteContext,
    input: EditNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = editNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The edit request was not valid." };
    }

    const note = await loadEditableNote(write.context, parsed.data.noteId);
    if ("ok" in note) return note;
    if (!revisionMatches(parsed.data.expectedRevision, note)) return staleRevisionFailure();

    const before = snapshotOf(note);

    let operations: MarkdownEditOperation[];
    let applied: ReturnType<typeof applySectionEdits>;
    try {
        operations = await sanitizeFragments(parsed.data.operations as MarkdownEditOperation[]);
        // applySectionEdits validates every anchor before the caller writes.
        // One missing or ambiguous anchor throws and no PocketBase write occurs.
        applied = applySectionEdits(note.content, operations);
    } catch (error) {
        if (error instanceof MarkdownSectionError) {
            return {
                ok: false,
                code: error.code === "ambiguous" ? "conflict" : "invalid_input",
                message: `${error.message} Read the note again and retry with an exact heading or unique text.`,
            };
        }
        return { ok: false, code: "invalid_input", message: "Those section edits could not be applied." };
    }

    try {
        const result = await editNoteRecord(
            aiContext(write.context),
            "ai",
            note.id,
            { content: applied.markdown },
            {
                revision: note.revision,
                versionToken: note.versionToken,
                sanitizeContent: false,
            },
        );

        const summary = parsed.data.summary.trim();
        const changed: ChatEditChanges = { sections: sectionsFromApplied(applied.changed) };
        const editId = await persistEdit(write, {
            tool: "edit_note",
            targetType: "document",
            targetId: note.id,
            targetTitle: result.note.title,
            summary,
            changed,
            operations,
            before,
            afterRevision: result.revision,
            afterUpdated: result.note.updated,
            undoKind: "restore",
        });
        write.recorder.addSource({ type: "document", id: note.id, title: result.note.title });

        return {
            ok: true,
            target: targetFor("document", note.id, result.note.title),
            summary,
            changed,
            undo: { kind: "restore", available: editId !== null, editId },
            revision: result.revision,
            versionToken: result.versionToken,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function updateNoteTool(
    write: WriteContext,
    input: UpdateNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = updateNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "Provide a title or tags to update." };
    }

    const note = await loadEditableNote(write.context, parsed.data.noteId);
    if ("ok" in note) return note;
    if (!revisionMatches(parsed.data.expectedRevision, note)) return staleRevisionFailure();

    const before = snapshotOf(note);
    const fields: string[] = [];
    if (parsed.data.title !== undefined) fields.push("title");
    if (parsed.data.tags !== undefined) fields.push("tags");

    try {
        const result = await editNoteRecord(
            aiContext(write.context),
            "ai",
            note.id,
            {
                ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
                ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
            },
            {
                revision: note.revision,
                versionToken: note.versionToken,
            },
        );

        const summary = parsed.data.summary?.trim()
            || `Updated ${fields.join(" and ")} on “${truncate(result.note.title, 100)}”.`;
        const changed: ChatEditChanges = { fields };
        const editId = await persistEdit(write, {
            tool: "update_note",
            targetType: "document",
            targetId: note.id,
            targetTitle: result.note.title,
            summary,
            changed,
            before,
            afterRevision: result.revision,
            afterUpdated: result.note.updated,
            undoKind: "restore",
        });
        write.recorder.addSource({ type: "document", id: note.id, title: result.note.title });

        return {
            ok: true,
            target: targetFor("document", note.id, result.note.title),
            summary,
            changed,
            undo: { kind: "restore", available: editId !== null, editId },
            revision: result.revision,
            versionToken: result.versionToken,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function moveNoteTool(
    write: WriteContext,
    input: MoveNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = moveNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The note move details were not valid." };
    }

    try {
        const note = await getNote(write.context, "ai", parsed.data.noteId);
        const folderId = parsed.data.folderId?.trim() || null;
        const updated = await moveNote(aiContext(write.context), "ai", note.id, folderId);
        const summary = parsed.data.summary?.trim()
            || (folderId
                ? `Moved note “${truncate(updated.title, 120)}” into a folder.`
                : `Moved note “${truncate(updated.title, 120)}” to the workspace root.`);
        const changed: ChatEditChanges = { fields: ["folder"] };
        const editId = await persistEdit(write, {
            tool: "move_note",
            targetType: "document",
            targetId: updated.id,
            targetTitle: updated.title,
            summary,
            changed,
            undoKind: "none",
            kind: "edit",
        });
        write.recorder.addSource({ type: "document", id: updated.id, title: updated.title });

        return {
            ok: true,
            target: targetFor("document", updated.id, updated.title),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

// ── Boards and tasks ─────────────────────────────────────────────────

export async function createBoardTool(
    write: WriteContext,
    input: CreateBoardInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = createBoardInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The board details were not valid." };
    }

    try {
        const board = await createBoard(aiContext(write.context), "ai", {
            name: parsed.data.name,
            description: parsed.data.description ?? "",
            folderId: parsed.data.folder ?? null,
        });
        const summary = `Created board “${truncate(board.name, 100)}”.`;
        const changed: ChatEditChanges = { fields: ["name", "description"] };
        const editId = await persistEdit(write, {
            tool: "create_board",
            targetType: "board",
            targetId: board.id,
            targetTitle: board.name,
            summary,
            changed,
            undoKind: "none",
        });
        write.recorder.addSource({ type: "board", id: board.id, title: board.name });
        return {
            ok: true,
            target: targetFor("board", board.id, board.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function updateBoardTool(
    write: WriteContext,
    input: UpdateBoardInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = updateBoardInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The board update details were not valid." };
    }

    try {
        const board = await getBoard(write.context, "ai", parsed.data.boardId);
        const fields: string[] = [];
        if (parsed.data.name !== undefined) fields.push("name");
        if (parsed.data.description !== undefined) fields.push("description");
        if (parsed.data.archived !== undefined) fields.push("archived");

        const updated = await updateBoard(aiContext(write.context), "ai", board.id, {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
            ...(parsed.data.archived !== undefined ? { archived: parsed.data.archived } : {}),
        });

        let summary = parsed.data.summary?.trim();
        if (!summary) {
            if (parsed.data.archived === true) {
                summary = `Archived board “${truncate(updated.name, 100)}”.`;
            } else if (parsed.data.archived === false) {
                summary = `Restored board “${truncate(updated.name, 100)}”.`;
            } else if (parsed.data.name !== undefined) {
                summary = `Renamed board “${truncate(board.name, 100)}” to “${truncate(updated.name, 100)}”.`;
            } else {
                summary = `Updated board “${truncate(updated.name, 100)}”.`;
            }
        }

        const changed: ChatEditChanges = { fields };
        const editId = await persistEdit(write, {
            tool: "update_board",
            targetType: "board",
            targetId: updated.id,
            targetTitle: updated.name,
            summary,
            changed,
            undoKind: "none",
            kind: "edit",
        });
        write.recorder.addSource({ type: "board", id: updated.id, title: updated.name });

        return {
            ok: true,
            target: targetFor("board", updated.id, updated.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function moveBoardTool(
    write: WriteContext,
    input: MoveBoardInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = moveBoardInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The board move details were not valid." };
    }

    try {
        const board = await getBoard(write.context, "ai", parsed.data.boardId);
        const folderId = parsed.data.folderId?.trim() || null;
        const updated = await moveBoard(aiContext(write.context), "ai", board.id, folderId);
        const summary = parsed.data.summary?.trim()
            || (folderId
                ? `Moved board “${truncate(updated.name, 100)}” into a folder.`
                : `Moved board “${truncate(updated.name, 100)}” to the workspace root.`);
        const changed: ChatEditChanges = { fields: ["folder"] };
        const editId = await persistEdit(write, {
            tool: "move_board",
            targetType: "board",
            targetId: updated.id,
            targetTitle: updated.name,
            summary,
            changed,
            undoKind: "none",
            kind: "edit",
        });
        write.recorder.addSource({ type: "board", id: updated.id, title: updated.name });

        return {
            ok: true,
            target: targetFor("board", updated.id, updated.name),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
        };
    } catch (error) {
        return failureFromError(error);
    }
}

function taskChangedFields(input: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    dueDate?: string;
    assignee?: string;
}): string[] {
    const fields: string[] = [];
    if (input.title !== undefined) fields.push("title");
    if (input.description !== undefined) fields.push("description");
    if (input.status !== undefined) fields.push("status");
    if (input.priority !== undefined) fields.push("priority");
    if (input.dueDate !== undefined) fields.push("dueDate");
    if (input.assignee !== undefined) fields.push("assignee");
    return fields;
}

export async function createTaskTool(
    write: WriteContext,
    input: CreateTaskInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = createTaskInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The task details were not valid." };
    }

    const assigneeId = resolveAssignee(parsed.data.assignee, write.context.userId);
    if (parsed.data.assignee !== undefined && assigneeId === undefined) return invalidAssignee();

    try {
        const board = await getBoard(write.context, "ai", parsed.data.boardId);
        if (board.archived) {
            return { ok: false, code: "conflict", message: "That board is archived." };
        }
        const task = await createTask(aiContext(write.context), "ai", {
            boardId: board.id,
            title: parsed.data.title,
            description: parsed.data.description,
            status: parsed.data.status,
            priority: parsed.data.priority,
            dueDate: parsed.data.dueDate,
            assigneeId: assigneeId ?? null,
        });
        const summary = `Created task “${truncate(task.title, 100)}” on “${truncate(board.name, 60)}”.`;
        const fields = taskChangedFields({
            title: parsed.data.title,
            description: parsed.data.description,
            status: parsed.data.status,
            priority: parsed.data.priority,
            dueDate: parsed.data.dueDate,
            assignee: parsed.data.assignee,
        });
        const changed: ChatEditChanges = { fields };
        const editId = await persistEdit(write, {
            tool: "create_task",
            targetType: "task",
            targetId: task.id,
            targetTitle: task.title,
            targetBoardId: task.boardId,
            summary,
            changed,
            undoKind: "none",
        });
        write.recorder.addSource({ type: "board", id: board.id, title: board.name });
        return {
            ok: true,
            target: targetFor("task", task.id, task.title, task.boardId),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
            status: task.status,
            taskNumber: task.taskNumber,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function updateTaskTool(
    write: WriteContext,
    input: UpdateTaskInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = updateTaskInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The task update was not valid." };
    }

    const assigneeId = resolveAssignee(parsed.data.assignee, write.context.userId);
    if (parsed.data.assignee !== undefined && assigneeId === undefined) return invalidAssignee();

    const fields = taskChangedFields(parsed.data);
    if (fields.length === 0) {
        return { ok: false, code: "invalid_input", message: "Provide at least one task field to update." };
    }

    try {
        const task = await updateTask(aiContext(write.context), "ai", parsed.data.taskId, {
            ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
            ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
            ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
            ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
            ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
            ...(assigneeId !== undefined ? { assigneeId } : {}),
        });
        const summary = parsed.data.summary?.trim()
            || `Updated ${fields.join(", ")} on “${truncate(task.title, 100)}”.`;
        const changed: ChatEditChanges = { fields };
        const editId = await persistEdit(write, {
            tool: "update_task",
            targetType: "task",
            targetId: task.id,
            targetTitle: task.title,
            targetBoardId: task.boardId,
            summary,
            changed,
            undoKind: "none",
        });
        return {
            ok: true,
            target: targetFor("task", task.id, task.title, task.boardId),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            assigneeId: task.assigneeId,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

export async function moveTaskTool(
    write: WriteContext,
    input: MoveTaskInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = moveTaskInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The move request was not valid." };
    }

    try {
        const task = await moveTask(aiContext(write.context), "ai", parsed.data.taskId, {
            status: parsed.data.status,
            ...(parsed.data.boardOrder !== undefined ? { boardOrder: parsed.data.boardOrder } : {}),
        });
        const summary = parsed.data.summary?.trim()
            || `Moved “${truncate(task.title, 100)}” to ${parsed.data.status}.`;
        const changed: ChatEditChanges = { fields: ["status"] };
        const editId = await persistEdit(write, {
            tool: "move_task",
            targetType: "task",
            targetId: task.id,
            targetTitle: task.title,
            targetBoardId: task.boardId,
            summary,
            changed,
            undoKind: "none",
        });
        return {
            ok: true,
            target: targetFor("task", task.id, task.title, task.boardId),
            summary,
            changed,
            undo: { kind: "none", available: false, editId },
            status: task.status,
        };
    } catch (error) {
        return failureFromError(error);
    }
}

async function requestDelete(
    write: WriteContext,
    input: {
        tool: "delete_note" | "delete_task" | "delete_folder" | "delete_board";
        targetType: "document" | "task" | "folder" | "board";
        targetId: string;
        targetTitle: string;
        targetBoardId?: string;
        summary: string;
    },
): Promise<ChatWriteResult> {
    if (!write.conversationId) {
        return {
            ok: false,
            code: "unavailable",
            message: "A confirmation card needs an active conversation.",
        };
    }

    const editId = await persistEdit(write, {
        tool: input.tool,
        targetType: input.targetType,
        targetId: input.targetId,
        targetTitle: input.targetTitle,
        targetBoardId: input.targetBoardId,
        summary: input.summary,
        changed: {},
        undoKind: "none",
        status: "pending",
        kind: "delete",
    });
    if (!editId) {
        return {
            ok: false,
            code: "unavailable",
            message: "The delete confirmation could not be created. Try again.",
        };
    }

    return {
        ok: true,
        target: targetFor(input.targetType, input.targetId, input.targetTitle, input.targetBoardId),
        summary: input.summary,
        changed: {},
        undo: { kind: "none", available: false, editId },
        pending: true,
        actionId: editId,
    };
}

export async function deleteNoteTool(
    write: WriteContext,
    input: DeleteNoteInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = deleteNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The note id was not valid." };
    }

    const note = await loadEditableNote(write.context, parsed.data.noteId);
    if ("ok" in note) return note;

    return requestDelete(write, {
        tool: "delete_note",
        targetType: "document",
        targetId: note.id,
        targetTitle: note.title,
        summary: parsed.data.summary?.trim()
            || `Move note “${truncate(note.title, 120)}” to trash.`,
    });
}

export async function deleteTaskTool(
    write: WriteContext,
    input: DeleteTaskInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = deleteTaskInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The task id was not valid." };
    }

    try {
        const task = await getTask(write.context, "ai", parsed.data.taskId);
        return requestDelete(write, {
            tool: "delete_task",
            targetType: "task",
            targetId: task.id,
            targetTitle: task.title,
            targetBoardId: task.boardId,
            summary: parsed.data.summary?.trim()
                || `Delete task “${truncate(task.title, 120)}” permanently.`,
        });
    } catch (error) {
        return failureFromError(error);
    }
}

export async function deleteFolderTool(
    write: WriteContext,
    input: DeleteFolderInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = deleteFolderInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The folder id was not valid." };
    }

    try {
        const folders = await listFolders(write.context, "ai");
        const folder = folders.find((candidate) => candidate.id === parsed.data.folderId);
        if (!folder) {
            return { ok: false, code: "not_found", message: "That folder was not found." };
        }
        return requestDelete(write, {
            tool: "delete_folder",
            targetType: "folder",
            targetId: folder.id,
            targetTitle: folder.name,
            summary: parsed.data.summary?.trim()
                || `Move folder “${truncate(folder.name, 120)}” to trash.`,
        });
    } catch (error) {
        return failureFromError(error);
    }
}

export async function deleteBoardTool(
    write: WriteContext,
    input: DeleteBoardInput | unknown,
): Promise<ChatWriteResult> {
    const parsed = deleteBoardInputSchema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, code: "invalid_input", message: "The board id was not valid." };
    }

    try {
        const board = await getBoard(write.context, "ai", parsed.data.boardId);
        if (!board.archived) {
            return {
                ok: false,
                code: "conflict",
                message: "Archive the board before deleting it.",
            };
        }
        return requestDelete(write, {
            tool: "delete_board",
            targetType: "board",
            targetId: board.id,
            targetTitle: board.name,
            summary: parsed.data.summary?.trim()
                || `Delete archived board “${truncate(board.name, 120)}” permanently.`,
        });
    } catch (error) {
        return failureFromError(error);
    }
}

/** Task DTO helper kept for tests and summaries. */
export function taskTarget(task: TaskDto): ChatEditTarget {
    return targetFor("task", task.id, task.title, task.boardId);
}
