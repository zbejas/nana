/**
 * Pure helpers for the Markdown editor. They stay free of React and Milkdown so
 * unit tests can cover the serialization and scroll contracts.
 */

/** Serialized Markdown always loses CRLF and trailing blank lines. */
export function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

export function isSameMarkdown(left: string, right: string): boolean {
  return normalizeMarkdown(left) === normalizeMarkdown(right);
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Replace every fenced code block with one placeholder line. Blank lines
 * inside a fence are content the editor serializes verbatim, so the prose
 * canonicalization below must not touch them. An unclosed fence masks the
 * rest of the body, which is stricter but never looser.
 */
function maskFencedCode(markdown: string): { masked: string; blocks: string[] } {
  const lines = markdown.split('\n');
  const masked: string[] = [];
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const opening = FENCE_PATTERN.exec(lines[index]!);
    if (!opening) {
      masked.push(lines[index]!);
      index += 1;
      continue;
    }

    const marker = opening[1]!;
    let end = index + 1;
    while (end < lines.length) {
      const closing = FENCE_PATTERN.exec(lines[end]!);
      if (
        closing
        && closing[1]![0] === marker[0]
        && closing[1]!.length >= marker.length
        && closing[2]!.trim() === ''
      ) {
        break;
      }
      end += 1;
    }

    const blockEnd = Math.min(end, lines.length - 1);
    blocks.push(lines.slice(index, blockEnd + 1).join('\n'));
    masked.push(`\u0000${blocks.length - 1}\u0000`);
    index = blockEnd + 1;
  }

  return { masked: masked.join('\n'), blocks };
}

/**
 * Canonical form of a body as the rendered editor serializes it. `normalizeMarkdown`
 * already removes CRLF and trailing newlines; outside fenced code the only
 * remaining blank-line difference is a run of three or more newlines, which
 * the editor writes as one empty line (`\n\n`). Fenced-code bodies stay exact,
 * so the comparison cannot make two different code bodies match, and every
 * non-blank character is always compared exactly.
 */
export function canonicalEditorMarkdown(value: string): string {
  const { masked, blocks } = maskFencedCode(normalizeMarkdown(value));
  return masked
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)] ?? '');
}

/** Exact body equality under the editor's blank-line serialization. */
export function isSameEditorMarkdown(left: string, right: string): boolean {
  return canonicalEditorMarkdown(left) === canonicalEditorMarkdown(right);
}

/**
 * Fraction of a scroll container that has been consumed. A container with no
 * overflow always reports 0 so callers never divide by zero.
 */
export function computeScrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = scrollHeight - clientHeight;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  const ratio = scrollTop / maxScroll;
  return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

/** Inverse of `computeScrollRatio`, used to mirror one pane into the other. */
export function scrollTopForRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = scrollHeight - clientHeight;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return Math.round(clamped * maxScroll);
}

export type EditorActionId =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'quote'
  | 'code-block'
  | 'link'
  | 'divider'
  | 'table'
  | 'undo'
  | 'redo';

export interface EditorActionDefinition {
  id: EditorActionId;
  label: string;
  shortcut?: string;
}

/** Toolbar order. Kept as data so the toolbar and slash menu cannot drift. */
export const EDITOR_ACTIONS: readonly EditorActionDefinition[] = [
  { id: 'bold', label: 'Bold', shortcut: 'Mod+B' },
  { id: 'italic', label: 'Italic', shortcut: 'Mod+I' },
  { id: 'strike', label: 'Strikethrough', shortcut: 'Mod+Shift+X' },
  { id: 'inline-code', label: 'Inline code', shortcut: 'Mod+E' },
  { id: 'heading-1', label: 'Heading 1', shortcut: 'Mod+Alt+1' },
  { id: 'heading-2', label: 'Heading 2', shortcut: 'Mod+Alt+2' },
  { id: 'heading-3', label: 'Heading 3', shortcut: 'Mod+Alt+3' },
  { id: 'bullet-list', label: 'Bullet list' },
  { id: 'ordered-list', label: 'Numbered list' },
  { id: 'task-list', label: 'Task list' },
  { id: 'quote', label: 'Quote' },
  { id: 'code-block', label: 'Code block' },
  { id: 'link', label: 'Link', shortcut: 'Mod+K' },
  { id: 'undo', label: 'Undo', shortcut: 'Mod+Z' },
  { id: 'redo', label: 'Redo', shortcut: 'Mod+Shift+Z' },
] as const;

export interface SlashMenuItem {
  id: EditorActionId;
  label: string;
  hint: string;
  keywords?: string;
}

export const SLASH_MENU_ITEMS: readonly SlashMenuItem[] = [
  { id: 'paragraph', label: 'Text', hint: 'Plain paragraph', keywords: 'paragraph body' },
  { id: 'heading-1', label: 'Heading 1', hint: 'Large section title', keywords: 'h1 title' },
  { id: 'heading-2', label: 'Heading 2', hint: 'Section heading', keywords: 'h2 title' },
  { id: 'heading-3', label: 'Heading 3', hint: 'Subsection heading', keywords: 'h3 title' },
  { id: 'bullet-list', label: 'Bullet list', hint: 'Unordered list', keywords: 'ul bullets' },
  { id: 'ordered-list', label: 'Numbered list', hint: 'Ordered list', keywords: 'ol numbers' },
  { id: 'task-list', label: 'Task list', hint: 'Checklist item', keywords: 'todo checkbox' },
  { id: 'quote', label: 'Quote', hint: 'Block quote', keywords: 'blockquote' },
  { id: 'code-block', label: 'Code block', hint: 'Fenced code', keywords: 'pre snippet' },
  { id: 'table', label: 'Table', hint: '3 × 3 table', keywords: 'grid rows columns' },
  { id: 'divider', label: 'Divider', hint: 'Horizontal rule', keywords: 'hr line separator' },
] as const;

export function filterSlashMenuItems(query: string): SlashMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SLASH_MENU_ITEMS];
  return SLASH_MENU_ITEMS.filter((item) => {
    const haystack = `${item.label} ${item.hint} ${item.keywords ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Only http(s), mailto, and same-origin paths are accepted from the link
 * popover. The Markdown renderer sanitizes too; this stops dangerous links
 * from ever reaching the document.
 */
export function safeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith('#')) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (/^[\w.-]+(\/|$)/.test(href) && !href.includes(':')) return href;
  return null;
}

/** Short label for a link's text when the user applies it to an empty selection. */
export function linkTextForHref(href: string): string {
  return href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '').replace(/\/$/, '') || href;
}
