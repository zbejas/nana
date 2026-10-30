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
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { prism } from '@milkdown/plugin-prism';
import { rewriteLegacyFileUrl } from '../../../lib/legacy-urls';
import type { AiTextChange } from './aiDiff';
import { normalizeMarkdown } from './helpers';

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
  enableSlash?: boolean;
  onDocChangeRef: { current: ((markdown: string) => void) | undefined };
  onSelectionRef: { current: (() => void) | undefined };
  onFocusRef: { current: (() => void) | undefined };
  onBlurRef: { current: (() => void) | undefined };
  onSlashRef: { current: ((position: SlashTriggerPosition) => void) | undefined };
  uploadImageRef: { current: ((file: File) => Promise<string>) | undefined };
}

/** Render legacy `/pb/api/files/...` image URLs through the `/api/v1` route. */
const legacyImageView = $view(imageSchema.node, () => (node) => {
  const image = document.createElement('img');

  const apply = (value: typeof node) => {
    image.src = rewriteLegacyFileUrl(value.attrs.src as string) ?? '';
    image.alt = (value.attrs.alt as string) ?? '';
    if (value.attrs.title) image.title = value.attrs.title as string;
    else image.removeAttribute('title');
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
            return previous.map(tr.mapping, tr.doc);
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

function scrollToTextPosition(view: EditorView, pos: number): void {
  if (view.isDestroyed) return;
  const resolved = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
  const blockPos = resolved.depth > 0 ? resolved.before(1) : resolved.pos;
  const node = view.nodeDOM(blockPos);
  if (node instanceof HTMLElement) {
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
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

/**
 * Apply a short inline diff. Inserted text gets a green wash; deleted text is
 * shown as a red strike-through widget at the new insertion point. The source
 * document is never changed by these decorations.
 */
export function setAiDiffHighlights(
  view: EditorView,
  changes: readonly AiTextChange[],
  map: ProseTextMap,
  duration = 450,
): boolean {
  if (view.isDestroyed || changes.length === 0) return false;

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
          { class: 'nana-ai-diff-insert' },
        ));
      }
      continue;
    }

    const span = document.createElement('span');
    span.className = 'nana-ai-diff-delete';
    span.textContent = change.text.length > 600
      ? `${change.text.slice(0, 600)}…`
      : change.text;
    span.setAttribute('aria-hidden', 'true');
    decorations.push(Decoration.widget(
      positionAt(map, change.start),
      span,
      { side: -1 },
    ));
  }

  if (decorations.length === 0) return false;

  view.dispatch(
    view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.create(view.state.doc, decorations)),
  );
  scrollToTextPosition(view, positionAt(map, changes[0]!.start));
  scheduleAiDecorationClear(view, duration);
  return true;
}

/**
 * Applies the AI-edit wash through ProseMirror decorations rather than DOM
 * classes. Milkdown re-renders node DOM after transactions; a class added
 * directly to the DOM can disappear before the user sees it.
 */
export function setAiHighlights(view: EditorView, ranges: AiHighlightRange[], duration = 700): void {
  if (view.isDestroyed || ranges.length === 0) return;

  const decorations = ranges.map((range) =>
    Decoration.node(range.from, range.to, {
      class: 'nana-ai-edited',
      ...(range.heading ? { 'data-nana-ai-heading': 'true' } : {}),
    }),
  );

  view.dispatch(
    view.state.tr.setMeta(AI_HIGHLIGHT_KEY, DecorationSet.create(view.state.doc, decorations)),
  );

  const first = ranges[0];
  if (first) {
    const node = view.nodeDOM(first.from);
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  scheduleAiDecorationClear(view, duration);
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

function documentChangePlugin(onDocChangeRef: { current: ((markdown: string) => void) | undefined }) {
  return $prose(
    (ctx) =>
      new Plugin({
        key: new PluginKey('NANA_DOCUMENT_CHANGE'),
        view: () => ({
          update(view, previousState) {
            if (view.state.doc.eq(previousState.doc)) return;
            const markdown = normalizeMarkdown(ctx.get(serializerCtx)(view.state.doc));
            onDocChangeRef.current?.(markdown);
          },
        }),
      }),
  );
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
        spellcheck: 'true',
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
  editor.use(taskListClickPlugin());
  editor.use(documentChangePlugin(options.onDocChangeRef));
  if (options.enableSlash !== false) editor.use(slashPlugin(options.onSlashRef));
  if (options.uploadImageRef.current) editor.use(upload);

  await editor.create();

  // Register listeners after create: `listenerCtx` is injected by the listener
  // plugin, which may not have run when `config` callbacks execute.
  editor.action((ctx) => {
    const listenerManager = ctx.get(listenerCtx);
    listenerManager.selectionUpdated(() => {
      options.onSelectionRef.current?.();
    });
    listenerManager.updated(() => {
      options.onSelectionRef.current?.();
    });
    listenerManager.focus(() => {
      options.onFocusRef.current?.();
    });
    listenerManager.blur(() => {
      options.onBlurRef.current?.();
    });
  });

  return editor;
}

export function getEditorMarkdown(ctx: Ctx): string {
  return normalizeMarkdown(ctx.get(serializerCtx)(ctx.get(editorStateCtx).doc));
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
