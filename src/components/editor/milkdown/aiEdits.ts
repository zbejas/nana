import { editorViewCtx, parserCtx, type Editor } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { changedCharacterCount, diffText } from './aiDiff';
import { claimAiDiffFlash } from './aiDiffView';
import { normalizeMarkdown } from './helpers';
import {
  aiDiffFallbackRanges,
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
 * Canonical form of a body as the rendered editor serializes it. `normalizeMarkdown`
 * already removes CRLF and trailing newlines; the only remaining blank-line
 * difference is a run of three or more newlines, which the editor writes as one
 * empty line (`\n\n`). The comparison stays exact for every non-blank
 * character, so this cannot make two unrelated or merged bodies match.
 */
export function canonicalEditorMarkdown(value: string): string {
  return normalizeMarkdown(value).replace(/\n{3,}/g, '\n\n');
}

/** Exact body equality under the editor's blank-line serialization. */
export function isSameEditorMarkdown(left: string, right: string): boolean {
  return canonicalEditorMarkdown(left) === canonicalEditorMarkdown(right);
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
  // A section entry with no heading and no path (the server sends this shape
  // for append-only or whole-body edits) carries no location. Treat it as
  // empty so the caller can derive a bounded wash from the actual diff.
  const usable = sections.filter(
    (section) => Boolean(section.heading?.trim()) || (section.path?.some((part) => part.trim()) ?? false),
  );
  if (usable.length === 0) return [];

  const blocks = blocksOf(doc);
  const ranges = new Map<string, AiHighlightRange>();

  for (const section of usable) {
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
 * True when the editor already holds the body. The serialized comparison uses
 * the editor's own blank-line canonical form, then falls back to parsed-document
 * equality so serializer-only differences (marker or whitespace normalization)
 * do not hide an unchanged note.
 */
export function editorMatchesMarkdown(editor: Editor, markdown: string): boolean {
  const expectedMarkdown = canonicalEditorMarkdown(markdown);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (view.isDestroyed) return false;
    if (canonicalEditorMarkdown(getEditorMarkdown(ctx)) === expectedMarkdown) return true;
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
  /** Edit id shared by both panes so a remount does not replay the flash. */
  editId?: string;
  /**
   * Exact editor body the plan matched. The rendered pane diffs against this
   * serialized body, never the raw event `after` whose blank-line runs can be
   * longer than the editor's (`\n\n\n\n` vs `\n\n`) and would shift anchors.
   */
  targetMarkdown?: string;
}

/**
 * How the rendered editor should treat one queued AI edit.
 *
 * `wait` means paint when the room/content commit reaches the rendered editor,
 * never replace the live body. `fallback` is the bounded-wait outcome when the
 * editor still holds the event-time body: paint a visible wash derived from the
 * related body instead of leaving the rendered pane blank.
 */
export type AiMarkdownApplyPlan = 'replace' | 'decorate' | 'wait' | 'fallback' | 'skip';

/**
 * Decide whether an AI edit may touch the rendered editor.
 *
 * A live session (or an explicit decoration-only edit) is decoration-only: the
 * room or content commit may still be in flight, so an editor that does not
 * match the fetched body yet waits for it instead of dropping the flash. After
 * the bounded wait, a body that still matches the event-time body gets a
 * fallback wash; an unrelated/merged body is skipped. Without a session the
 * editor may still hold the event-time body (normal path) or already show the
 * fetched body (realtime applied it); anything else is local typing that must
 * win.
 */
export function planAiMarkdownApply(input: {
  liveSession: boolean;
  replace?: boolean;
  matchesNext: boolean;
  matchesPrevious: boolean;
  /** True after the decoration-only pane's bounded wait elapsed. */
  waitElapsed?: boolean;
}): AiMarkdownApplyPlan {
  if (input.liveSession || input.replace === false) {
    if (input.matchesNext) return 'decorate';
    if (!input.waitElapsed) return 'wait';
    return input.matchesPrevious ? 'fallback' : 'skip';
  }
  if (input.matchesNext) return 'decorate';
  if (input.matchesPrevious) return 'replace';
  return 'skip';
}

export type WysiwygAiMarkdownPlan =
  | {
    action: 'paint';
    /** Editor-serialized target body used for the diff. */
    targetMarkdown: string;
    /** Event-time body for the previous side. */
    previousMarkdown: string;
    /** True when the inline diff is empty and the wash is the visible fallback. */
    fallback: boolean;
  }
  | {
    action: 'replace';
    targetMarkdown: string;
    previousMarkdown: string;
  }
  | { action: 'wait' }
  | { action: 'skip'; reason: 'unrelated' | 'no-editor' };

/**
 * Resolve the rendered pane's action and the exact body pair to diff.
 *
 * A canonically equivalent body paints against the editor's own serialization
 * (the source pane may still diff the raw event body). A body that is related
 * only because it still holds the event-time body paints a fallback wash after
 * the wait; unrelated or merged local text is skipped.
 */
export function planWysiwygAiMarkdown(input: {
  /** Editor-serialized Markdown, or null when no live view is available. */
  editorMarkdown: string | null;
  nextMarkdown: string;
  previousMarkdown: string;
  liveSession: boolean;
  replace?: boolean;
  matchesNext: boolean;
  matchesPrevious: boolean;
  waitElapsed?: boolean;
}): WysiwygAiMarkdownPlan {
  if (input.editorMarkdown === null) return { action: 'skip', reason: 'no-editor' };

  const action = planAiMarkdownApply(input);
  if (action === 'wait') return { action: 'wait' };
  if (action === 'skip') return { action: 'skip', reason: 'unrelated' };

  const previousMarkdown = normalizeMarkdown(input.previousMarkdown);
  if (action === 'replace') {
    return {
      action: 'replace',
      targetMarkdown: normalizeMarkdown(input.nextMarkdown),
      previousMarkdown,
    };
  }

  return {
    action: 'paint',
    // The rendered editor owns the target. Keep the event `before` for the
    // other side of the diff; using the raw event `after` here would anchor
    // deletions at offsets the editor does not have.
    targetMarkdown: normalizeMarkdown(input.editorMarkdown),
    previousMarkdown,
    fallback: action === 'fallback',
  };
}

/**
 * Applies the AI-applied Markdown when allowed, then highlights the changed
 * sections through ProseMirror decorations. `replace: false` never dispatches
 * a document transaction; it paints the diff against the current document and
 * returns without a flash when a peer or local edit moved the body away from
 * the target body first. The target defaults to `markdown` but the rendered
 * pane passes its own serialized body so blank-line differences in the event
 * cannot shift anchors. Scrolling and the fade are owned by `setAiHighlights`.
 */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  previousMarkdown: string,
  sections: AiChangedSection[],
  options: ApplyAiMarkdownOptions = {},
): void {
  const replace = options.replace ?? true;
  const targetMarkdown = options.targetMarkdown ?? markdown;
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  if (view.isDestroyed) return;
  if (!replace && !editorMatchesMarkdown(editor, targetMarkdown)) return;

  const beforeDoc = editor.action((ctx) =>
    ctx.get(parserCtx)(normalizeMarkdown(previousMarkdown)),
  );
  const before = beforeDoc ? proseTextMap(beforeDoc) : null;
  const flash = claimAiDiffFlash('wysiwyg', options.editId ?? '');
  if (!flash) return;
  if (replace) editor.action((ctx) => replaceEditorMarkdown(ctx, targetMarkdown));

  window.requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    // A live room can receive a peer keystroke between the effect and this
    // frame. Do not paint offsets over a body that no longer matches.
    if (!replace && !editorMatchesMarkdown(editor, targetMarkdown)) return;
    // The current document is the editor's serialized body. This is the only
    // target whose text offsets the decorations can address.
    const after = proseTextMap(view.state.doc);
    const changes = before ? diffText(before.text, after.text) : [];
    const changedChars = changedCharacterCount(changes);
    const applied = changes.length > 0
      && changes.length <= 240
      && changedChars <= 6_000
      && setAiDiffHighlights(view, changes, after, flash);

    if (applied) return;

    // Section metadata is authoritative when it has a usable heading/path.
    // Empty metadata (and the long-change path) derives a bounded wash from
    // the diff itself, so the rendered pane can never silently show nothing.
    const sectionRanges = rangesFor(view.state.doc, sections);
    const ranges = sectionRanges.length > 0
      ? sectionRanges
      : aiDiffFallbackRanges(view.state.doc, after, changes);
    setAiHighlights(view, ranges, flash);
  });
}
