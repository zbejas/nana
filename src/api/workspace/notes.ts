import { generateSlug } from "../../lib/documents/utils";
import { sanitizeHtml } from "../../lib/sanitize";
import { escapeFilterString } from "../chat/tools/text";
import { noteVersionToken } from "../chat/tools/version";
import type { ChatNoteScope } from "../chat/types";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { ApiError, conflict, notFound, upstream } from "./errors";
import { folderIsLocked, recordIsLocked, workspaceVisibilityConditions } from "./privacy";
import {
    adoptLiveNoteContent,
    adoptLiveNoteRevision,
    flushLiveNoteBeforeExternalWrite,
} from "./live";
import {
    assertFolderVisible,
    assertRecordId,
    assertWritable,
    clampPaging,
    normalizeFolderId,
    normalizeStringArray,
    unwrap,
    visibilityFor,
} from "./shared";
import type {
    DeleteNoteResult,
    ListResult,
    NoteDto,
    NoteSort,
    NoteSummaryDto,
    Surface,
} from "./types";

export interface PBNoteRecord {
    id: string;
    title?: string;
    slug?: string;
    content?: string;
    tags?: unknown;
    word_count?: number;
    reading_time?: number;
    folder?: string;
    is_private?: boolean;
    is_public?: boolean;
    revision?: number;
    author?: string;
    created?: string;
    updated?: string;
}

/** Full pre-edit note state used by the AI undo path. */
export interface NoteSnapshot {
    title: string;
    content: string;
    tags: string[];
    folder: string;
    isPrivate: boolean;
}

export interface NoteEditOptions {
    /** The revision the caller read; stale revisions are rejected before writing. */
    revision: number;
    /** Optional opaque token returned by read_note. */
    versionToken?: string;
    /** Section edits pre-sanitize the fragments and must not reformat the note. */
    sanitizeContent?: boolean;
    /** Shared-note chat scope; non-owners may write only the bound document. */
    noteScope?: ChatNoteScope;
}

export interface NoteEditResult {
    note: NoteDto;
    revision: number;
    previous: NoteSnapshot;
    versionToken: string;
}

export interface ListNotesParams {
    query?: string;
    tag?: string;
    folderId?: string;
    page?: number;
    perPage?: number;
    sort?: NoteSort;
}

export interface CreateNoteInput {
    title?: string;
    content?: string;
    tags?: string[];
    folderId?: string | null;
    isPrivate?: boolean;
}

export interface UpdateNoteInput {
    title?: string;
    content?: string;
    tags?: string[];
    folderId?: string | null;
    isPrivate?: boolean;
}

const NOTE_METADATA_FIELDS = [
    "id",
    "title",
    "tags",
    "folder",
    "is_private",
    "is_public",
    "revision",
    "word_count",
    "reading_time",
    "created",
    "updated",
].join(",");

const NOTE_FIELDS = `${NOTE_METADATA_FIELDS},slug,content,author`;

function noteTitle(record: PBNoteRecord): string {
    return (record.title || "Untitled").trim() || "Untitled";
}

function toNoteSummary(record: PBNoteRecord): NoteSummaryDto {
    return {
        id: record.id,
        title: noteTitle(record),
        tags: normalizeStringArray(record.tags),
        folderId: record.folder || null,
        isPrivate: record.is_private === true,
        isPublic: record.is_public === true,
        wordCount: typeof record.word_count === "number" ? record.word_count : 0,
        readingTime: typeof record.reading_time === "number" ? record.reading_time : 0,
        created: record.created || "",
        updated: record.updated || "",
    };
}

function toNoteDto(record: PBNoteRecord): NoteDto {
    return {
        ...toNoteSummary(record),
        slug: record.slug || "",
        content: record.content || "",
    };
}

function noteRevision(record: PBNoteRecord): number {
    return typeof record.revision === "number" && Number.isFinite(record.revision)
        ? record.revision
        : 0;
}

function snapshotNote(record: PBNoteRecord): NoteSnapshot {
    return {
        title: noteTitle(record),
        content: record.content || "",
        tags: normalizeStringArray(record.tags),
        folder: record.folder || "",
        isPrivate: record.is_private === true,
    };
}

interface NoteRecordScope {
    noteScope?: ChatNoteScope;
    /** True for write tools; shared access must be edit level. */
    requireEdit?: boolean;
}

function scopeAllows(scope: ChatNoteScope | undefined, noteId: string, requireEdit: boolean): boolean {
    if (!scope) return false;
    if (scope.documentId !== noteId) return false;
    return requireEdit ? scope.accessLevel >= 3 : scope.accessLevel >= 1;
}

async function loadNoteRecord(
    context: ToolContext,
    id: string,
    scope?: NoteRecordScope,
): Promise<PBNoteRecord> {
    const noteId = assertRecordId(id, "That note id is not valid.");
    const noteScope = scope?.noteScope;
    const requireEdit = scope?.requireEdit === true;

    if (noteScope && !scopeAllows(noteScope, noteId, requireEdit)) {
        throw notFound();
    }

    const path = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({
        fields: NOTE_FIELDS,
    })}`;
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context));
    const owner = typeof record.id === "string" && record.author === context.userId;
    if (!owner && !(noteScope && scopeAllows(noteScope, record.id, requireEdit))) {
        throw notFound();
    }
    return record;
}

/**
 * List note metadata owned by the caller. Searches title and tags only; note
 * bodies never enter a list response. AI adds the privacy filter.
 */
export async function listNotes(
    context: ToolContext,
    surface: Surface = "user",
    params: ListNotesParams = {},
): Promise<ListResult<NoteSummaryDto>> {
    const { page, perPage } = clampPaging(params.page, params.perPage, 50);
    const conditions = [`author="${escapeFilterString(context.userId)}"`];

    const queryText = typeof params.query === "string" ? params.query.trim().slice(0, 200) : "";
    if (queryText) {
        const escaped = escapeFilterString(queryText);
        conditions.push(`(title ~ "${escaped}" || tags ~ "${escaped}")`);
    }

    const tag = typeof params.tag === "string" ? params.tag.trim().slice(0, 60) : "";
    if (tag) conditions.push(`tags ~ "${escapeFilterString(tag)}"`);

    const folderId = normalizeFolderId(params.folderId);
    if (folderId) {
        conditions.push(`folder="${escapeFilterString(assertRecordId(folderId, "That folder id is not valid."))}"`);
    }

    const visibility = await visibilityFor(context, surface);
    conditions.push(...workspaceVisibilityConditions(visibility, surface));

    const sort = params.sort === "created"
        ? "-created"
        : params.sort === "title"
            ? "title"
            : "-updated";

    const path = `/api/collections/documents/records${queryString({
        filter: conditions.join(" && "),
        sort,
        page,
        perPage,
        fields: NOTE_METADATA_FIELDS,
    })}`;
    const result = unwrap(await pbRequest<PBListResponse<PBNoteRecord>>(path, context));
    const items = (Array.isArray(result.items) ? result.items : [])
        .filter((record) => record && typeof record.id === "string")
        .map(toNoteSummary);

    return {
        items,
        page: typeof result.page === "number" ? result.page : page,
        perPage: typeof result.perPage === "number" ? result.perPage : perPage,
        totalItems: typeof result.totalItems === "number" ? result.totalItems : items.length,
        totalPages: typeof result.totalPages === "number" ? result.totalPages : 1,
    };
}

/** Read one owned note, including content. Hidden or out-of-scope notes are not found. */
export async function getNote(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<NoteDto> {
    const record = await loadNoteRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, record)) throw notFound();
    return toNoteDto(record);
}

/** Create a note owned by the caller. Folder relations are validated. */
export async function createNote(
    context: ToolContext,
    surface: Surface = "user",
    input: CreateNoteInput = {},
): Promise<NoteDto> {
    assertWritable(context);

    const title = (input.title || "").trim() || "Untitled";
    const folderId = normalizeFolderId(input.folderId);
    const visibility = await visibilityFor(context, surface);

    if (folderId) {
        await assertFolderVisible(context, surface, folderId, visibility);
    } else if (!visibility.rootAllowed) {
        throw notFound();
    }

    const content = input.content !== undefined ? await sanitizeHtml(input.content) : "";
    const body: Record<string, unknown> = {
        title,
        slug: generateSlug(title) || "untitled",
        content,
        tags: normalizeStringArray(input.tags),
        author: context.userId,
        is_private: input.isPrivate === true,
    };
    if (folderId) body.folder = folderId;

    const path = "/api/collections/documents/records";
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context, { method: "POST", body }));
    return toNoteDto(record);
}

/**
 * Update mutable note fields. Title changes regenerate the slug and content is
 * always sanitized before it persists. Attachments are intentionally out of
 * scope for this API.
 */
export async function updateNote(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    patch: UpdateNoteInput,
): Promise<NoteDto> {
    assertWritable(context);

    // A content write must see every keystroke the room has already accepted.
    // Metadata-only changes can proceed because the room reconciles a revision
    // bump without touching the body.
    if (patch.content !== undefined) {
        await flushLiveNoteBeforeExternalWrite(id);
    }

    const current = await loadNoteRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.title !== undefined) {
        const title = (patch.title || "").trim() || "Untitled";
        body.title = title;
        body.slug = generateSlug(title) || "untitled";
        changed = true;
    }
    if (patch.content !== undefined) {
        body.content = await sanitizeHtml(patch.content);
        changed = true;
    }
    if (patch.tags !== undefined) {
        body.tags = normalizeStringArray(patch.tags);
        changed = true;
    }
    if (patch.isPrivate !== undefined) {
        body.is_private = patch.isPrivate === true;
        changed = true;
    }
    if (patch.folderId !== undefined) {
        const folderId = normalizeFolderId(patch.folderId);
        if (folderId) {
            await assertFolderVisible(context, surface, folderId, visibility);
            body.folder = folderId;
        } else {
            if (!visibility.rootAllowed) throw notFound();
            body.folder = "";
        }
        changed = true;
    }

    if (!changed) return toNoteDto(current);

    const path = `/api/collections/documents/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context, { method: "PATCH", body }));

    if (patch.content !== undefined) {
        const storedContent = typeof record.content === "string"
            ? record.content
            : typeof body.content === "string"
                ? body.content
                : current.content ?? "";
        await adoptLiveNoteContent(current.id, storedContent, noteRevision(record));
    } else {
        adoptLiveNoteRevision(current.id, noteRevision(record));
    }
    return toNoteDto(record);
}

/**
 * Revision-aware note write for the AI edit tools.
 *
 * The caller must pass the revision (and optionally the version token) it read.
 * A mismatch is a `conflict` before PocketBase is touched. Content is normally
 * sanitized, but section edits pre-sanitize their fragments so untouched
 * sections stay byte-identical. AI writes also carry `X-Nana-Actor: ai`.
 */
export async function editNoteRecord(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    patch: UpdateNoteInput,
    options: NoteEditOptions,
): Promise<NoteEditResult> {
    assertWritable(context);

    // AI section edits read the body and revision before writing. Flush the
    // room first so a pending keystroke cannot be missed or overwritten.
    await flushLiveNoteBeforeExternalWrite(id);

    const current = await loadNoteRecord(context, id, {
        noteScope: options.noteScope,
        requireEdit: Boolean(options.noteScope),
    });
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

    const currentRevision = noteRevision(current);
    const currentToken = noteVersionToken(current);
    if (options.versionToken && options.versionToken !== currentToken) {
        throw conflict("This note changed since it was read. Read it again and retry.");
    }
    if (options.revision !== currentRevision) {
        throw conflict("This note changed since it was read. Read it again and retry.");
    }

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.title !== undefined) {
        const title = (patch.title || "").trim() || "Untitled";
        body.title = title;
        body.slug = generateSlug(title) || "untitled";
        changed = true;
    }
    if (patch.content !== undefined) {
        body.content = options.sanitizeContent === false
            ? patch.content
            : await sanitizeHtml(patch.content);
        changed = true;
    }
    if (patch.tags !== undefined) {
        body.tags = normalizeStringArray(patch.tags);
        changed = true;
    }
    if (patch.isPrivate !== undefined) {
        body.is_private = patch.isPrivate === true;
        changed = true;
    }
    if (patch.folderId !== undefined) {
        const folderId = normalizeFolderId(patch.folderId);
        if (folderId) {
            await assertFolderVisible(context, surface, folderId, visibility);
            body.folder = folderId;
        } else {
            if (!visibility.rootAllowed) throw notFound();
            body.folder = "";
        }
        changed = true;
    }

    if (!changed) {
        return {
            note: toNoteDto(current),
            revision: currentRevision,
            previous: snapshotNote(current),
            versionToken: currentToken,
        };
    }

    // The migration and revision hook own the actual bump, but sending the
    // revision both enforces optimistic concurrency and unlocks AI writes.
    body.revision = currentRevision;

    const path = `/api/collections/documents/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context, { method: "PATCH", body }));

    // Content adoption happens in the chat write tool after the section result
    // is known. Metadata-only edits advance the room revision here so the next
    // flush does not self-conflict.
    if (patch.content === undefined) {
        adoptLiveNoteRevision(current.id, noteRevision(record));
    }

    return {
        note: toNoteDto(record),
        revision: noteRevision(record),
        previous: snapshotNote(current),
        versionToken: noteVersionToken(record),
    };
}

/**
 * Restore a pre-edit snapshot through the same revision-aware update path.
 * Used by chat undo; the snapshot comes from `chat_edits.operations.before`.
 */
export async function restoreNoteSnapshot(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    snapshot: NoteSnapshot,
    revision: number,
    expectedUpdated?: string,
    noteScope?: ChatNoteScope,
): Promise<{ note: NoteDto; revision: number; versionToken: string }> {
    assertWritable(context);

    await flushLiveNoteBeforeExternalWrite(id);
    const current = await loadNoteRecord(context, id, {
        noteScope,
        requireEdit: Boolean(noteScope),
    });
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

    const currentRevision = noteRevision(current);
    if (revision !== currentRevision) {
        throw conflict("This note changed after Nana's edit, so it can no longer be undone safely.");
    }
    if (expectedUpdated && current.updated && current.updated !== expectedUpdated) {
        throw conflict("This note changed after Nana's edit, so it can no longer be undone safely.");
    }

    let folder = snapshot.folder;
    if (folder) {
        if (folderIsLocked(visibility, folder)) {
            folder = "";
        } else {
            try {
                await assertFolderVisible(context, surface, folder, visibility);
            } catch (error) {
                // The folder was trashed or deleted after the edit. Restore the
                // note at the root rather than failing the whole undo.
                if (!(error instanceof ApiError) || error.status !== 404) throw error;
                folder = "";
            }
        }
    }

    const body: Record<string, unknown> = {
        title: snapshot.title,
        slug: generateSlug(snapshot.title) || "untitled",
        content: snapshot.content,
        tags: normalizeStringArray(snapshot.tags),
        is_private: snapshot.isPrivate === true,
        folder,
        revision: currentRevision,
    };

    const path = `/api/collections/documents/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context, { method: "PATCH", body }));

    const restoredContent = typeof record.content === "string"
        ? record.content
        : snapshot.content;
    await adoptLiveNoteContent(current.id, restoredContent, noteRevision(record));

    return {
        note: toNoteDto(record),
        revision: noteRevision(record),
        versionToken: noteVersionToken(record),
    };
}

/** Move a note to a folder, or to the root with an empty/null folder id. */
export async function moveNote(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    folderId: string | null,
): Promise<NoteDto> {
    return updateNote(context, surface, id, { folderId });
}

/**
 * Move a note to trash through the PocketBase trash route. Notes have no
 * permanent-delete path in this API.
 */
export async function deleteNote(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<DeleteNoteResult> {
    assertWritable(context);

    const current = await loadNoteRecord(context, id);
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, current)) throw notFound();

    const result = unwrap(await pbRequest<{ trashDocumentId?: string }>(
        "/api/trash/move-document",
        context,
        { method: "POST", body: { documentId: current.id } },
    ));
    if (typeof result.trashDocumentId !== "string" || !result.trashDocumentId) {
        throw upstream("The note could not be moved to trash.");
    }
    return { trashDocumentId: result.trashDocumentId };
}

/** Shared with task creation: resolve a note the caller may reference. */
export async function loadVisibleNoteReference(
    context: ToolContext,
    surface: Surface,
    id: string,
    fields = "id,title,content,tags,folder,is_private,author",
): Promise<PBNoteRecord> {
    const noteId = assertRecordId(id, "That note id is not valid.");
    const path = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({ fields })}`;
    const record = unwrap(await pbRequest<PBNoteRecord>(path, context));
    if (typeof record.id !== "string" || record.author !== context.userId) {
        throw notFound();
    }
    const visibility = await visibilityFor(context, surface);
    if (recordIsLocked(visibility, surface, record)) throw notFound();
    return record;
}
