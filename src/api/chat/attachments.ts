import { serverConfig } from "../../lib/config";
import type {
    AIChatAttachmentSettings,
    AIModelCapabilities,
} from "../../lib/ai/types";
import { sanitizeAttachmentRef, type ChatAttachmentKind, type ChatAttachmentRef, type PBChatAttachment } from "./types";
import {
    pbFetchFormWithToken,
    pbFetchWithToken,
    PocketBaseRequestError,
} from "./pocketbase";
import { getFileToken } from "../export/auth";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/** Hard ceiling independent of the admin setting; mirrors the config clamp. */
export const MAX_ATTACHMENT_FILES = 20;
/** PocketBase text field limit for the extracted text column. */
export const MAX_ATTACHMENT_TEXT_CHARS = 1_000_000;
const MAX_PDF_PAGES = 200;
const PDF_EXTRACT_TIMEOUT_MS = 15_000;
const FILE_FETCH_TIMEOUT_MS = 8_000;

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const SVG_EXTENSIONS = new Set([".svg", ".svgz"]);

/** A sanitized, client-safe attachment failure. Body text is never attached. */
export class ChatAttachmentError extends Error {
    status: number;
    code?: string;

    constructor(status: number, message: string, code?: string) {
        super(message);
        this.name = "ChatAttachmentError";
        this.status = status;
        this.code = code;
    }
}

export interface DetectedAttachment {
    kind: ChatAttachmentKind;
    mimeType: string;
    name: string;
}

export interface AttachmentBudget {
    bytes: number;
    text: number;
}

function mimeBase(value: string): string {
    return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionOf(name: string): string {
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index).toLowerCase() : "";
}

/** Remove path segments and control characters before a name is stored. */
export function sanitizeAttachmentName(value: string): string {
    const leaf = (value || "").split(/[\\/]/).pop() ?? "";
    const clean = leaf
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return clean.slice(0, 255) || "Attachment";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    if (bytes.length < signature.length) return false;
    for (let i = 0; i < signature.length; i += 1) {
        if (bytes[i] !== signature[i]) return false;
    }
    return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
    return new TextDecoder("latin1").decode(bytes.slice(start, start + length));
}

function imageMime(bytes: Uint8Array): string | null {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
    return null;
}

function decodeText(bytes: Uint8Array): string | null {
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        // Reject binary-looking content. Whitespace controls are allowed.
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
        return text;
    } catch {
        return null;
    }
}

function looksLikeSvg(text: string): boolean {
    const head = text.replace(/^\uFEFF/, "").slice(0, 4096).trimStart().toLowerCase();
    return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

/**
 * Classify an upload from its bytes. The declared MIME type is only an
 * additional signal; magic bytes decide images/PDF and text must decode as
 * UTF-8 without binary control characters.
 */
export function detectAttachment(
    bytes: Uint8Array,
    declaredType: string,
    filename: string,
): DetectedAttachment {
    if (bytes.length === 0) {
        throw new ChatAttachmentError(400, "The file is empty.", "empty_file");
    }

    const declared = mimeBase(declaredType);
    const name = sanitizeAttachmentName(filename);
    const extension = extensionOf(name);

    if (declared === "image/svg+xml" || SVG_EXTENSIONS.has(extension)) {
        throw new ChatAttachmentError(415, "SVG attachments are not supported.", "unsupported_type");
    }

    const image = imageMime(bytes);
    if (image) {
        if (declared && !GENERIC_MIME_TYPES.has(declared) && declared !== image && !(image === "image/jpeg" && declared === "image/jpg")) {
            throw new ChatAttachmentError(415, "The file does not match its declared type.", "unsupported_type");
        }
        return { kind: "image", mimeType: image, name };
    }

    if (ascii(bytes, 0, 5) === "%PDF-") {
        if (declared && !GENERIC_MIME_TYPES.has(declared) && declared !== "application/pdf" && declared !== "application/x-pdf") {
            throw new ChatAttachmentError(415, "The file does not match its declared type.", "unsupported_type");
        }
        return { kind: "pdf", mimeType: "application/pdf", name };
    }

    if (declared === "application/pdf" || declared === "application/x-pdf" || declared.startsWith("image/")) {
        throw new ChatAttachmentError(415, "The file does not match its declared type.", "unsupported_type");
    }

    const text = decodeText(bytes);
    if (text !== null) {
        if (looksLikeSvg(text)) {
            throw new ChatAttachmentError(415, "SVG attachments are not supported.", "unsupported_type");
        }

        const textLike = TEXT_MIME_TYPES.has(declared)
            || TEXT_EXTENSIONS.has(extension)
            || GENERIC_MIME_TYPES.has(declared);
        if (textLike) {
            const markdown = declared === "text/markdown"
                || declared === "text/x-markdown"
                || extension === ".md"
                || extension === ".markdown";
            return { kind: "text", mimeType: markdown ? "text/markdown" : "text/plain", name };
        }
    }

    throw new ChatAttachmentError(
        415,
        "Unsupported attachment type. Use PNG, JPEG, WebP, GIF, PDF, or a text/Markdown file.",
        "unsupported_type",
    );
}

/** Wrap extracted text so the model sees a clear, named data boundary. */
export function attachmentTextBlock(name: string, text: string): string {
    const safeName = sanitizeAttachmentName(name).replace(/["<>]/g, "_");
    return `<attachment name="${safeName}">\n${text}\n</attachment>`;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            task,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("Attachment extraction timed out")), timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

async function extractPdfText(bytes: Uint8Array, maxChars: number): Promise<string> {
    const limit = Math.max(0, Math.min(maxChars, MAX_ATTACHMENT_TEXT_CHARS));
    if (limit === 0) return "";

    const task = (async () => {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const loadingTask = pdfjs.getDocument({
            data: bytes.slice(),
            disableFontFace: true,
            isEvalSupported: false,
            useSystemFonts: false,
            useWorkerFetch: false,
            verbosity: 0,
        });
        let document: Awaited<typeof loadingTask.promise> | undefined;

        try {
            document = await loadingTask.promise;
            const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
            const chunks: string[] = [];
            let length = 0;

            for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
                const page = await document.getPage(pageNumber);
                const content = await page.getTextContent();
                const text = content.items
                    .map((item) => ("str" in item ? item.str : ""))
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();
                page.cleanup();

                if (text) {
                    chunks.push(text);
                    length += text.length + 2;
                    if (length >= limit) break;
                }
            }

            return chunks.join("\n\n").slice(0, limit);
        } finally {
            try {
                if (document) {
                    await document.destroy();
                } else {
                    await loadingTask.destroy();
                }
            } catch {
                // A failed parse may not have produced a destroyable document.
            }
        }
    })();

    try {
        return await withTimeout(task, PDF_EXTRACT_TIMEOUT_MS);
    } catch {
        // Scanned, encrypted, malformed, or timed-out PDFs keep the record with
        // empty extracted text; a model with file support can still read them.
        return "";
    }
}

/**
 * Extract text from a text or PDF attachment. Images return an empty string.
 * A scanned/empty PDF is valid and returns empty text.
 */
export async function extractAttachmentText(
    kind: ChatAttachmentKind,
    mimeType: string,
    bytes: Uint8Array,
    maxChars: number,
): Promise<string> {
    if (kind === "text") {
        const text = decodeText(bytes);
        if (text === null) return "";
        return text.slice(0, Math.max(0, Math.min(maxChars, MAX_ATTACHMENT_TEXT_CHARS)));
    }
    if (kind === "pdf" || mimeType === "application/pdf") {
        return extractPdfText(bytes, maxChars);
    }
    return "";
}

/** Enforce the per-send file count, per-file byte limit, and total byte cap. */
export function assertAttachmentLimits(
    records: ReadonlyArray<Pick<PBChatAttachment, "size">>,
    limits: AIChatAttachmentSettings,
): void {
    if (records.length > limits.maxFiles) {
        throw new ChatAttachmentError(
            400,
            `Too many attachments. The limit is ${limits.maxFiles}.`,
            "too_many_attachments",
        );
    }

    let total = 0;
    for (const record of records) {
        const size = Number(record.size);
        if (!Number.isFinite(size) || size < 0) {
            throw new ChatAttachmentError(400, "Attachment metadata is invalid.", "invalid_attachment");
        }
        if (size > limits.maxFileBytes) {
            throw new ChatAttachmentError(413, "That attachment is too large.", "too_large");
        }
        total += size;
    }

    if (total > limits.maxTotalBytes) {
        throw new ChatAttachmentError(413, "The attachments are too large together.", "too_large");
    }
}

/**
 * Reject attachments the selected model cannot use. PDFs are allowed without
 * native file support only when server-extracted text exists.
 */
export function assertModelSupportsAttachments(
    records: ReadonlyArray<Pick<PBChatAttachment, "kind" | "text" | "name">>,
    capabilities: AIModelCapabilities,
): void {
    for (const record of records) {
        if (record.kind === "image" && !capabilities.vision) {
            throw new ChatAttachmentError(
                415,
                "The selected model cannot read images. Choose a vision-capable model or remove the image.",
                "unsupported_model",
            );
        }
        if (record.kind === "pdf" && !capabilities.files && !(record.text ?? "").trim()) {
            throw new ChatAttachmentError(
                415,
                `The selected model cannot read PDFs and no text could be extracted from ${record.name}.`,
                "unsupported_model",
            );
        }
    }
}

/** Map a PocketBase attachment row to the public DTO. */
export function toAttachmentRef(record: PBChatAttachment): ChatAttachmentRef {
    const ref = sanitizeAttachmentRef(record);
    if (!ref) {
        throw new ChatAttachmentError(502, "The attachment record is unreadable.", "invalid_attachment");
    }
    return ref;
}

function normalizeIds(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of ids) {
        const id = typeof raw === "string" ? raw.trim() : "";
        if (!/^[A-Za-z0-9]{1,64}$/.test(id)) {
            throw new ChatAttachmentError(400, "One of the attachment ids is invalid.", "invalid_attachment");
        }
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }

    return result;
}

function attachmentFilter(userId: string, ids: string[]): string {
    const idFilter = ids.map((id) => `id="${id}"`).join(" || ");
    return `author="${userId}" && (${idFilter})`;
}

async function listAttachmentRecords(
    authHeader: string,
    userId: string,
    ids: string[],
): Promise<PBChatAttachment[]> {
    if (ids.length === 0) return [];
    const filter = encodeURIComponent(attachmentFilter(userId, ids));
    const perPage = Math.max(1, Math.min(ids.length, 500));
    const result = await pbFetchWithToken<{
        items: PBChatAttachment[];
    }>(
        `/api/collections/chat_attachments/records?filter=${filter}&perPage=${perPage}`,
        authHeader,
    );
    return Array.isArray(result.items) ? result.items : [];
}

function validateStoredRecords(records: PBChatAttachment[], userId: string): void {
    for (const record of records) {
        if (record.author !== userId) {
            throw new ChatAttachmentError(404, "Attachment not found.", "not_found");
        }
        const ref = sanitizeAttachmentRef(record);
        if (!ref) {
            throw new ChatAttachmentError(400, "Attachment metadata is invalid.", "invalid_attachment");
        }
        if (ref.kind === "image" && !IMAGE_MIME_TYPES.has(ref.mimeType)) {
            throw new ChatAttachmentError(400, "Attachment metadata is invalid.", "invalid_attachment");
        }
        if (ref.kind === "pdf" && ref.mimeType !== "application/pdf") {
            throw new ChatAttachmentError(400, "Attachment metadata is invalid.", "invalid_attachment");
        }
        if (ref.kind === "text" && !TEXT_MIME_TYPES.has(ref.mimeType)) {
            throw new ChatAttachmentError(400, "Attachment metadata is invalid.", "invalid_attachment");
        }
    }
}

/**
 * Validate draft attachment ids for a send. Ownership, unbound state, count,
 * size, and metadata are all checked before a conversation or SSE stream is
 * created. Another user's id is indistinguishable from a missing one.
 */
export async function resolveAttachments(
    authHeader: string,
    userId: string,
    ids: readonly string[],
    limits: AIChatAttachmentSettings,
): Promise<PBChatAttachment[]> {
    const uniqueIds = normalizeIds(ids);
    if (uniqueIds.length === 0) return [];

    if (!limits.enabled) {
        throw new ChatAttachmentError(403, "Attachments are disabled.", "attachments_disabled");
    }
    if (uniqueIds.length > limits.maxFiles || uniqueIds.length > MAX_ATTACHMENT_FILES) {
        throw new ChatAttachmentError(
            400,
            `Too many attachments. The limit is ${Math.min(limits.maxFiles, MAX_ATTACHMENT_FILES)}.`,
            "too_many_attachments",
        );
    }

    let records: PBChatAttachment[];
    try {
        records = await listAttachmentRecords(authHeader, userId, uniqueIds);
    } catch (error) {
        throw mapPocketBaseError(error, "Could not load attachments.");
    }

    if (records.length !== uniqueIds.length) {
        throw new ChatAttachmentError(404, "Attachment not found.", "not_found");
    }

    const byId = new Map(records.map((record) => [record.id, record]));
    const ordered = uniqueIds.map((id) => byId.get(id)).filter((record): record is PBChatAttachment => Boolean(record));
    if (ordered.length !== uniqueIds.length) {
        throw new ChatAttachmentError(404, "Attachment not found.", "not_found");
    }

    validateStoredRecords(ordered, userId);

    for (const record of ordered) {
        if (record.conversation || record.message) {
            throw new ChatAttachmentError(400, "One of the attachments is already in use.", "attachment_in_use");
        }
    }

    assertAttachmentLimits(ordered, limits);
    return ordered;
}

/**
 * Load bound attachment rows for conversation history. Missing rows are
 * skipped (the model sees an explicit omission marker) instead of failing the
 * whole turn.
 */
export async function loadAttachmentRecordsForHistory(
    authHeader: string,
    userId: string,
    ids: readonly string[],
    conversationId: string,
): Promise<PBChatAttachment[]> {
    let uniqueIds: string[];
    try {
        uniqueIds = normalizeIds(ids).slice(0, MAX_ATTACHMENT_FILES);
    } catch {
        return [];
    }
    if (uniqueIds.length === 0) return [];

    try {
        const records = await listAttachmentRecords(authHeader, userId, uniqueIds);
        const byId = new Map(
            records
                .filter((record) => record.author === userId && record.conversation === conversationId)
                .map((record) => [record.id, record]),
        );
        return uniqueIds
            .map((id) => byId.get(id))
            .filter((record): record is PBChatAttachment => Boolean(record));
    } catch {
        return [];
    }
}

/** Bind draft rows to the persisted user message after it has been created. */
export async function bindAttachmentsToMessage(
    authHeader: string,
    userId: string,
    ids: readonly string[],
    conversationId: string,
    messageId: string,
): Promise<void> {
    if (!userId) {
        throw new ChatAttachmentError(401, "Your session expired. Sign in again.");
    }
    const uniqueIds = normalizeIds(ids);
    for (const id of uniqueIds) {
        try {
            await pbFetchWithToken<PBChatAttachment>(
                `/api/collections/chat_attachments/records/${encodeURIComponent(id)}`,
                authHeader,
                {
                    method: "PATCH",
                    body: JSON.stringify({ conversation: conversationId, message: messageId }),
                },
            );
        } catch (error) {
            throw mapPocketBaseError(error, "Could not attach one of the files to the message.");
        }
    }
}

function attachmentFilename(record: PBChatAttachment): string {
    if (Array.isArray(record.file)) {
        return typeof record.file[0] === "string" ? record.file[0] : "";
    }
    return typeof record.file === "string" ? record.file : "";
}

/**
 * Download a protected attachment with a short-lived PocketBase file token.
 * The call is bounded so a slow storage backend cannot hold a chat request.
 */
export async function fetchAttachmentBytes(
    authHeader: string,
    record: PBChatAttachment,
): Promise<Uint8Array> {
    const filename = attachmentFilename(record);
    if (!filename) {
        throw new ChatAttachmentError(502, "The attachment file is unavailable.", "attachment_unavailable");
    }

    const signal = AbortSignal.timeout(FILE_FETCH_TIMEOUT_MS);
    let fileToken: string;
    try {
        fileToken = await getFileToken(authHeader, signal);
    } catch {
        throw new ChatAttachmentError(502, "The attachment file could not be read.", "attachment_unavailable");
    }

    const collection = record.collectionId || "chat_attachments";
    const url = `${POCKETBASE_URL}/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(fileToken)}`;

    let response: Response;
    try {
        response = await fetch(url, { signal });
    } catch {
        throw new ChatAttachmentError(502, "The attachment file could not be read.", "attachment_unavailable");
    }

    if (!response.ok) {
        throw new ChatAttachmentError(502, "The attachment file could not be read.", "attachment_unavailable");
    }

    try {
        return new Uint8Array(await response.arrayBuffer());
    } catch {
        throw new ChatAttachmentError(502, "The attachment file could not be read.", "attachment_unavailable");
    }
}

/**
 * Upload one validated file as a draft row. The caller token is used for the
 * PocketBase write; the superuser credential is never used here.
 */
export async function uploadChatAttachment(
    authHeader: string,
    userId: string,
    file: File,
    limits: AIChatAttachmentSettings,
): Promise<ChatAttachmentRef> {
    if (!limits.enabled) {
        throw new ChatAttachmentError(403, "Attachments are disabled.", "attachments_disabled");
    }
    if (!(file instanceof File)) {
        throw new ChatAttachmentError(400, "A file is required.", "invalid_attachment");
    }
    if (file.size <= 0) {
        throw new ChatAttachmentError(400, "The file is empty.", "empty_file");
    }
    if (file.size > limits.maxFileBytes) {
        throw new ChatAttachmentError(413, "That file is too large.", "too_large");
    }

    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
        throw new ChatAttachmentError(400, "The file could not be read.", "invalid_attachment");
    }
    if (bytes.length === 0) {
        throw new ChatAttachmentError(400, "The file is empty.", "empty_file");
    }
    if (bytes.length > limits.maxFileBytes) {
        throw new ChatAttachmentError(413, "That file is too large.", "too_large");
    }

    const detected = detectAttachment(bytes, file.type, file.name);
    const text = await extractAttachmentText(
        detected.kind,
        detected.mimeType,
        bytes,
        Math.min(limits.maxTextChars, MAX_ATTACHMENT_TEXT_CHARS),
    );

    const form = new FormData();
    const fileData = bytes.slice();
    form.set("author", userId);
    form.set("file", new File([fileData.buffer as ArrayBuffer], detected.name, { type: detected.mimeType }), detected.name);
    form.set("name", detected.name);
    form.set("mime_type", detected.mimeType);
    form.set("size", String(bytes.length));
    form.set("kind", detected.kind);
    if (text) form.set("text", text);

    let record: PBChatAttachment;
    try {
        record = await pbFetchFormWithToken<PBChatAttachment>(
            "/api/collections/chat_attachments/records",
            authHeader,
            form,
        );
    } catch (error) {
        throw mapPocketBaseError(error, "The attachment could not be saved.");
    }

    return toAttachmentRef(record);
}

/** Delete a draft row only. Bound attachments follow their message. */
export async function deleteDraftAttachment(
    authHeader: string,
    userId: string,
    id: string,
): Promise<void> {
    const attachmentId = normalizeIds([id])[0];
    if (!attachmentId) {
        throw new ChatAttachmentError(400, "Missing attachment id.", "invalid_attachment");
    }

    let record: PBChatAttachment;
    try {
        record = await pbFetchWithToken<PBChatAttachment>(
            `/api/collections/chat_attachments/records/${encodeURIComponent(attachmentId)}`,
            authHeader,
        );
    } catch (error) {
        throw mapPocketBaseError(error, "Attachment not found.");
    }

    if (record.author !== userId) {
        throw new ChatAttachmentError(404, "Attachment not found.", "not_found");
    }
    if (record.conversation || record.message) {
        throw new ChatAttachmentError(409, "Only draft attachments can be deleted.", "attachment_in_use");
    }

    try {
        await pbFetchWithToken<void>(
            `/api/collections/chat_attachments/records/${encodeURIComponent(attachmentId)}`,
            authHeader,
            { method: "DELETE" },
        );
    } catch (error) {
        throw mapPocketBaseError(error, "The attachment could not be deleted.");
    }
}

function mapPocketBaseError(error: unknown, fallback: string): ChatAttachmentError {
    if (error instanceof ChatAttachmentError) return error;
    if (error instanceof PocketBaseRequestError) {
        if (error.status === 401) return new ChatAttachmentError(401, "Your session expired. Sign in again.");
        if (error.status === 403) return new ChatAttachmentError(403, "You do not have access to that attachment.");
        if (error.status === 404) return new ChatAttachmentError(404, "Attachment not found.");
        if (error.status === 413) return new ChatAttachmentError(413, "That file is too large.", "too_large");
        if (error.status === 400 || error.status === 422) {
            return new ChatAttachmentError(400, "The attachment request was not valid.", "invalid_attachment");
        }
    }
    return new ChatAttachmentError(503, fallback, "attachment_unavailable");
}
