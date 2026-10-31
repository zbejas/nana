/**
 * Shared Markdown normalization for live collaboration.
 *
 * The editor serializes Markdown without CRLF or trailing blank lines. Both
 * the browser session and the server room must seed Yjs with the same value or
 * every connect would look like a remote edit.
 */
export function normalizeCollabMarkdown(value: string | null | undefined): string {
    return (value ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}
