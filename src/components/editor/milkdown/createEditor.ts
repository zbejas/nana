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
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { prism } from '@milkdown/plugin-prism';
import { rewriteLegacyFileUrl } from '../../../lib/legacy-urls';
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
  editor.use(legacyImageView);
  editor.use(legacyLinkPlugin());
  editor.use(placeholderPlugin(options.placeholderRef));
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
