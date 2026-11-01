import type { Ctx } from '@milkdown/kit/ctx';
import {
  Editor,
  defaultValueCtx,
  editorStateCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark, imageSchema } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload';
import { $prose, $view } from '@milkdown/kit/utils';
import { Fragment, Slice, type Attrs, type Node as ProseNode, type NodeType } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Transform } from '@milkdown/kit/prose/transform';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { prism } from '@milkdown/plugin-prism';
import { rewriteLegacyFileUrl } from '../../../lib/legacy-urls';
import type { AiTextChange } from './aiDiff';
import {
  AI_DIFF_CLEAR_MS,
  AI_DIFF_FLASH_MS,
  aiDiffFallbackSpans,
  formatAiDiffDeleteText,
  groupAiDiffHunks,
  pickAiDiffScrollTarget,
  prefersReducedMotion,
  type AiDiffScrollHunk,
} from './aiDiffView';
import { normalizeMarkdown } from './helpers';
import { alignMarkdownToText, mapSelectionThroughChange, markdownOffsetToTextOffset, minimalTextChange, textOffsetToMarkdownOffset } from '../../../lib/collaboration/text';
import type { Collaborator } from '../../../lib/collaboration/types';

export interface SlashTriggerPosition {
  left: number;
  top: number;
  bottom: number;
}

export interface CreateMilkdownEditorOptions {
  root: HTMLElement;
  initialValue: string;
  readOnlyRef: { current: boolean };
  placeholderRef: { current: string };
  ariaLabel: string;
  spellcheck: boolean;
  enableSlash?: boolean;
  onDocChangeRef: { current: ((markdown: string) => void) | undefined };
  /** True while an external snapshot is dispatched; keeps remote applies out of Yjs. */
  suppressDocChangeRef?: { current: boolean };
  onSelectionRef: { current: (() => void) | undefined };
  onSelectionChangeRef?: { current: (() => void) | undefined };
  onFocusRef: { current: (() => void) | undefined };
  onBlurRef: { current: (() => void) | undefined };
  onSlashRef: { current: ((position: SlashTriggerPosition) => void) | undefined };
  uploadImageRef: { current: ((file: File) => Promise<string>) | undefined };
}

/** Render legacy `/pb/api/files/...` image URLs through the `/api/v1` route. */
const legacyImageView = $view(imageSchema.node, () => (node) => {
  const image = document.createElement('img');

  const markBadge = () => {
    // Badges are small, wide images (usually inside a link). Card borders and
    // an 8px radius turn them into pills and clip their own rounded corners.
    const badge = image.naturalWidth >= 48
      && image.naturalHeight > 0
      && image.naturalHeight <= 28;
    image.classList.toggle('nana-inline-badge', badge);
  };

  image.addEventListener('load', markBadge);
  image.addEventListener('error', () => image.classList.remove('nana-inline-badge'));

  const apply = (value: typeof node) => {
    image.src = rewriteLegacyFileUrl(value.attrs.src as string) ?? '';
    image.alt = (value.attrs.alt as string) ?? '';
    image.classList.remove('nana-inline-badge');
    if (value.attrs.title) image.title = value.attrs.title as string;
    else image.removeAttribute('title');
    if (image.complete) markBadge();
  };

  apply(node);
  return {
    dom: image,
    update(updated) {
      if (updated.type !== node.type) return false;
      apply(updated);
      return true;
    },
  };
});

function legacyLinkPlugin() {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('NANA_LEGACY_LINK'),
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
              if (!anchor) return false;
              const href = anchor.getAttribute('href');
              const rewritten = rewriteLegacyFileUrl(href ?? undefined);
              if (!href || !rewritten || rewritten === href) return false;
              event.preventDefault();
              window.open(rewritten, '_blank', 'noopener,noreferrer');
              return true;
            },
          },
        },
      }),
  );
}

function placeholderPlugin(placeholderRef: { current: string }) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('NANA_PLACEHOLDER'),
        props: {
          decorations(state) {
            if (state.doc.childCount !== 1) return null;
            const first = state.doc.firstChild;
            if (!first || first.type.name !== 'paragraph' || first.content.size > 0) return null;
            const text = placeholderRef.current;
            if (!text) return null;

            const span = document.createElement('span');
            span.className = 'nana-milkdown-placeholder';
            span.textContent = text;
            span.setAttribute('aria-hidden', 'true');
            return DecorationSet.create(state.doc, [Decoration.widget(1, span, { side: -1 })]);
          },
        },
      }),
  );
}

const AI_HIGHLIGHT_KEY = new PluginKey<DecorationSet>('NANA_AI_HIGHLIGHT');
const aiHighlightTimers = new WeakMap<EditorView, number>();

/**
 * CommonMark soft line breaks are text nodes containing `\n`. ProseMirror
 * renders text under `white-space: pre-wrap`, so wrapped Markdown lines and
 * badge rows would show as hard breaks in the editor even though the same
 * Markdown renders inline everywhere else. Wrap only those text nodes and let
 * the stylesheet collapse their newline without changing the stored source.
 */
const SOFT_BREAK_KEY = new PluginKey('NANA_SOFT_BREAK');

function softBreakPlugin() {
  return $prose(
    () =>
      new Plugin({
        key: SOFT_BREAK_KEY,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text?.includes('\n')) return;
              if (node.marks.some((mark) => mark.type.spec.code === true)) return;

              const $pos = state.doc.resolve(pos);
              if ($pos.parent.type.spec.code) return;

              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, { class: 'nana-soft-break' }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
  );
}

function aiHighlightPlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: AI_HIGHLIGHT_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const next = tr.getMeta(AI_HIGHLIGHT_KEY) as DecorationSet | undefined;
            if (next) return next;
            // Diff widgets are anchored to the body that was diffed. Mapping
            // them through an unrelated transaction can leave a deletion
            // widget inside different text, so drop them deterministically on
            // any document change. The flash timer only clears an empty set.
            if (tr.docChanged) return DecorationSet.empty;
            return previous;
          },
        },
        props: {
          decorations(state) {
            return AI_HIGHLIGHT_KEY.getState(state) ?? null;
          },
        },
      }),
  );
}

export interface AiHighlightRange {
  from: number;
  to: number;
  heading?: boolean;
}

function isLineBreakNode(node: ProseNode): boolean {
  return node.type.name === 'hardbreak' || node.type.name === 'hard_break';
}

export interface ProseTextSegment {
  textStart: number;
  textEnd: number;
  from: number;
  to: number;
}

export interface ProseTextMap {
  text: string;
  segments: ProseTextSegment[];
  textSegments: ProseTextSegment[];
}

/**
 * Plain text with a position map. Block boundaries become zero-width newlines
 * so a paragraph split still diffs as a line change, while text-node offsets
 * stay addressable as ProseMirror positions.
 */
export function proseTextMap(doc: ProseNode): ProseTextMap {
  let text = '';
  const segments: ProseTextSegment[] = [];
  const textSegments: ProseTextSegment[] = [];

  const addSeparator = (pos: number) => {
    if (text.length === 0 || text.endsWith('\n')) return;
    segments.push({
      textStart: text.length,
      textEnd: text.length + 1,
      from: pos,
      to: pos,
    });
    text += '\n';
  };

  const walk = (node: ProseNode, pos: number) => {
    if (node.isText) {
      const value = node.text ?? '';
      if (!value) return;
      const segment = {
        textStart: text.length,
        textEnd: text.length + value.length,
        from: pos,
        to: pos + value.length,
      };
      text += value;
      segments.push(segment);
      textSegments.push(segment);
      return;
    }

    if (isLineBreakNode(node)) {
      // A hardbreak is one document position but a newline in the plain-text
      // projection, so cursor offsets on either side stay distinguishable.
      segments.push({
        textStart: text.length,
        textEnd: text.length + 1,
        from: pos,
        to: pos + 1,
      });
      text += '\n';
      return;
    }

    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isBlock && offset > 0) addSeparator(childPos);
      walk(child, childPos);
    });
  };

  walk(doc, 0);
  return { text, segments, textSegments };
}

function positionAt(map: ProseTextMap, offset: number): number {
  if (map.segments.length === 0) return 0;
  for (let index = 0; index < map.segments.length; index += 1) {
    const segment = map.segments[index]!;
    if (offset < segment.textStart) return segment.from;
    if (offset <= segment.textEnd) {
      const next = map.segments[index + 1];
      if (offset === segment.textEnd && next?.textStart === offset) continue;
      return segment.from + Math.max(0, Math.min(offset - segment.textStart, segment.to - segment.from));
    }
  }
  return map.segments[map.segments.length - 1]!.to;
}

const COLLAB_PRESENCE_KEY = new PluginKey<DecorationSet>('NANA_COLLAB_PRESENCE');

function collaboratorCaret(name: string, color: string): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'nana-collab-caret';
  caret.style.setProperty('--nana-collab', color);
  caret.setAttribute('aria-hidden', 'true');
  caret.setAttribute('contenteditable', 'false');

  const label = document.createElement('span');
  label.className = 'nana-collab-caret-label';
  label.textContent = name;
  caret.appendChild(label);
  return caret;
}

function collaboratorDecorations(
  doc: ProseNode,
  collaborators: readonly Collaborator[],
  markdown: string,
): DecorationSet {
  const focused = collaborators.filter((collaborator) => collaborator.focused);
  if (focused.length === 0) return DecorationSet.empty;

  const map = proseTextMap(doc);
  const segments = alignMarkdownToText(markdown, map.text);
  const decorations: Decoration[] = [];

  for (const collaborator of focused) {
    const anchorText = markdownOffsetToTextOffset(segments, collaborator.anchor);
    const headText = markdownOffsetToTextOffset(segments, collaborator.head);
    if (anchorText === null || headText === null) continue;
    const anchor = positionAt(map, anchorText);
    const head = positionAt(map, headText);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);

    if (to > from) {
      decorations.push(Decoration.inline(from, to, {
        class: 'nana-collab-selection',
        style: `--nana-collab: ${collaborator.color}`,
      }));
    }
    decorations.push(Decoration.widget(head, collaboratorCaret(
      collaborator.name,
      collaborator.color,
    ), { side: 1 }));
  }

  return DecorationSet.create(doc, decorations);
}

/** Update the remote-caret layer without touching the document or history. */
export function setCollaboratorHighlights(
  ctx: Ctx,
  collaborators: readonly Collaborator[],
): void {
  const view = ctx.get(editorViewCtx);
  if (view.isDestroyed) return;
  view.dispatch(
    view.state.tr.setMeta(COLLAB_PRESENCE_KEY, collaboratorDecorations(
      view.state.doc,
      collaborators,
      getEditorMarkdown(ctx),
    )),
  );
}

function collaboratorPresencePlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: COLLAB_PRESENCE_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const next = tr.getMeta(COLLAB_PRESENCE_KEY) as DecorationSet | undefined;
            if (next) return next;
            return previous.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return COLLAB_PRESENCE_KEY.getState(state) ?? null;
          },
        },
      }),
  );
}

function scrollEditorTo(view: EditorView, top: number): void {
  if (view.isDestroyed) return;
  const target = Math.max(0, Math.min(top, view.dom.scrollHeight - view.dom.clientHeight));
  if (prefersReducedMotion()) {
    view.dom.scrollTop = target;
    return;
  }
  view.dom.scrollTo({ top: target, behavior: 'smooth' });
}

function scrollToAiDiffTarget(view: EditorView, hunks: readonly AiDiffScrollHunk[]): void {
  if (view.isDestroyed) return;
  const top = pickAiDiffScrollTarget({
    hunks,
    viewportHeight: view.dom.clientHeight,
    maxScrollTop: view.dom.scrollHeight - view.dom.clientHeight,
  });
  scrollEditorTo(view, top);
}

function textHunkRects(
  view: EditorView,
  hunks: ReturnType<typeof groupAiDiffHunks>,
  map: ProseTextMap,
): AiDiffScrollHunk[] {
  const domTop = view.dom.getBoundingClientRect().top;
  const scrollTop = view.dom.scrollTop;
  const rects: AiDiffScrollHunk[] = [];

  for (const hunk of hunks) {
    try {
      const start = positionAt(map, hunk.start);
      const end = hunk.end > hunk.start ? positionAt(map, hunk.end) : start;
      const startCoords = view.coordsAtPos(start, 1);
      const endCoords = end > start ? view.coordsAtPos(end, -1) : startCoords;
      rects.push({
        top: startCoords.top - domTop + scrollTop,
        bottom: Math.max(startCoords.top, endCoords.bottom) - domTop + scrollTop,
      });
    } catch {
      // A position that cannot be measured simply does not participate in
      // the scroll decision; the flash decorations still paint.
    }
  }

  return rects;
}

function rangeHunkRects(view: EditorView, ranges: readonly AiHighlightRange[]): AiDiffScrollHunk[] {
  const domTop = view.dom.getBoundingClientRect().top;
  const scrollTop = view.dom.scrollTop;
  const rects: AiDiffScrollHunk[] = [];

  for (const range of ranges) {
    const node = view.nodeDOM(range.from);
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    rects.push({
      top: rect.top - domTop + scrollTop,
      bottom: rect.bottom - domTop + scrollTop,
    });
  }

  return rects;
}

/** Set the shared AI decoration timer and clear the visual after `duration`. */
function scheduleAiDecorationClear(view: EditorView, duration: number): void {
  const previousTimer = aiHighlightTimers.get(view);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);

  const timer = window.setTimeout(() => {
    aiHighlightTimers.delete(view);
    if (view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.empty));
  }, duration);
  aiHighlightTimers.set(view, timer);
}

/** End the current flash immediately, e.g. when a newer edit supersedes it. */
export function clearAiHighlights(view: EditorView): void {
  if (view.isDestroyed) return;
  const timer = aiHighlightTimers.get(view);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    aiHighlightTimers.delete(view);
  }
  view.dispatch(view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.empty));
}

export interface AiHighlightOptions {
  /** Remaining lifespan for this pane, usually from `claimAiDiffFlash`. */
  duration?: number;
  /** False when a pane remounts mid-flash and must not replay the animation. */
  animate?: boolean;
}

/**
 * Apply a short inline diff. Inserted text gets a green wash; deleted text is
 * shown as a red strike-through widget at the new insertion point. The source
 * document is never changed by these decorations.
 */
export function setAiDiffHighlights(
  view: EditorView,
  changes: readonly AiTextChange[],
  map: ProseTextMap,
  options: AiHighlightOptions = {},
): boolean {
  if (view.isDestroyed || changes.length === 0) return false;

  const animate = options.animate ?? true;
  const insertClass = animate ? 'nana-ai-diff-insert' : 'nana-ai-diff-insert nana-ai-diff-static';
  const deleteClass = animate ? 'nana-ai-diff-delete' : 'nana-ai-diff-delete nana-ai-diff-static';
  const decorations: Decoration[] = [];

  for (const change of changes) {
    if (change.type === 'insert') {
      for (const segment of map.textSegments) {
        const from = Math.max(change.start, segment.textStart);
        const to = Math.min(change.end, segment.textEnd);
        if (from >= to) continue;
        decorations.push(Decoration.inline(
          segment.from + (from - segment.textStart),
          segment.from + (to - segment.textStart),
          { class: insertClass },
        ));
      }
      continue;
    }

    const span = document.createElement('span');
    span.className = deleteClass;
    span.textContent = formatAiDiffDeleteText(change.text).display;
    span.setAttribute('aria-hidden', 'true');
    decorations.push(Decoration.widget(
      positionAt(map, change.start),
      span,
      { side: -1 },
    ));
  }

  if (decorations.length === 0) return false;

  view.dom.style.setProperty('--nana-ai-flash-duration', `${AI_DIFF_FLASH_MS}ms`);
  view.dispatch(
    view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.create(view.state.doc, decorations)),
  );
  scrollToAiDiffTarget(view, textHunkRects(view, groupAiDiffHunks(changes), map));
  scheduleAiDecorationClear(view, options.duration ?? AI_DIFF_CLEAR_MS);
  return true;
}

/**
 * Applies the AI-edit wash through ProseMirror decorations rather than DOM
 * classes. Milkdown re-renders node DOM after transactions; a class added
 * directly to the DOM can disappear before the user sees it.
 */
export function setAiHighlights(
  view: EditorView,
  ranges: AiHighlightRange[],
  options: AiHighlightOptions = {},
): void {
  if (view.isDestroyed || ranges.length === 0) return;

  const animate = options.animate ?? true;
  const className = animate ? 'nana-ai-edited' : 'nana-ai-edited nana-ai-edited-static';
  const decorations = ranges.map((range) =>
    Decoration.node(range.from, range.to, {
      class: className,
      ...(range.heading ? { 'data-nana-ai-heading': 'true' } : {}),
    }),
  );

  view.dom.style.setProperty('--nana-ai-flash-duration', `${AI_DIFF_FLASH_MS}ms`);
  view.dispatch(
    view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.create(view.state.doc, decorations)),
  );
  scrollToAiDiffTarget(view, rangeHunkRects(view, ranges));
  scheduleAiDecorationClear(view, options.duration ?? AI_DIFF_CLEAR_MS);
}

/**
 * Map a diff-derived text span set onto the top-level blocks it touched. This
 * is the rendered-pane fallback when server section metadata is empty or the
 * change set is too large for inline widgets. It is intentionally bounded: a
 * pathological note gets the first N changed blocks rather than thousands of
 * node decorations.
 */
export function aiDiffFallbackRanges(
  doc: ProseNode,
  map: ProseTextMap,
  changes: readonly AiTextChange[],
  maxRanges = 160,
): AiHighlightRange[] {
  const spans = aiDiffFallbackSpans(changes, map.text.length, maxRanges);
  const blocks: Array<{ from: number; to: number }> = [];
  doc.forEach((node, offset) => {
    blocks.push({ from: offset, to: offset + node.nodeSize });
  });
  if (blocks.length === 0) return [];

  const blockIndexAt = (position: number): number => {
    const clamped = Math.max(0, Math.min(position, doc.content.size));
    for (let index = 0; index < blocks.length; index += 1) {
      if (clamped < blocks[index]!.to) return index;
    }
    return blocks.length - 1;
  };

  const ranges = new Map<string, AiHighlightRange>();
  const limit = Math.max(1, maxRanges);
  outer: for (const span of spans) {
    const startPosition = positionAt(map, span.start);
    const endPosition = span.end > span.start ? positionAt(map, span.end) : startPosition;
    const startIndex = blockIndexAt(startPosition);
    const endIndex = blockIndexAt(endPosition);

    for (let index = startIndex; index <= endIndex; index += 1) {
      const block = blocks[index]!;
      ranges.set(`${block.from}:${block.to}`, { from: block.from, to: block.to });
      if (ranges.size >= limit) break outer;
    }
  }

  if (ranges.size === 0) {
    // The body exists but the text projection could not address it (for
    // example a node-only block). A single wash is still better than blank.
    const first = blocks[0]!;
    ranges.set(`${first.from}:${first.to}`, { from: first.from, to: first.to });
  }

  return [...ranges.values()].sort((left, right) => left.from - right.from);
}

function taskListClickPlugin() {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('NANA_TASK_LIST_CLICK'),
        props: {
          handleDOMEvents: {
            click(view, event) {
              if (!(event instanceof MouseEvent) || event.defaultPrevented) return false;
              const target = event.target as HTMLElement | null;
              const item = target?.closest<HTMLElement>('li[data-item-type="task"]');
              if (!item || !view.dom.contains(item)) return false;

              const rect = item.getBoundingClientRect();
              if (event.clientX - rect.left > 28) return false;

              const pos = view.posAtDOM(item, 0);
              const $pos = view.state.doc.resolve(pos);
              for (let depth = $pos.depth; depth > 0; depth -= 1) {
                const node = $pos.node(depth);
                if (node.type.name !== 'list_item' || node.attrs.checked == null) continue;
                view.dispatch(
                  view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
                    ...node.attrs,
                    checked: !node.attrs.checked,
                  }),
                );
                return true;
              }
              return false;
            },
          },
        },
      }),
  );
}

/**
 * Emit Markdown synchronously on every document change. Milkdown's listener
 * plugin debounces `markdownUpdated` by 200ms, which can lose the last
 * keystrokes when the user switches to Read or closes the editor immediately.
 */
const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
const ALERT_PLUGIN_KEY = new PluginKey<DecorationSet>("NANA_GITHUB_ALERTS");

function alertDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node: ProseNode, pos: number) => {
    if (node.type.name !== "blockquote") return;
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph") return;

    const text = first.textContent as string;
    const match = /^(\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(text);
    if (!match) return;

    const type = (match[2] ?? "").toUpperCase();
    if (!ALERT_TYPES.includes(type as typeof ALERT_TYPES[number])) return;

    const alertType = type.toLowerCase();
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      class: `nana-alert nana-alert-${alertType}`,
      "data-alert-label": alertType.charAt(0).toUpperCase() + alertType.slice(1),
    }));

    // The marker is source syntax, not reading copy. Keep it in the document
    // so serialization round-trips, but hide it in both read and write mode.
    const markerLength = match[0].length;
    const markerFrom = pos + 2;
    if (markerLength > 0 && markerFrom + markerLength <= pos + 1 + first.nodeSize) {
      decorations.push(Decoration.inline(markerFrom, markerFrom + markerLength, {
        class: "nana-alert-marker",
      }));
    }
  });

  return DecorationSet.create(doc, decorations);
}

/** Render GitHub blockquote alerts as Graphite callouts without changing source. */
function githubAlertPlugin() {
  return $prose(
    () =>
      new Plugin({
        key: ALERT_PLUGIN_KEY,
        state: {
          init: (_config, state) => alertDecorations(state.doc),
          apply: (tr, previous) => tr.docChanged ? alertDecorations(tr.doc) : previous,
        },
        props: {
          decorations: (state) => ALERT_PLUGIN_KEY.getState(state),
        },
      }),
  );
}

const DETAILS_PLUGIN_KEY = new PluginKey<DetailsState>("NANA_GITHUB_DETAILS");

interface DetailsEntry {
  key: string;
  summary: string;
  open: boolean;
  start: number;
  blockSize: number;
  end: number;
  endSize: number;
  body: Array<{ pos: number; size: number }>;
}

interface DetailsState {
  open: Set<string>;
  decorations: DecorationSet;
}

function detailsMarkdown(block: ProseNode): string {
  const first = block.firstChild;
  if (first?.type.name === "html") {
    return String(first.attrs.value ?? first.textContent ?? "");
  }
  return block.textContent;
}

function detailsEntries(doc: ProseNode): DetailsEntry[] {
  const entries: DetailsEntry[] = [];
  let pending: Omit<DetailsEntry, "body" | "end" | "endSize"> | null = null;
  let index = 0;

  doc.forEach((block, offset) => {
    if (!pending) {
      const markdown = detailsMarkdown(block);
      const match = /^\s*<details(\s[^>]*)?>\s*<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(markdown);
      if (!match) return;
      const summary = (match[2] ?? "").replace(/<[^>]+>/g, "").trim() || "Details";
      pending = {
        key: `${summary}\u0000${index++}`,
        summary,
        open: /\bopen\b/i.test(match[1] ?? ""),
        start: offset,
        blockSize: block.nodeSize,
      };
      return;
    }

    const markdown = detailsMarkdown(block).trim();
    if (/^<\/details>\s*$/i.test(markdown)) {
      entries.push({
        ...pending,
        end: offset,
        endSize: block.nodeSize,
        body: [],
      });
      pending = null;
    }
  });

  // A second pass keeps positions and body blocks calculation simple while
  // allowing nested details blocks to remain ordinary content.
  return entries.map((entry) => {
    const body: Array<{ pos: number; size: number }> = [];
    doc.forEach((block, offset) => {
      if (offset > entry.start && offset < entry.end) {
        body.push({ pos: offset, size: block.nodeSize });
      }
    });
    return { ...entry, body };
  });
}

function detailsDecorations(doc: ProseNode, openKeys: Set<string>): DecorationSet {
  const decorations: Decoration[] = [];

  for (const entry of detailsEntries(doc)) {
    const isOpen = openKeys.has(entry.key);
    const button = (view: EditorView) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "nana-details-summary";
      element.contentEditable = "false";
      element.setAttribute("aria-expanded", String(isOpen));
      element.textContent = entry.summary;
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch(view.state.tr.setMeta(DETAILS_PLUGIN_KEY, entry.key));
      });
      return element;
    };

    // The raw <details>/<summary> markers stay in the document so Markdown
    // round-trips, but are replaced visually by the summary widget.
    decorations.push(Decoration.inline(entry.start + 1, entry.start + entry.blockSize - 1, {
      class: "nana-details-marker",
    }));
    decorations.push(Decoration.widget(entry.start + 1, button, { side: -1 }));
    decorations.push(Decoration.node(entry.end, entry.end + entry.endSize, {
      class: "nana-details-close",
    }));

    for (const block of entry.body) {
      decorations.push(Decoration.node(block.pos, block.pos + block.size, {
        class: isOpen ? "nana-details-body nana-details-open" : "nana-details-body nana-details-closed",
      }));
    }
  }

  return DecorationSet.create(doc, decorations);
}

/** Render raw GitHub-style <details> blocks as native, collapsible callouts. */
function githubDetailsPlugin() {
  return $prose(
    () =>
      new Plugin<DetailsState>({
        key: DETAILS_PLUGIN_KEY,
        state: {
          init: (_config, state) => {
            const entries = detailsEntries(state.doc);
            const open = new Set(entries.filter((entry) => entry.open).map((entry) => entry.key));
            return { open, decorations: detailsDecorations(state.doc, open) };
          },
          apply: (tr, previous) => {
            const toggled = tr.getMeta(DETAILS_PLUGIN_KEY) as string | undefined;
            if (!tr.docChanged && !toggled) return previous;
            const open = new Set(previous.open);
            if (toggled) {
              if (open.has(toggled)) open.delete(toggled);
              else open.add(toggled);
            }
            return { open, decorations: detailsDecorations(tr.doc, open) };
          },
        },
        props: {
          decorations: (state) => DETAILS_PLUGIN_KEY.getState(state)?.decorations ?? null,
        },
      }),
  );
}

function documentChangePlugin(
  onDocChangeRef: { current: ((markdown: string) => void) | undefined },
  suppressDocChangeRef?: { current: boolean },
) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('NANA_DOCUMENT_CHANGE'),
        view: () => ({
          update(view, previousState) {
            if (view.state.doc.eq(previousState.doc)) return;
            // Remote/live snapshots must not be written back into Yjs. The
            // external apply wraps its synchronous dispatch with this flag.
            if (suppressDocChangeRef?.current) return;
            const markdown = normalizeMarkdown(ctx.get(serializerCtx)(view.state.doc));
            onDocChangeRef.current?.(markdown);
          },
        }),
      }),
  );
}

/**
 * Run an external snapshot apply with the document-change emitter muted.
 * ProseMirror delivers plugin `view.update` calls synchronously inside
 * `dispatch`, so a plain flag around the call is enough. Nested applies restore
 * the previous value, and the flag is always cleared after the callback even
 * when the transaction throws.
 */
export function withSuppressedDocumentChange(
  suppressRef: { current: boolean },
  apply: () => void,
): void {
  const previous = suppressRef.current;
  suppressRef.current = true;
  try {
    apply();
  } finally {
    suppressRef.current = previous;
  }
}

function slashPlugin(onSlashRef: { current: ((position: SlashTriggerPosition) => void) | undefined }) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('NANA_SLASH_MENU'),
        props: {
          handleKeyDown(view, event) {
            if (!onSlashRef.current) return false;
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false;

            const { selection } = view.state;
            if (!selection.empty) return false;
            const { $from } = selection;
            if (!$from.parent.isTextblock || $from.parent.type.name === 'code_block') return false;
            if ($from.marks().some((mark) => mark.type.name === 'inlineCode')) return false;

            const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
            if (before.length > 0 && !/\s$/.test(before)) return false;

            event.preventDefault();
            const coords = view.coordsAtPos($from.pos);
            onSlashRef.current({
              left: coords.left,
              top: coords.bottom + 6,
              bottom: coords.bottom,
            });
            return true;
          },
        },
      }),
  );
}

export async function createMilkdownEditor(options: CreateMilkdownEditorOptions): Promise<Editor> {
  const editor = Editor.make();

  editor.config((ctx: Ctx) => {
    ctx.set(rootCtx, options.root);
    ctx.set(defaultValueCtx, normalizeMarkdown(options.initialValue));
    ctx.set(editorViewOptionsCtx, {
      editable: () => !options.readOnlyRef.current,
      attributes: {
        class: 'nana-milkdown-prosemirror',
        'aria-label': options.ariaLabel,
        'aria-multiline': 'true',
        spellcheck: options.spellcheck ? 'true' : 'false',
      },
    });

    if (options.uploadImageRef.current) {
      const base = ctx.get(uploadConfig.key);
      ctx.set(uploadConfig.key, {
        ...base,
        uploader: async (files, schema) => {
          const nodes = [];
          for (const file of Array.from(files)) {
            const uploader = options.uploadImageRef.current;
            if (!uploader) continue;
            const image = schema.nodes.image;
            if (!image) continue;
            const src = await uploader(file);
            nodes.push(image.create({ src, alt: file.name }));
          }
          return Fragment.fromArray(nodes);
        },
      });
    }
  });

  editor.use([...commonmark, ...gfm, ...history, ...cursor, listener, ...prism]);
  editor.use(githubAlertPlugin());
  editor.use(githubDetailsPlugin());
  editor.use(legacyImageView);
  editor.use(legacyLinkPlugin());
  editor.use(placeholderPlugin(options.placeholderRef));
  editor.use(aiHighlightPlugin());
  editor.use(softBreakPlugin());
  editor.use(taskListClickPlugin());
  editor.use(collaboratorPresencePlugin());
  editor.use(documentChangePlugin(options.onDocChangeRef, options.suppressDocChangeRef));
  if (options.enableSlash !== false) editor.use(slashPlugin(options.onSlashRef));
  if (options.uploadImageRef.current) editor.use(upload);

  await editor.create();

  // Register listeners after create: `listenerCtx` is injected by the listener
  // plugin, which may not have run when `config` callbacks execute.
  editor.action((ctx) => {
    const listenerManager = ctx.get(listenerCtx);
    listenerManager.selectionUpdated(() => {
      // Milkdown calls this from the plugin's state.apply, before the view has
      // adopted the new state. Defer one microtask so getMarkdownSelection()
      // reads the selection the user just made, not the previous one.
      queueMicrotask(() => {
        options.onSelectionRef.current?.();
        options.onSelectionChangeRef?.current?.();
      });
    });
    listenerManager.updated(() => {
      options.onSelectionRef.current?.();
    });
    listenerManager.focus(() => {
      options.onFocusRef.current?.();
      options.onSelectionChangeRef?.current?.();
    });
    listenerManager.blur(() => {
      options.onBlurRef.current?.();
      options.onSelectionChangeRef?.current?.();
    });
  });

  return editor;
}

export function getEditorMarkdown(ctx: Ctx): string {
  return normalizeMarkdown(ctx.get(serializerCtx)(ctx.get(editorStateCtx).doc));
}

function textOffsetForProsePosition(map: ProseTextMap, position: number): number {
  let fallback = 0;
  for (const segment of map.segments) {
    if (position < segment.from) return segment.textStart;
    if (position <= segment.to) {
      return segment.textStart + Math.max(0, Math.min(position - segment.from, segment.textEnd - segment.textStart));
    }
    fallback = segment.textEnd;
  }
  return fallback;
}

/** Project the ProseMirror caret into Markdown source offsets. */
export function getMarkdownSelection(ctx: Ctx): { anchor: number; head: number } | null {
  const view = ctx.get(editorViewCtx);
  if (view.isDestroyed) return null;
  const markdown = getEditorMarkdown(ctx);
  const map = proseTextMap(view.state.doc);
  const segments = alignMarkdownToText(markdown, map.text);
  const anchorText = textOffsetForProsePosition(map, view.state.selection.anchor);
  const headText = textOffsetForProsePosition(map, view.state.selection.head);
  const anchor = textOffsetToMarkdownOffset(segments, anchorText);
  const head = textOffsetToMarkdownOffset(segments, headText);
  if (anchor === null || head === null) return null;
  return { anchor, head };
}

/** Resolve a Markdown offset to a ProseMirror position, when alignable. */
function prosePositionForMarkdownOffset(doc: ProseNode, markdown: string, offset: number): number | null {
  const map = proseTextMap(doc);
  const segments = alignMarkdownToText(markdown, map.text);
  const textOffset = markdownOffsetToTextOffset(segments, offset);
  if (textOffset === null) return null;
  return positionAt(map, textOffset);
}

/**
 * Keep a collapsed caret attached to the character that follows it. A caret at
 * the end of a line has no following character, so it stays before content
 * inserted there; a caret at the start or middle follows its text into a newly
 * inserted block. This is the content-anchoring rule remote splices need.
 */
export function caretAssocForMarkdown(markdown: string, offset: number | null): -1 | 1 {
  if (offset === null || offset < 0 || offset >= markdown.length) return -1;
  const next = markdown.charAt(offset);
  return next === '\n' || next === '\r' ? -1 : 1;
}

/**
 * One step in a top-level document update. The steps stay close to
 * ProseMirror's own transactions so the live selection is mapped by the
 * transform instead of being re-resolved from an unrelated snapshot.
 */
export type DocumentSyncStep =
  | { type: 'delete'; from: number; to: number }
  | {
    type: 'split';
    pos: number;
    depth: number;
    typesAfter: Array<{ type: NodeType; attrs?: Attrs | null }> | null;
  }
  | { type: 'join'; pos: number; depth: number }
  | { type: 'insert'; pos: number; content: Fragment }
  | { type: 'replace'; from: number; to: number; content: Fragment };

export interface DocumentSyncPlan {
  /** `split`/`merge` preserve an open slice; `inline` is a text splice. */
  kind: 'split' | 'merge' | 'inline' | 'replace';
  steps: DocumentSyncStep[];
  /** Map selection through this many steps, then through the rest backward. */
  selectionStepCount?: number;
}

function topLevelStarts(doc: ProseNode): number[] {
  const starts: number[] = [];
  doc.forEach((_node, offset) => {
    starts.push(offset);
  });
  starts.push(doc.content.size);
  return starts;
}

function sameAttributes(left: Attrs, right: Attrs): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

/** A textblock whose content only contains text or soft/hard line breaks. */
function isPlainTextblock(node: ProseNode): boolean {
  if (!node.isTextblock) return false;
  let plain = true;
  node.content.forEach((child) => {
    if (!child.isText && !isLineBreakNode(child)) plain = false;
  });
  return plain;
}

function isUnmarkedTextblock(node: ProseNode): boolean {
  if (!isPlainTextblock(node)) return false;
  let plain = true;
  node.content.forEach((child) => {
    if (child.isText && child.marks.length > 0) plain = false;
  });
  return plain;
}

function sameTextblockMarkup(left: ProseNode, right: ProseNode): boolean {
  return left.type === right.type && sameAttributes(left.attrs, right.attrs);
}

/** Plain text with hardbreaks represented as newlines. */
function textWithBreaks(node: ProseNode): string {
  let text = '';
  node.content.forEach((child) => {
    if (child.isText) text += child.text ?? '';
    else if (isLineBreakNode(child)) text += '\n';
  });
  return text;
}

/** Convert a text offset (breaks count as one) into a content offset. */
function textOffsetToContentOffset(node: ProseNode, textOffset: number): number {
  let text = 0;
  let content = 0;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child.isText) {
      const length = child.text?.length ?? 0;
      if (textOffset <= text + length) return content + Math.max(0, textOffset - text);
      text += length;
      content += length;
      continue;
    }
    if (isLineBreakNode(child)) {
      if (textOffset <= text) return content;
      text += 1;
      content += 1;
      continue;
    }
    content += child.nodeSize;
  }
  return content;
}

function sharedTopLevelRange(doc: ProseNode, nextDoc: ProseNode): { prefix: number; suffix: number } {
  let prefix = 0;
  while (
    prefix < doc.childCount
    && prefix < nextDoc.childCount
    && doc.child(prefix).eq(nextDoc.child(prefix))
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < doc.childCount - prefix
    && suffix < nextDoc.childCount - prefix
    && doc.child(doc.childCount - 1 - suffix).eq(nextDoc.child(nextDoc.childCount - 1 - suffix))
  ) {
    suffix += 1;
  }

  return { prefix, suffix };
}

/**
 * Detect one textblock splitting into two, the shape Enter produces. The old
 * text may lose the whitespace at the caret, so a short whitespace separator
 * between the halves is accepted and deleted before the split.
 */
interface TextblockSplitPlan {
  steps: DocumentSyncStep[];
  /** Number of structural steps; selection maps through these before any insertion. */
  selectionStepCount: number;
}

function planTextblockSplit(
  doc: ProseNode,
  nextDoc: ProseNode,
  prefix: number,
  suffix: number,
): TextblockSplitPlan | null {
  if (doc.childCount - prefix - suffix !== 1) return null;
  if (nextDoc.childCount - prefix - suffix !== 2) return null;

  const current = doc.child(prefix);
  const first = nextDoc.child(prefix);
  const second = nextDoc.child(prefix + 1);
  if (!isPlainTextblock(current) || !isPlainTextblock(first) || !isPlainTextblock(second)) {
    return null;
  }
  if (!sameTextblockMarkup(current, first)) return null;

  const text = textWithBreaks(current);
  const firstText = textWithBreaks(first);
  const secondText = textWithBreaks(second);
  if (!text.startsWith(firstText)) return null;

  const remainder = text.slice(firstText.length);
  let separator = '';
  let insertion = '';
  let insertAt: 'start' | 'end' | null = null;

  if (remainder.endsWith(secondText)) {
    // The old remainder carries a separator (usually a soft break or the
    // space at a split point) that the new blocks dropped.
    separator = remainder.slice(0, remainder.length - secondText.length);
    if (separator.length > 4 || !/^[ \t\r\n]*$/.test(separator)) return null;
  } else if (secondText.endsWith(remainder)) {
    // A remote insertion landed at the start of the moved tail while this
    // client typed at the same boundary. Split first, then insert the new
    // prefix into the second block.
    insertion = secondText.slice(0, secondText.length - remainder.length);
    insertAt = 'start';
  } else if (secondText.startsWith(remainder)) {
    insertion = secondText.slice(remainder.length);
    insertAt = 'end';
  } else {
    return null;
  }
  if (/[\r\n]/.test(insertion)) return null;
  if (!firstText && !secondText) return null;

  const starts = topLevelStarts(doc);
  const splitPos = starts[prefix]! + 1 + textOffsetToContentOffset(current, firstText.length);
  const steps: DocumentSyncStep[] = [];
  if (separator.length > 0) {
    steps.push({ type: 'delete', from: splitPos, to: splitPos + separator.length });
  }
  steps.push({
    type: 'split',
    pos: splitPos,
    depth: 1,
    typesAfter: [{ type: second.type, attrs: second.attrs }],
  });

  const selectionStepCount = steps.length;
  if (insertion) {
    // Positions in the step list are relative to the document after the
    // preceding steps. Use a probe to find the second block's content range.
    const probe = new Transform(doc);
    applyDocumentSyncSteps(probe, steps);
    const splitStarts = topLevelStarts(probe.doc);
    const secondStart = splitStarts[prefix + 1]! + 1;
    const secondBlock = probe.doc.child(prefix + 1);
    const insertPos = insertAt === 'start'
      ? secondStart
      : secondStart + textOffsetToContentOffset(secondBlock, textWithBreaks(secondBlock).length);
    steps.push({
      type: 'insert',
      pos: insertPos,
      content: Fragment.from(second.type.schema.text(insertion)),
    });
  }
  return { steps, selectionStepCount };
}

/** Detect two adjacent textblocks merging back into one (Backspace/Delete). */
function planTextblockMerge(
  doc: ProseNode,
  nextDoc: ProseNode,
  prefix: number,
  suffix: number,
): DocumentSyncStep[] | null {
  if (doc.childCount - prefix - suffix !== 2) return null;
  if (nextDoc.childCount - prefix - suffix !== 1) return null;

  const first = doc.child(prefix);
  const second = doc.child(prefix + 1);
  const merged = nextDoc.child(prefix);
  if (!isPlainTextblock(first) || !isPlainTextblock(second) || !isPlainTextblock(merged)) {
    return null;
  }
  if (!sameTextblockMarkup(first, merged)) return null;
  if (textWithBreaks(first) + textWithBreaks(second) !== textWithBreaks(merged)) return null;

  const starts = topLevelStarts(doc);
  return [{ type: 'join', pos: starts[prefix + 1]!, depth: 1 }];
}

/**
 * Apply an inline change inside one textblock with a normal delete/insert step.
 * Replacing the whole block would collapse a caret in that block; a text splice
 * lets ProseMirror map it. This covers typing that arrives while the Markdown
 * source contains a hardbreak or a normalization-only formatting difference.
 */
function planTextblockInline(
  doc: ProseNode,
  nextDoc: ProseNode,
  prefix: number,
  suffix: number,
): DocumentSyncStep[] | null {
  if (doc.childCount - prefix - suffix !== 1) return null;
  if (nextDoc.childCount - prefix - suffix !== 1) return null;

  const current = doc.child(prefix);
  const next = nextDoc.child(prefix);
  if (!sameTextblockMarkup(current, next)) return null;
  if (!isUnmarkedTextblock(current) || !isUnmarkedTextblock(next)) return null;

  const currentText = textWithBreaks(current);
  const nextText = textWithBreaks(next);
  const change = minimalTextChange(currentText, nextText);
  if (!change) return null;
  if (/[\r\n]/.test(change.insert) || /[\r\n]/.test(currentText.slice(change.from, change.to))) {
    return null;
  }

  const start = topLevelStarts(doc)[prefix]! + 1;
  const from = textOffsetToContentOffset(current, change.from);
  const to = textOffsetToContentOffset(current, change.to);
  const steps: DocumentSyncStep[] = [];
  if (to > from) steps.push({ type: 'delete', from: start + from, to: start + to });
  if (change.insert) {
    steps.push({
      type: 'insert',
      pos: start + from,
      content: Fragment.from(next.type.schema.text(change.insert)),
    });
  }
  return steps.length > 0 ? steps : null;
}

/** Replace only the changed top-level block range; the rest of the doc is intact. */
function planTopLevelReplace(
  doc: ProseNode,
  nextDoc: ProseNode,
  prefix: number,
  suffix: number,
): DocumentSyncStep[] {
  const starts = topLevelStarts(doc);
  const content: ProseNode[] = [];
  for (let index = prefix; index < nextDoc.childCount - suffix; index += 1) {
    content.push(nextDoc.child(index));
  }
  return [{
    type: 'replace',
    from: starts[prefix]!,
    to: starts[doc.childCount - suffix]!,
    content: Fragment.fromArray(content),
  }];
}

export function applyDocumentSyncSteps(
  transform: Transform,
  steps: readonly DocumentSyncStep[],
): void {
  for (const step of steps) {
    switch (step.type) {
      case 'delete':
        transform.delete(step.from, step.to);
        break;
      case 'split':
        transform.split(step.pos, step.depth, step.typesAfter ?? undefined);
        break;
      case 'join':
        transform.join(step.pos, step.depth);
        break;
      case 'insert':
        transform.replaceWith(step.pos, step.pos, step.content);
        break;
      case 'replace':
        transform.replace(step.from, step.to, new Slice(step.content, 0, 0));
        break;
    }
  }
}

/**
 * Plan the smallest document update between two parsed states.
 *
 * Textblock splits and merges get open-slice steps so ProseMirror keeps the
 * local caret inside its block. Everything else replaces only the changed
 * top-level node range. Returns `null` when no candidate reproduces `nextDoc`;
 * the caller then has a conservative whole-document fallback.
 */
export function planDocumentSync(doc: ProseNode, nextDoc: ProseNode): DocumentSyncPlan | null {
  if (doc.eq(nextDoc)) return null;

  const { prefix, suffix } = sharedTopLevelRange(doc, nextDoc);
  const candidates: DocumentSyncPlan[] = [];

  const split = planTextblockSplit(doc, nextDoc, prefix, suffix);
  if (split) {
    candidates.push({
      kind: 'split',
      steps: split.steps,
      selectionStepCount: split.selectionStepCount,
    });
  }

  const merge = planTextblockMerge(doc, nextDoc, prefix, suffix);
  if (merge) candidates.push({ kind: 'merge', steps: merge });

  const inline = planTextblockInline(doc, nextDoc, prefix, suffix);
  if (inline) candidates.push({ kind: 'inline', steps: inline });

  candidates.push({
    kind: 'replace',
    steps: planTopLevelReplace(doc, nextDoc, prefix, suffix),
  });

  for (const candidate of candidates) {
    try {
      const probe = new Transform(doc);
      applyDocumentSyncSteps(probe, candidate.steps);
      if (probe.doc.eq(nextDoc)) return candidate;
    } catch {
      // Try the next, wider candidate.
    }
  }

  return null;
}

/**
 * Apply an incoming value without replacing the whole document when only a
 * small region changed. The selection is projected through the Markdown edit,
 * so a remote keystroke elsewhere does not move the local caret.
 */
export function replaceEditorMarkdownPreservingSelection(ctx: Ctx, markdown: string): void {
  const view = ctx.get(editorViewCtx);
  const parser = ctx.get(parserCtx);
  const serializer = ctx.get(serializerCtx);
  const current = getEditorMarkdown(ctx);
  const next = normalizeMarkdown(markdown);
  if (current === next) return;

  const change = minimalTextChange(current, next);
  if (!change) return;

  const deletedText = current.slice(change.from, change.to);
  const containsLineBreak = /[\r\n]/.test(change.insert) || /[\r\n]/.test(deletedText);

  // Fast path: a plain text insertion/deletion can be applied as a normal
  // ProseMirror transaction. ProseMirror then maps the live selection through
  // the change and leaves composition/local typing intact. The serializer
  // check below is the safety net: if the Markdown meaning changed (a marker,
  // block boundary, or formatting edit), fall back to a parsed document.
  //
  // Never use it for a diff containing a line break. `insertText` would put a
  // literal "\n\n" inside the current textblock instead of splitting it, and
  // the serializer can still round-trip to the same Markdown even though the
  // receiver's ProseMirror structure now differs from the sender's.
  if (!containsLineBreak) {
    const textMap = proseTextMap(view.state.doc);
    const segments = alignMarkdownToText(current, textMap.text);
    const fromText = markdownOffsetToTextOffset(segments, change.from);
    const toText = change.to === change.from
      ? fromText
      : markdownOffsetToTextOffset(segments, change.to);

    if (fromText !== null && toText !== null) {
      const from = positionAt(textMap, fromText);
      const to = positionAt(textMap, toText);
      const $from = view.state.doc.resolve(from);
      const $to = view.state.doc.resolve(to);
      const sameTextblock = $from.parent.inlineContent
        && $to.parent.inlineContent
        && $from.parent === $to.parent;

      if (sameTextblock) {
        const transaction = view.state.tr.setMeta('addToHistory', false);
        if (change.to > change.from) transaction.delete(from, to);
        if (change.insert) transaction.insertText(change.insert, from);
        if (normalizeMarkdown(serializer(transaction.doc)) === next) {
          view.dispatch(transaction);
          return;
        }
      }
    }
  }

  // Structural or formatting change. Parse the target and apply the narrowest
  // transaction that reproduces it. A textblock split/merge keeps the caret on
  // the text that moved; a block replacement leaves every other block (and the
  // selection mapping through it) untouched. Only the changed top-level range
  // is replaced, never the whole document.
  const nextDoc = parser(next);
  if (!nextDoc) return;
  if (view.state.doc.eq(nextDoc)) return;

  const oldSelection = view.state.selection;
  const oldMarkdownSelection = getMarkdownSelection(ctx);
  const collapsedAssoc = oldMarkdownSelection
    ? caretAssocForMarkdown(current, oldMarkdownSelection.head)
    : -1;

  const plan = planDocumentSync(view.state.doc, nextDoc);
  if (plan) {
    const transaction = view.state.tr.setMeta('addToHistory', false);
    try {
      applyDocumentSyncSteps(transaction, plan.steps);
      if (transaction.doc.eq(nextDoc)) {
        // Map the caret through the structural part first, then through any
        // content inserted at the same boundary with backward association. A
        // remote block inserted at the caret must not drag the local caret into
        // the remote writer's text; the local user's following keystroke must
        // stay in its own block.
        if (transaction.docChanged) {
          const selectionStepCount = plan.selectionStepCount ?? plan.steps.length;
          const structural = transaction.mapping.slice(0, selectionStepCount);
          const tail = transaction.mapping.slice(selectionStepCount);
          const mapPosition = (position: number, assoc: -1 | 1) =>
            tail.map(structural.map(position, assoc), -1);
          const anchor = mapPosition(
            oldSelection.anchor,
            oldSelection.empty ? collapsedAssoc : -1,
          );
          const head = mapPosition(
            oldSelection.head,
            oldSelection.empty ? collapsedAssoc : 1,
          );
          try {
            transaction.setSelection(TextSelection.create(
              transaction.doc,
              Math.min(anchor, head),
              Math.max(anchor, head),
            ));
          } catch {
            // A node selection cannot be restored as a text selection; leave
            // ProseMirror's mapped selection in place.
          }
        }
        view.dispatch(transaction);
        return;
      }
    } catch {
      // The schema rejected a targeted step; use the conservative fallback.
    }
  }

  // Conservative fallback for documents the targeted diff cannot represent.
  // Map the selection against the transaction's own document. When the
  // Markdown projection cannot place it, leave ProseMirror's step mapping in
  // charge rather than forcing the caret to the document end.
  const selection = getMarkdownSelection(ctx);
  const mapped = selection
    ? mapSelectionThroughChange(selection.anchor, selection.head, change)
    : null;
  const anchor = mapped?.anchor ?? null;
  const head = mapped?.head ?? null;

  const transaction = view.state.tr
    .replace(0, view.state.doc.content.size, new Slice(nextDoc.content, 0, 0))
    .setMeta('addToHistory', false);

  if (anchor !== null && head !== null) {
    const anchorPosition = prosePositionForMarkdownOffset(transaction.doc, next, anchor);
    const headPosition = prosePositionForMarkdownOffset(transaction.doc, next, head);
    if (anchorPosition !== null && headPosition !== null) {
      const max = Math.max(1, transaction.doc.content.size);
      const from = Math.max(0, Math.min(anchorPosition, max));
      const to = Math.max(0, Math.min(headPosition, max));
      try {
        transaction.setSelection(TextSelection.create(
          transaction.doc,
          Math.min(from, to),
          Math.max(from, to),
        ));
      } catch {
        // The mapped point landed on a node boundary; leave the selection to
        // ProseMirror's default mapping rather than failing the update.
      }
    }
  }

  view.dispatch(transaction);
}

export function replaceEditorMarkdown(ctx: Ctx, markdown: string): void {
  const view = ctx.get(editorViewCtx);
  const parser = ctx.get(parserCtx);
  const doc = parser(normalizeMarkdown(markdown));
  if (!doc) return;
  const { state } = view;
  view.dispatch(state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)));
}

export function setEditorEditable(ctx: Ctx, readOnly: boolean): void {
  const view = ctx.get(editorViewCtx);
  view.setProps({ editable: () => !readOnly });
  view.dom.dataset.readonly = readOnly ? 'true' : 'false';
  // Refresh decorations so the placeholder appears or disappears with the mode.
  view.dispatch(view.state.tr.setMeta('nana-readonly', readOnly));
}
