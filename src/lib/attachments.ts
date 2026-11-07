/**
 * Attachment metadata shared by the UI, typed API, and MCP.
 *
 * PocketBase stores the generated filename on the record. The display name is
 * the original name with PocketBase's random suffix removed. Detection here is
 * extension-based and deliberately cheap; the server re-checks bytes before it
 * sends an attachment to a model.
 */

export type AttachmentKind = "image" | "pdf" | "text" | "file";

export interface AttachmentInfo {
    filename: string;
    name: string;
    extension: string;
    kind: AttachmentKind;
    mimeType: string;
}

const STORED_SUFFIX = /^(.+?)_[a-zA-Z0-9]+(\.[^.]+)$/;
const EXTENSION = /\.([a-z0-9]+)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    log: "text/plain",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "log"]);

/** Remove PocketBase's random filename suffix without touching the extension. */
export function attachmentDisplayName(filename: string): string {
    const value = (filename || "").split(/[\\/]/).pop() ?? "";
    const match = value.match(STORED_SUFFIX);
    return match && match[1] && match[2] ? `${match[1]}${match[2]}` : value || "Attachment";
}

export function attachmentExtension(filename: string): string {
    const match = attachmentDisplayName(filename).match(EXTENSION);
    return match?.[1]?.toLowerCase() ?? "";
}

export function attachmentMimeType(filename: string): string {
    return MIME_BY_EXTENSION[attachmentExtension(filename)] ?? "application/octet-stream";
}

export function attachmentKind(filename: string): AttachmentKind {
    const extension = attachmentExtension(filename);
    if (IMAGE_EXTENSIONS.has(extension)) return "image";
    if (extension === "pdf") return "pdf";
    if (TEXT_EXTENSIONS.has(extension)) return "text";
    return "file";
}

export function describeAttachment(filename: string): AttachmentInfo {
    return {
        filename,
        name: attachmentDisplayName(filename),
        extension: attachmentExtension(filename),
        kind: attachmentKind(filename),
        mimeType: attachmentMimeType(filename),
    };
}

/** Normalize a PocketBase file-field value into unique stored filenames. */
export function normalizeAttachmentNames(value: unknown, maxItems = 20): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") continue;
        const filename = item.trim();
        if (!filename || seen.has(filename)) continue;
        seen.add(filename);
        result.push(filename);
        if (result.length >= maxItems) break;
    }
    return result;
}
