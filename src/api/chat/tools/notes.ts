import { z } from "zod";
import { aiVisibilityConditions, loadAiVisibility, noteIsLocked } from "../../workspace/privacy";
import { flushLiveNoteBeforeExternalWrite } from "../../workspace/live";
import { ApiError } from "../../workspace/errors";
import { pbGet, queryString, type PBListResponse, type ToolContext, type ToolFailure, type ToolResult } from "./http";
import type { ChatNoteScope } from "../types";
import {
    MAX_LINE_CHARS,
    MAX_NOTE_BYTES,
    clampInt,
    createToolSignal,
    escapeFilterString,
    isValidRecordId,
    normalizeStringList,
    truncate,
} from "./text";
import { noteVersionToken } from "./version";

// ── Shared input shapes ──────────────────────────────────────────────

const recordId = z.string().min(1).max(64);
const pageSchema = z.number().int().min(1).max(1000).default(1);
const perPageSchema = z.number().int().min(1).max(50).default(20);

export const listNotesInputSchema = z.object({
    query: z.string().max(200).optional().describe("Search note titles and tags. Never searches note bodies."),
    tag: z.string().max(60).optional().describe("Only notes carrying this tag."),
    folderId: z.string().min(1).max(64).optional().describe("Only notes in this folder id."),
    page: pageSchema.describe("1-based page, default 1."),
    perPage: perPageSchema.describe("Results per page, default 20, maximum 50."),
    sort: z.enum(["updated", "created", "title"]).default("updated").describe("Sort order."),
});

export type ListNotesInput = z.input<typeof listNotesInputSchema>;

export const readNoteInputSchema = z.object({
    noteId: recordId.describe("The note id from a list_notes result."),
    offset: z.number().int().min(1).default(1).describe(
        "1-based starting line, default 1. The total line count is checked after the note is read.",
    ),
    limit: z.number().int().min(1).max(2_000).optional().describe(
        "Optional line cap. Omit it to read the whole note (up to the tool character budget).",
    ),
});

export type ReadNoteInput = z.input<typeof readNoteInputSchema>;

// ── Record shapes ────────────────────────────────────────────────────

interface PBNoteRecord {
    id: string;
    title?: string;
    tags?: unknown;
    content?: string;
    updated?: string;
    created?: string;
    word_count?: number;
    reading_time?: number;
    folder?: string;
    is_private?: boolean;
    revision?: number;
    author?: string;
}

interface PBNoteSummary {
    id: string;
    title: string;
    tags: string[];
    updated: string;
    created: string;
    wordCount: number;
    readingTime: number;
    folderId: string | null;
    isPrivate: boolean;
}

const NOTE_LIST_FIELDS = "id,title,tags,updated,created,word_count,reading_time,folder,is_private,revision,author";
const NOTE_READ_FIELDS = `${NOTE_LIST_FIELDS},content`;
/** An omitted limit reads the whole note up to this budget. */
const FULL_READ_CHARS = 24_000;
/** Explicit windows keep a smaller floor so one requested line is useful. */
const MIN_WINDOW_CHARS = 12_000;

function invalidInput(message: string): ToolFailure {
    return { ok: false, code: "invalid_input", message };
}

function notFound(): ToolFailure {
    return { ok: false, code: "not_found", message: "That note was not found." };
}

function summarizeNote(record: PBNoteRecord): PBNoteSummary {
    return {
        id: record.id,
        title: truncate((record.title || "Untitled").trim(), 200),
        tags: normalizeStringList(record.tags),
        updated: record.updated || "",
        created: record.created || "",
        wordCount: typeof record.word_count === "number" ? record.word_count : 0,
        readingTime: typeof record.reading_time === "number" ? record.reading_time : 0,
        folderId: record.folder || null,
        isPrivate: Boolean(record.is_private),
    };
}

// ── list_notes ───────────────────────────────────────────────────────

export interface ListNotesResult {
    notes: PBNoteSummary[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
}

/**
 * Page through note metadata owned by the caller. Body text is never searched
 * or returned here; call read_note once a specific id is known.
 */
export async function listNotes(
    context: ToolContext,
    input: ListNotesInput | unknown,
    abortSignal?: AbortSignal,
): Promise<ToolResult<ListNotesResult>> {
    const parsed = listNotesInputSchema.safeParse(input);
    if (!parsed.success) {
        return invalidInput("The note search parameters were not valid.");
    }

    const { query, tag, folderId, page, perPage, sort } = parsed.data;
    if (folderId !== undefined && !isValidRecordId(folderId)) {
        return invalidInput("That folder id is not valid.");
    }

    const signal = createToolSignal(abortSignal);
    const visibility = await loadAiVisibility(context, signal);
    if (!visibility.ok) return visibility;

    const conditions = [`author="${escapeFilterString(context.userId)}"`];
    conditions.push(...aiVisibilityConditions(visibility));
    if (query && query.trim()) {
        const escaped = escapeFilterString(query.trim());
        conditions.push(`(title ~ "${escaped}" || tags ~ "${escaped}")`);
    }
    if (tag && tag.trim()) {
        conditions.push(`tags ~ "${escapeFilterString(tag.trim())}"`);
    }
    if (folderId) {
        conditions.push(`folder="${escapeFilterString(folderId)}"`);
    }

    const sortValue = sort === "created" ? "-created" : sort === "title" ? "title" : "-updated";
    const path = `/api/collections/documents/records${queryString({
        filter: conditions.join(" && "),
        sort: sortValue,
        page,
        perPage,
        fields: NOTE_LIST_FIELDS,
    })}`;

    const result = await pbGet<PBListResponse<PBNoteRecord>>(path, context, signal);
    if (!result.ok) return result;

    const items = Array.isArray(result.items) ? result.items : [];
    const notes = items
        .filter((record) => record && typeof record.id === "string")
        .map(summarizeNote);
    const resultPage = typeof result.page === "number" ? result.page : page;
    const resultPerPage = typeof result.perPage === "number" ? result.perPage : perPage;
    const totalItems = typeof result.totalItems === "number" ? result.totalItems : notes.length;
    const totalPages = typeof result.totalPages === "number" ? result.totalPages : 1;

    return {
        ok: true,
        notes,
        page: resultPage,
        perPage: resultPerPage,
        totalItems,
        totalPages,
        hasMore: resultPage < totalPages,
    };
}

// ── read_note ────────────────────────────────────────────────────────

export interface ReadNoteResult extends PBNoteSummary {
    content: string;
    /** Lines in the readable body. A byte-capped body may have a larger unknown tail. */
    totalLines: number;
    /** Lines included in this result, starting at `offset`. */
    returnedLines: number;
    /**
     * True only when this single result contains the whole note from line 1:
     * `offset === 1`, every line returned, no clipped line, and no byte-cap loss.
     * A tail-only or later window is never complete.
     */
    complete: boolean;
    /** True when more lines remain after the returned window in the readable body. */
    hasMore: boolean;
    /** Lines before the returned window that were not returned in this call. */
    omittedBefore: number;
    /** Lines after the returned window in the readable body that were not returned in this call. */
    omittedAfter: number;
    /** Total lines not returned in this call: `omittedBefore + omittedAfter`. */
    omittedLines: number;
    nextOffset: number | null;
    /** True only when the returned window itself is lossy (byte cap or clipped lines). */
    truncated: boolean;
    /** True when the note exceeded the byte read cap, so its tail cannot be read at all. */
    tailUnavailable: boolean;
    clippedLines: number;
    /** Present whenever the result is incomplete; explains what is missing or what to read next. */
    notice: string | null;
    /** Optimistic-concurrency revision; pass it back to edit_note/append_note. */
    revision: number;
    /** Opaque token derived from title/content/tags/updated. */
    versionToken: string;
}

/**
 * Read one owned note, or the one note bound to a shared-note chat scope.
 * Omitting `limit` returns the whole note up to the character budget. When the
 * note is too large, the result is explicitly marked incomplete and carries
 * the omitted-line count and next offset. Individual long lines are clipped
 * and reported so the model never treats a clipped line as a safe edit anchor.
 */
export async function readNote(
    context: ToolContext,
    input: ReadNoteInput | unknown,
    abortSignal?: AbortSignal,
    noteScope?: ChatNoteScope,
): Promise<ToolResult<ReadNoteResult>> {
    const parsed = readNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return invalidInput("The note read parameters were not valid.");
    }

    const { noteId, offset, limit: requestedLimit } = parsed.data;
    if (!isValidRecordId(noteId)) {
        return invalidInput("That note id is not valid.");
    }

    if (noteScope) {
        if (
            noteScope.documentId !== noteId
            || !Number.isFinite(noteScope.accessLevel)
            || noteScope.accessLevel < 1
        ) {
            return notFound();
        }
    }

    // Authorize before any live-room side effect. A caller without access must
    // not be able to flush someone else's room by guessing a note id.
    const accessPath = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({
        fields: "id,author,is_private,folder,deleted_at",
    })}`;
    const accessSignal = createToolSignal(abortSignal);
    const accessResult = await pbGet<PBNoteRecord>(accessPath, context, accessSignal);
    if (!accessResult.ok) return accessResult;

    const accessRecord: PBNoteRecord = accessResult;
    const owner = typeof accessRecord.id === "string" && accessRecord.author === context.userId;
    const scoped = Boolean(
        noteScope
        && accessRecord.id === noteScope.documentId
        && noteScope.accessLevel >= 1,
    );
    if (typeof accessRecord.id !== "string" || (!owner && !scoped)) {
        return notFound();
    }

    if (owner) {
        const visibility = await loadAiVisibility(context, accessSignal);
        if (!visibility.ok) return visibility;
        if (noteIsLocked(visibility, accessRecord)) return notFound();
    }

    // A live room owns the freshest body. Flush after authorization so the
    // model never gets content that is about to be replaced, and return the
    // normal conflict failure when the room could not persist. Give the flush
    // its own bounded signal so the later body read still has a full window.
    try {
        await flushLiveNoteBeforeExternalWrite(noteId, createToolSignal(abortSignal));
    } catch (error) {
        if (error instanceof ApiError) {
            return {
                ok: false,
                code: error.code === "conflict" ? "conflict" : "unavailable",
                message: error.message,
            };
        }
        return {
            ok: false,
            code: "unavailable",
            message: "The workspace is unavailable right now.",
        };
    }

    const path = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({
        fields: NOTE_READ_FIELDS,
    })}`;
    // Flushing can consume most of the first tool window; give the fresh read
    // its own bounded signal so a valid read does not fail on an older timer.
    const signal = createToolSignal(abortSignal);
    const result = await pbGet<PBNoteRecord>(path, context, signal);
    if (!result.ok) return result;

    const record: PBNoteRecord = result;
    if (typeof record.id !== "string") return notFound();
    if (owner && record.author !== context.userId) return notFound();
    if (!owner && !scoped) return notFound();

    const rawContent = typeof record.content === "string" ? record.content : "";
    const rawBytes = new TextEncoder().encode(rawContent);
    const contentCapped = rawBytes.byteLength > MAX_NOTE_BYTES;
    const content = contentCapped
        ? new TextDecoder().decode(rawBytes.slice(0, MAX_NOTE_BYTES))
        : rawContent;
    const lines = content.split(/\r?\n/);

    // The schema cannot know the note length, so validate the offset against
    // the actual readable body after loading it.
    if (offset > lines.length) {
        const bodyLabel = contentCapped ? "readable body" : "note";
        return invalidInput(
            `The ${bodyLabel} has ${lines.length} ${lines.length === 1 ? "line" : "lines"}; `
            + `offset ${offset} is past the end. Use an offset between 1 and ${lines.length}, `
            + "usually 1 to read the whole note.",
        );
    }

    const fullRead = requestedLimit === undefined;
    const limit = requestedLimit ?? Number.MAX_SAFE_INTEGER;
    const maxChars = fullRead
        ? FULL_READ_CHARS
        : clampInt(
            Math.round((limit / 300) * MIN_WINDOW_CHARS),
            MIN_WINDOW_CHARS,
            FULL_READ_CHARS,
            MIN_WINDOW_CHARS,
        );
    const startIndex = offset - 1;
    const output: string[] = [];
    let usedChars = 0;
    let clippedLines = 0;
    // A whole-note read may use the full character budget on one long line.
    // Explicit windows keep the smaller per-line safety cap.
    const lineCap = fullRead ? maxChars : MAX_LINE_CHARS;

    for (let index = startIndex; index < lines.length && output.length < limit; index++) {
        const originalLine = lines[index] ?? "";
        const clipped = originalLine.length > lineCap
            ? originalLine.slice(0, lineCap)
            : originalLine;
        if (clipped.length !== originalLine.length) clippedLines += 1;

        const separator = output.length > 0 ? 1 : 0;
        if (output.length > 0 && usedChars + separator + clipped.length > maxChars) {
            break;
        }

        output.push(clipped);
        usedChars += separator + clipped.length;
    }

    const consumed = output.length;
    const lastReturnedLine = startIndex + consumed;
    const hasMore = lastReturnedLine < lines.length;
    const omittedBefore = Math.max(0, Math.min(offset - 1, lines.length));
    const omittedAfter = Math.max(0, lines.length - lastReturnedLine);
    const omittedLines = omittedBefore + omittedAfter;
    const nextOffset = hasMore ? lastReturnedLine + 1 : null;
    // `complete` is whole-note truth for this single result: a later window,
    // clipped text, or an unavailable byte-cap tail all make it false.
    const complete = offset === 1
        && !hasMore
        && !contentCapped
        && clippedLines === 0;
    const notices: string[] = [];
    if (offset > 1) {
        notices.push(
            `Earlier lines were not returned: this window starts at line ${offset}, so `
            + `${omittedBefore} ${omittedBefore === 1 ? "line" : "lines"} before it `
            + `${omittedBefore === 1 ? "is" : "are"} omitted. `
            + "If you need the whole note, start again with offset=1.",
        );
    }
    if (hasMore) {
        notices.push(
            `Returned lines ${offset}-${lastReturnedLine} of ${lines.length}; `
            + `${omittedAfter} ${omittedAfter === 1 ? "line remains" : "lines remain"}. `
            + `Call read_note with offset=${nextOffset} to continue.`,
        );
    }
    if (contentCapped) {
        notices.push(
            `The note exceeds the ${MAX_NOTE_BYTES.toLocaleString("en-US")}-byte read cap; `
            + `the tail after line ${lines.length} is unavailable in this result and in every later window. `
            + "Do not claim the note is complete or edit from text that was not returned.",
        );
    }
    if (clippedLines > 0) {
        notices.push(
            `${clippedLines} ${clippedLines === 1 ? "line was" : "lines were"} clipped at `
            + `${lineCap.toLocaleString("en-US")} characters; the clipped remainder is not available `
            + "in a later window, and a clipped line is not a safe exact edit anchor.",
        );
    }

    const summary = summarizeNote(record);
    return {
        ok: true,
        ...summary,
        content: output.join("\n"),
        totalLines: lines.length,
        returnedLines: consumed,
        complete,
        hasMore,
        omittedBefore,
        omittedAfter,
        omittedLines,
        nextOffset,
        truncated: contentCapped || clippedLines > 0,
        tailUnavailable: contentCapped,
        clippedLines,
        notice: notices.length > 0 ? notices.join(" ") : null,
        revision: typeof record.revision === "number" && Number.isFinite(record.revision)
            ? record.revision
            : 0,
        versionToken: noteVersionToken(record),
    };
}
