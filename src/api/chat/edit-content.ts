import type { ChatEditContentChange } from "./types";

/**
 * Bounds for the event-only AI diff payload. The bodies never touch
 * `chat_edits`; they ride one SSE frame so the editor has an authoritative
 * pre/post image even when the Yjs broadcast and chat stream arrive in a
 * different order. A document over the cap still streams its edit card, with
 * `contentChangeOmitted: true` and no body text.
 */
export const MAX_EDIT_CONTENT_CHARS = 64 * 1024;
export const MAX_EDIT_CONTENT_TOTAL_CHARS = 128 * 1024;

export interface BoundedEditContentChange {
    contentChange?: ChatEditContentChange;
    contentChangeOmitted?: true;
}

function revisionOf(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const revision = Math.trunc(value);
    return revision >= 0 ? revision : undefined;
}

/**
 * Reduce an event-only body pair to the wire shape. Both bodies are required;
 * revisions are optional. Exceeding either the per-body or combined cap drops
 * both bodies and sets the flag instead of truncating a diff source.
 */
export function boundEditContentChange(
    change: ChatEditContentChange | null | undefined,
): BoundedEditContentChange {
    if (!change || typeof change.before !== "string" || typeof change.after !== "string") {
        return {};
    }

    const before = change.before;
    const after = change.after;
    if (
        before.length > MAX_EDIT_CONTENT_CHARS
        || after.length > MAX_EDIT_CONTENT_CHARS
        || before.length + after.length > MAX_EDIT_CONTENT_TOTAL_CHARS
    ) {
        return { contentChangeOmitted: true };
    }

    const beforeRevision = revisionOf(change.beforeRevision);
    const afterRevision = revisionOf(change.afterRevision);
    return {
        contentChange: {
            before,
            after,
            ...(beforeRevision !== undefined ? { beforeRevision } : {}),
            ...(afterRevision !== undefined ? { afterRevision } : {}),
        },
    };
}
