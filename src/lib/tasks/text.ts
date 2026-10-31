/**
 * Markdown-to-text helpers for tasks.
 *
 * This module is intentionally free of browser and PocketBase imports so
 * server-side AI tools can use it without pulling in the client SDK.
 */

/** Strips common Markdown syntax and collapses the result to readable text. */
export function stripMarkdown(value: string): string {
  return (value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    .replace(/\[[ xX]\]\s*/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Short plain-text preview of a Markdown task description. */
export function plainTextExcerpt(value: string, length = 160): string {
  const plain = stripMarkdown(value ?? '').replace(/\s+/g, ' ');
  return plain.length > length ? `${plain.slice(0, length).trimEnd()}…` : plain;
}
