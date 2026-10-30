import { z } from "zod";
import { sanitizeHtml } from "../../../lib/sanitize";
import { createLogger } from "../../../lib/logger";
import { applySectionEdits, MarkdownSectionError, type AppliedSectionEdit, type MarkdownEditOperation } from "../../../lib/markdown/sections";
import { pbGet, queryString, type PBListResponse, type ToolContext } from "../../pocketbase/client";
import { loadAiVisibility, noteIsLocked } from "../../workspace/privacy";
import { createBoard, getBoard } from "../../workspace/boards";
import {
    createNote,
    editNoteRecord,
    type NoteSnapshot,
} from "../../workspace/notes";
import { createTask, moveTask, updateTask } from "../../workspace/tasks";
import type { TaskDto } from "../../workspace/types";
import { failureFromError } from "./errors";
import { recordChatEdit } from "../edits";
import type { ChatRunRecorder } from "./recorder";
import { escapeFilterString, isValidRecordId, truncate } from "./text";
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

export const createBoardInputSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(10_000).optional(),
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
export type CreateBoardInput = z.input<typeof createBoardInputSchema>;
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type MoveTaskInput = z.input<typeof moveTaskInputSchema>;

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

interface PBVersionRecord {
    id: string;
    document?: string;
    version_number?: number;
    snapshot?: unknown;
}

function aiContext(context: ToolContext): ToolContext {
    return { ...context, actor: "ai" };
}

function targetFor(type: ChatEditTarget["type"], id: string, title: string, boardId?: string): ChatEditTarget {
    return {
        type,
        id,
        title: truncate(title || (type === "document" ? "Untitled note" : type === "board" ? "Untitled board" : "Untitled task"), 200),
        url: type === "document"
            ? `/document/${id}`
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
        versionId?: string;
        afterRevision?: number;
        afterUpdated?: string;
        undoKind: ChatEditUndoKind;
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
            versionId: input.versionId,
            afterRevision: input.afterRevision,
            afterUpdated: input.afterUpdated,
            undoKind: input.undoKind,
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

function snapshotOf(note: EditableNote): NoteSnapshot {
    return {
        title: note.title,
        content: note.content,
        tags: note.tags,
        folder: note.folder,
        isPrivate: note.isPrivate,
    };
}

async function latestVersionNumber(context: ToolContext, noteId: string): Promise<number | null> {
    const path = `/api/collections/document_versions/records${queryString({
        filter: `document="${escapeFilterString(noteId)}"`,
        sort: "-version_number",
        perPage: 1,
        fields: "id,version_number",
    })}`;
    const result = await pbGet<PBListResponse<{ version_number?: number }>>(path, context);
    if (!result.ok) return null;
    const value = result.items?.[0]?.version_number;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Find the snapshot PocketBase wrote immediately before this edit. */
async function findVersionCreated(
    context: ToolContext,
    noteId: string,
    previousNumber: number | null,
    before: NoteSnapshot,
): Promise<string | undefined> {
    const filter = previousNumber === null
        ? `document="${escapeFilterString(noteId)}"`
        : `document="${escapeFilterString(noteId)}" && version_number>${previousNumber}`;
    const path = `/api/collections/document_versions/records${queryString({
        filter,
        sort: "-version_number",
        perPage: 5,
        fields: "id,document,version_number,snapshot",
    })}`;
    const result = await pbGet<PBListResponse<PBVersionRecord>>(path, context);
    if (!result.ok) return undefined;

    for (const record of result.items ?? []) {
        if (!record || typeof record.id !== "string" || record.document !== noteId) continue;
        let snapshot: unknown = record.snapshot;
        if (typeof snapshot === "string") {
            try {
                snapshot = JSON.parse(snapshot) as unknown;
            } catch {
                continue;
            }
        }
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
        const candidate = snapshot as { title?: unknown; content?: unknown };
        if (candidate.content === before.content && candidate.title === before.title) {
            return record.id;
        }
    }
    return undefined;
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
    const previousVersion = await latestVersionNumber(write.context, note.id);

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
                publish: true,
            },
        );

        const versionId = await findVersionCreated(write.context, note.id, previousVersion, before);
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
            versionId,
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
    const previousVersion = await latestVersionNumber(write.context, note.id);

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
                publish: true,
            },
        );

        const versionId = await findVersionCreated(write.context, note.id, previousVersion, before);
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
            versionId,
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
    const previousVersion = await latestVersionNumber(write.context, note.id);
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
                publish: true,
            },
        );

        const versionId = await findVersionCreated(write.context, note.id, previousVersion, before);
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
            versionId,
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

/** Task DTO helper kept for tests and summaries. */
export function taskTarget(task: TaskDto): ChatEditTarget {
    return targetFor("task", task.id, task.title, task.boardId);
}
