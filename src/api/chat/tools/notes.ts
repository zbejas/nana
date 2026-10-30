import { z } from "zod";
import { aiVisibilityConditions, loadAiVisibility, noteIsLocked } from "../../workspace/privacy";
import { pbGet, queryString, type PBListResponse, type ToolContext, type ToolFailure, type ToolResult } from "./http";
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
    offset: z.number().int().min(1).max(100_000).default(1).describe("1-based starting line, default 1."),
    limit: z.number().int().min(1).max(600).default(300).describe("Maximum lines to return, default 300, maximum 600."),
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
    published?: boolean;
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
    published: boolean;
}

const NOTE_LIST_FIELDS = "id,title,tags,updated,created,word_count,reading_time,folder,is_private,published,revision,author";
const NOTE_READ_FIELDS = `${NOTE_LIST_FIELDS},content`;

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
        published: Boolean(record.published),
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
    totalLines: number;
    hasMore: boolean;
    nextOffset: number | null;
    truncated: boolean;
    clippedLines: number;
    /** Optimistic-concurrency revision; pass it back to edit_note/append_note. */
    revision: number;
    /** Opaque token derived from title/content/tags/updated. */
    versionToken: string;
}

/**
 * Read a line window from one owned note. Output is bounded by both a line
 * limit and a character budget, and individual lines are clipped.
 */
export async function readNote(
    context: ToolContext,
    input: ReadNoteInput | unknown,
    abortSignal?: AbortSignal,
): Promise<ToolResult<ReadNoteResult>> {
    const parsed = readNoteInputSchema.safeParse(input);
    if (!parsed.success) {
        return invalidInput("The note read parameters were not valid.");
    }

    const { noteId, offset, limit } = parsed.data;
    if (!isValidRecordId(noteId)) {
        return invalidInput("That note id is not valid.");
    }

    const path = `/api/collections/documents/records/${encodeURIComponent(noteId)}${queryString({
        fields: NOTE_READ_FIELDS,
    })}`;

    const signal = createToolSignal(abortSignal);
    const result = await pbGet<PBNoteRecord>(path, context, signal);
    if (!result.ok) return result;

    const record: PBNoteRecord = result;
    if (!record || typeof record.id !== "string" || record.author !== context.userId) {
        return notFound();
    }

    const visibility = await loadAiVisibility(context, signal);
    if (!visibility.ok) return visibility;
    if (noteIsLocked(visibility, record)) return notFound();

    const rawContent = typeof record.content === "string" ? record.content : "";
    const rawBytes = new TextEncoder().encode(rawContent);
    const contentCapped = rawBytes.byteLength > MAX_NOTE_BYTES;
    const content = contentCapped
        ? new TextDecoder().decode(rawBytes.slice(0, MAX_NOTE_BYTES))
        : rawContent;
    const lines = content.split(/\r?\n/);

    const maxChars = clampInt(Math.round((limit / 300) * 6_000), 6_000, 12_000, 6_000);
    const startIndex = offset - 1;
    const output: string[] = [];
    let usedChars = 0;
    let clippedLines = 0;

    for (let index = startIndex; index < lines.length && output.length < limit; index++) {
        const originalLine = lines[index] ?? "";
        const clipped = originalLine.length > MAX_LINE_CHARS
            ? originalLine.slice(0, MAX_LINE_CHARS)
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
    const hasMore = startIndex + consumed < lines.length;

    const summary = summarizeNote(record);
    return {
        ok: true,
        ...summary,
        content: output.join("\n"),
        totalLines: lines.length,
        hasMore,
        nextOffset: hasMore ? startIndex + consumed + 1 : null,
        truncated: contentCapped || clippedLines > 0,
        clippedLines,
        revision: typeof record.revision === "number" && Number.isFinite(record.revision)
            ? record.revision
            : 0,
        versionToken: noteVersionToken(record),
    };
}
