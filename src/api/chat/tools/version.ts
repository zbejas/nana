import { createHash } from "node:crypto";

/**
 * Optimistic-concurrency token for a note.
 *
 * The token is derived from the fields the editor and the AI both change:
 * title, body, tags, and the record's `updated` timestamp. It is deliberately
 * opaque so a model can pass it back without interpreting it, and it changes
 * on every save even when the model accidentally repeats the same content.
 */
export function noteVersionToken(record: {
    title?: unknown;
    content?: unknown;
    tags?: unknown;
    updated?: unknown;
}): string {
    const title = typeof record.title === "string" ? record.title : "";
    const content = typeof record.content === "string" ? record.content : "";
    const tags = Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
    const updated = typeof record.updated === "string" ? record.updated : "";

    const canonical = JSON.stringify([title, content, tags, updated]);
    return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** Accept either the numeric revision or the opaque version token. */
export function revisionMatches(
    expected: number | string,
    current: { revision: number; versionToken: string },
): boolean {
    if (typeof expected === "number") return expected === current.revision;
    const value = expected.trim();
    if (!value) return false;
    if (value === current.versionToken) return true;
    // Be forgiving when a model serialises the revision as a string.
    return /^\d+$/.test(value) && Number(value) === current.revision;
}
