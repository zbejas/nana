import { editorViewCtx, parserCtx, type Editor } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { changedCharacterCount, diffText } from './aiDiff';
import { normalizeMarkdown } from './helpers';
import {
  getEditorMarkdown,
  proseTextMap,
  replaceEditorMarkdown,
  setAiDiffHighlights,
  setAiHighlights,
  type AiHighlightRange,
} from './createEditor';

export interface AiChangedSection {
  heading?: string | null;
  path?: string[];
  from?: number;
  to?: number;
}

interface Block {
  from: number;
  to: number;
  level: number;
  keys: string[];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function textOf(node: ProseMirrorNode): string {
  return normalize(node.textBetween(0, node.content.size, ' '));
}

/**
 * Walks the top-level blocks once, keeping the heading trail so a section can
 * be matched by its leaf heading or a `Parent > Child` path. Body blocks keep
 * level 0; a heading's level closes the previous section at the same or
 * shallower level.
 */
function blocksOf(doc: ProseMirrorNode): Block[] {
  const blocks: Block[] = [];
  const trail: Array<{ level: number; text: string }> = [];

  doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;

    if (node.type.name !== 'heading') {
      blocks.push({ from, to, level: 0, keys: [] });
      return;
    }

    const level = Number(node.attrs.level) || 6;
    const text = textOf(node);
    while (trail.length > 0 && (trail[trail.length - 1]?.level ?? 0) >= level) {
      trail.pop();
    }
    const path = [...trail.map((item) => item.text), text].join(' > ');
    trail.push({ level, text });
    blocks.push({ from, to, level, keys: [text, path] });
  });

  return blocks;
}

function rangesFor(doc: ProseMirrorNode, sections: AiChangedSection[]): AiHighlightRange[] {
  if (sections.length === 0) return [];

  const blocks = blocksOf(doc);
  const ranges = new Map<string, AiHighlightRange>();

  for (const section of sections) {
    const wanted = section.heading ? normalize(section.heading) : '';
    const path = (section.path?.join(' > ') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!wanted && !path) continue;

    const headingIndex = blocks.findIndex((block) => {
      if (block.level === 0) return false;
      return block.keys.includes(wanted) || (path ? block.keys.includes(path) : false);
    });
    if (headingIndex === -1) continue;

    const heading = blocks[headingIndex];
    if (!heading) continue;
    ranges.set(`${heading.from}:${heading.to}`, { from: heading.from, to: heading.to, heading: true });

    for (let index = headingIndex + 1; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (!block) break;
      if (block.level > 0 && block.level <= heading.level) break;
      ranges.set(`${block.from}:${block.to}`, { from: block.from, to: block.to });
    }
  }

  if (ranges.size === 0 && blocks.length > 0) {
    // Appends and text replacements may not add a heading. Mark the final
    // block so the user still sees what changed.
    const last = blocks[blocks.length - 1];
    if (last) ranges.set(`${last.from}:${last.to}`, { from: last.from, to: last.to });
  }

  return [...ranges.values()].sort((left, right) => left.from - right.from);
}

/**
 * True when the editor already holds the body. Accepts either the serialized
 * Markdown or the parsed document so serializer-only differences (marker or
 * whitespace normalization) do not hide an unchanged note.
 */
export function editorMatchesMarkdown(editor: Editor, markdown: string): boolean {
  const expectedMarkdown = normalizeMarkdown(markdown);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (view.isDestroyed) return false;
    if (normalizeMarkdown(getEditorMarkdown(ctx)) === expectedMarkdown) return true;
    const expected = ctx.get(parserCtx)(expectedMarkdown);
    return Boolean(expected && view.state.doc.eq(expected));
  });
}

export interface ApplyAiMarkdownOptions {
  /**
   * Default true: apply the AI body before painting. A live room owns content,
   * so that path passes false and only paints against the document the room
   * already delivered. No document transaction is dispatched in that mode.
   */
  replace?: boolean;
}

/** How the rendered editor should treat one queued AI edit. */
export type AiMarkdownApplyPlan = 'replace' | 'decorate' | 'skip';

/**
 * Decide whether an AI edit may touch the rendered editor.
 *
 * A live session is decoration-only: the room body must already match the
 * fetched body. Without a session the editor may still hold the event-time
 * body (normal path) or already show the fetched body (realtime applied it);
 * anything else is local typing that must win.
 */
export function planAiMarkdownApply(input: {
  liveSession: boolean;
  replace?: boolean;
  matchesNext: boolean;
  matchesPrevious: boolean;
}): AiMarkdownApplyPlan {
  if (input.liveSession || input.replace === false) {
    return input.matchesNext ? 'decorate' : 'skip';
  }
  if (input.matchesNext) return 'decorate';
  if (input.matchesPrevious) return 'replace';
  return 'skip';
}

/**
 * Applies the AI-applied Markdown when allowed, then highlights the changed
 * sections through ProseMirror decorations. `replace: false` never dispatches
 * a document transaction; it paints the diff against the current document and
 * returns without a flash when a peer or local edit moved the body away from
 * the fetched Markdown first. Scrolling and the fade are owned by
 * `setAiHighlights`.
 */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  previousMarkdown: string,
  sections: AiChangedSection[],
  options: ApplyAiMarkdownOptions = {},
): void {
  const replace = options.replace ?? true;
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  if (view.isDestroyed) return;
  if (!replace && !editorMatchesMarkdown(editor, markdown)) return;

  const beforeDoc = editor.action((ctx) =>
    ctx.get(parserCtx)(normalizeMarkdown(previousMarkdown)),
  );
  const before = beforeDoc ? proseTextMap(beforeDoc) : null;
  if (replace) editor.action((ctx) => replaceEditorMarkdown(ctx, markdown));

  window.requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    // A live room can receive a peer keystroke between the effect and this
    // frame. Do not paint offsets over a body that no longer matches.
    if (!replace && !editorMatchesMarkdown(editor, markdown)) return;
    const after = proseTextMap(view.state.doc);
    const changes = before ? diffText(before.text, after.text) : [];
    const changedChars = changedCharacterCount(changes);
    const applied = changes.length > 0
      && changes.length <= 240
      && changedChars <= 6_000
      && setAiDiffHighlights(view, changes, after);

    if (!applied) setAiHighlights(view, rangesFor(view.state.doc, sections), 700);
  });
}
