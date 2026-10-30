import { serverConfig } from "../../lib/config";

/** PocketBase access used by versioning with the caller's own token. */

export interface VersionReader {
    token: string;
    userId: string;
}

export interface VersionableDocument {
    id: string;
    title: string;
    content: string;
    tags: string[];
    folder: string;
    is_private: boolean;
    revision: number;
    author: string;
}

export type DocumentLoadResult =
    | { ok: true; document: VersionableDocument }
    | { ok: false; status: 404 | 502 };

const DOCUMENT_FIELDS = [
    "id",
    "title",
    "content",
    "tags",
    "folder",
    "is_private",
    "revision",
    "author",
    "deleted_at",
].join(",");

const TIMEOUT_MS = 15_000;

function documentUrl(id: string): string {
    return `${serverConfig.pocketbaseUrl}/api/collections/documents/records/${encodeURIComponent(id)}`;
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/**
 * Load a document the caller owns. Missing, trashed, foreign, or unreadable
 * records all look the same to the caller: no document.
 */
export async function loadOwnedDocument(
    reader: VersionReader,
    id: string,
): Promise<DocumentLoadResult> {
    if (!id) return { ok: false, status: 404 };

    const url = `${documentUrl(id)}?fields=${encodeURIComponent(DOCUMENT_FIELDS)}`;
    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                Authorization: reader.token,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        return { ok: false, status: 502 };
    }
    if (!response.ok) {
        // PocketBase hides foreign, trashed, and missing records behind
        // 401/403/404. Anything else is a workspace failure.
        return {
            ok: false,
            status: response.status === 401 || response.status === 403 || response.status === 404
                ? 404
                : 502,
        };
    }

    let record: Record<string, unknown>;
    try {
        const parsed = (await response.json()) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { ok: false, status: 502 };
        }
        record = parsed as Record<string, unknown>;
    } catch {
        return { ok: false, status: 502 };
    }

    if (record.author !== reader.userId) return { ok: false, status: 404 };
    if (text(record.deleted_at) !== "") return { ok: false, status: 404 };

    const revision = Number(record.revision);
    return {
        ok: true,
        document: {
            id: typeof record.id === "string" ? record.id : id,
            title: text(record.title),
            content: text(record.content),
            tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [],
            folder: text(record.folder),
            is_private: record.is_private === true,
            revision: Number.isFinite(revision) && revision > 0 ? Math.trunc(revision) : 0,
            author: text(record.author),
        },
    };
}

export interface ContentPatchResult {
    ok: boolean;
    record?: Record<string, unknown>;
    status: number;
    /** True when PocketBase rejected the loaded revision rather than the body. */
    conflict?: boolean;
}

/** Write only the Markdown body, passing the loaded revision for conflict checks. */
export async function patchDocumentContent(
    reader: VersionReader,
    id: string,
    content: string,
    revision: number,
): Promise<ContentPatchResult> {
    let response: Response;
    try {
        response = await fetch(documentUrl(id), {
            method: "PATCH",
            headers: {
                Authorization: reader.token,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ content, revision }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        return { ok: false, status: 502 };
    }

    if (!response.ok) {
        let conflict = response.status === 409;
        if (!conflict) {
            try {
                const payload = (await response.json()) as Record<string, unknown>;
                const message = String(payload.message ?? payload.error ?? "").toLowerCase();
                conflict = response.status === 400 && message.includes("changed since");
            } catch {
                // The status is still enough to report a generic failure.
            }
        }
        return { ok: false, status: response.status, conflict };
    }

    try {
        const parsed = (await response.json()) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { ok: false, status: 502 };
        }
        return { ok: true, record: parsed as Record<string, unknown>, status: response.status };
    } catch {
        return { ok: false, status: 502 };
    }
}
