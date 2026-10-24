/**
 * Small, dependency-free helpers shared by the chat read tools.
 *
 * Everything here is deliberately pure: no I/O, no logging, no auth.
 */

/** Maximum time a single read tool may spend talking to PocketBase. */
export const TOOL_TIMEOUT_MS = 8_000;

/** A note body larger than this is not loaded into a tool result. */
export const MAX_NOTE_BYTES = 2_000_000;

/** Longest single line returned by read_note. */
export const MAX_LINE_CHARS = 2_000;

/**
 * Escape a value for interpolation inside a PocketBase filter string.
 * PocketBase filters use double-quoted string literals, where `\` and `"`
 * are the only characters that need escaping.
 */
export function escapeFilterString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * PocketBase record identifiers are short alphanumeric strings. Refusing
 * anything else keeps IDs out of filters and turns malformed model input into
 * a clean `invalid_input` result.
 */
export function isValidRecordId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9]{1,64}$/.test(value);
}

/** Truncate a string to `max` characters without splitting surrogate pairs. */
export function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Decode the handful of HTML entities that commonly appear in task notes. */
function decodeBasicEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

/**
 * Produce a short plain-text excerpt from Markdown/HTML content.
 * Removes script/style blocks, tags, code fences, images, links, headings and
 * emphasis markers, then collapses whitespace.
 */
export function plainTextExcerpt(value: string, max = 400): string {
    const withoutBlocks = value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/~~~[\s\S]*?~~~/g, " ");

    const withoutTags = withoutBlocks.replace(/<[^>]+>/g, " ");
    const withoutMarkdown = withoutTags
        .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s{0,3}>\s?/gm, "")
        .replace(/[*_~`]/g, "");

    const collapsed = decodeBasicEntities(withoutMarkdown)
        .replace(/\s+/g, " ")
        .trim();

    return truncate(collapsed, max);
}

/** Normalise a PocketBase JSON field into a list of short strings. */
export function normalizeStringList(value: unknown, maxItems = 20, maxChars = 40): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of value) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(truncate(trimmed, maxChars));
        if (result.length >= maxItems) break;
    }

    return result;
}

/** Clamp a finite integer to a range, falling back to `fallback` otherwise. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Build a signal that aborts after the tool timeout, optionally chained to the
 * model's own abort signal so a cancelled generation also stops tool work.
 */
export function createToolSignal(external?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
    if (!external) return timeout;
    return AbortSignal.any([timeout, external]);
}
