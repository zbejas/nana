import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorStateCtx, editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  createMilkdownEditor,
  getEditorMarkdown,
  getMarkdownSelection,
  replaceEditorMarkdownPreservingSelection,
  setCollaboratorHighlights,
  setEditorEditable,
  type SlashTriggerPosition,
} from './createEditor';
import {
  EMPTY_TOOLBAR_STATE,
  applyLink,
  readToolbarState,
  runEditorAction,
  type EditorToolbarState,
} from './editorActions';
import { applyAiMarkdown, type AiChangedSection } from './aiEdits';
import type { EditorActionId } from './helpers';
import { normalizeMarkdown } from './helpers';
import type { Collaborator } from '../../../lib/collaboration/types';

export interface UseMilkdownEditorOptions {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  spellcheck?: boolean;
  enableSlash?: boolean;
  uploadImage?: (file: File) => Promise<string>;
  aiEdit?: {
    id: string;
    previousMarkdown: string;
    markdown: string;
    sections: AiChangedSection[];
  } | null;
  collaborators?: Collaborator[];
  onSelectionChange?: (selection: { anchor: number; head: number; focused: boolean; pane?: "source" | "wysiwyg" }) => void;
  onFocusChange?: (focused: boolean) => void;
  onSlash?: (position: SlashTriggerPosition) => void;
  onReady?: (editor: Editor) => void;
}

export interface UseMilkdownEditorResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  focused: boolean;
  toolbar: EditorToolbarState;
  run: (action: EditorActionId) => boolean;
  applyHref: (href: string) => boolean;
  focus: () => void;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  getSelection: () => { from: number; to: number } | null;
  setSelection: (from: number, to: number) => void;
  getView: () => EditorView | null;
}

function sameToolbarState(left: EditorToolbarState, right: EditorToolbarState): boolean {
  return (
    left.paragraph === right.paragraph &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.strike === right.strike &&
    left.inlineCode === right.inlineCode &&
    left.link === right.link &&
    left.headingLevel === right.headingLevel &&
    left.bulletList === right.bulletList &&
    left.orderedList === right.orderedList &&
    left.taskList === right.taskList &&
    left.quote === right.quote &&
    left.codeBlock === right.codeBlock &&
    left.canUndo === right.canUndo &&
    left.canRedo === right.canRedo &&
    left.linkHref === right.linkHref
  );
}

/**
 * Owns one Milkdown instance for the lifetime of the component.
 *
 * StrictMode runs the create/destroy effect twice, so the effect cancels a
 * create that finishes after unmount. `value` is never part of the factory
 * dependencies; incoming values are compared against the last emitted markdown
 * and applied in a layout effect so a remote update reaches the editor before
 * the next keystroke. ProseMirror maps the local selection through the
 * incremental change.
 */
export function useMilkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = '',
  ariaLabel = 'Document content',
  spellcheck = false,
  enableSlash = true,
  uploadImage,
  aiEdit = null,
  collaborators = [],
  onSelectionChange,
  onFocusChange,
  onSlash,
  onReady,
}: UseMilkdownEditorOptions): UseMilkdownEditorResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [toolbar, setToolbar] = useState<EditorToolbarState>(EMPTY_TOOLBAR_STATE);

  const valueRef = useRef(value);
  const readOnlyRef = useRef(readOnly);
  const placeholderRef = useRef(placeholder);
  const onChangeRef = useRef(onChange);
  const onFocusChangeRef = useRef(onFocusChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onSlashRef = useRef(onSlash);
  const onReadyRef = useRef(onReady);
  const uploadImageRef = useRef(uploadImage);
  const collaboratorsRef = useRef(collaborators);
  const hadCollaboratorsRef = useRef(false);
  const lastAiEditRef = useRef<string | null>(null);
  const lastEmittedRef = useRef(normalizeMarkdown(value));
  const lastAppliedRef = useRef(normalizeMarkdown(value));
  const toolbarRef = useRef(toolbar);

  valueRef.current = value;
  readOnlyRef.current = readOnly;
  placeholderRef.current = placeholder;
  onChangeRef.current = onChange;
  onFocusChangeRef.current = onFocusChange;
  onSelectionChangeRef.current = onSelectionChange;
  onSlashRef.current = onSlash;
  onReadyRef.current = onReady;
  uploadImageRef.current = uploadImage;
  collaboratorsRef.current = collaborators;
  toolbarRef.current = toolbar;

  const refreshToolbar = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = editor.action((ctx) => readToolbarState(ctx.get(editorStateCtx)));
    if (!sameToolbarState(toolbarRef.current, next)) {
      toolbarRef.current = next;
      setToolbar(next);
    }
  }, []);

  const emitChange = useCallback((markdown: string) => {
    const normalized = normalizeMarkdown(markdown);
    // The editor already shows this value; remembering it here keeps the
    // incoming-value effect from replaying our own keystrokes.
    lastAppliedRef.current = normalized;
    if (normalized === lastEmittedRef.current) return;
    lastEmittedRef.current = normalized;
    onChangeRef.current?.(normalized);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    let cancelled = false;
    let instance: Editor | null = null;

    const bootstrap = async () => {
      const editor = await createMilkdownEditor({
        root,
        initialValue: valueRef.current,
        readOnlyRef,
        placeholderRef,
        ariaLabel,
        spellcheck,
        enableSlash,
        onDocChangeRef: { current: emitChange },
        onSelectionRef: { current: refreshToolbar },
        onSelectionChangeRef: {
          current: () => {
            const editor = editorRef.current;
            if (!editor) return;
            const selection = editor.action((ctx) => getMarkdownSelection(ctx));
            if (!selection) return;
            const focusedNow = editor.action((ctx) => ctx.get(editorViewCtx).hasFocus());
            onSelectionChangeRef.current?.({
              anchor: selection.anchor,
              head: selection.head,
              focused: focusedNow,
              pane: 'wysiwyg',
            });
          },
        },
        onFocusRef: { current: () => setFocused(true) },
        onBlurRef: { current: () => setFocused(false) },
        onSlashRef,
        uploadImageRef,
      });

      instance = editor;
      if (cancelled) {
        void editor.destroy();
        return;
      }

      editorRef.current = editor;
      lastAppliedRef.current = normalizeMarkdown(valueRef.current);

      const baseline = editor.action((ctx) => getEditorMarkdown(ctx));
      lastEmittedRef.current = baseline;
      editor.action((ctx) => setEditorEditable(ctx, readOnlyRef.current));
      setReady(true);
      refreshToolbar();
      onReadyRef.current?.(editor);
    };

    void bootstrap();

    return () => {
      cancelled = true;
      if (editorRef.current === instance) editorRef.current = null;
      setReady(false);
      if (instance) void instance.destroy();
    };
    // The editor factory must not depend on `value`; content arrives through
    // the synchronization effects below. The effect intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Incoming values from the other pane, realtime, or a document switch.
  // Layout timing is deliberate: a remote Yjs update must reach this editor
  // before the next local keystroke can diff against a newer Y.Doc.
  useLayoutEffect(() => {
    if (!ready) return;
    const incoming = normalizeMarkdown(value);
    if (incoming === lastAppliedRef.current) return;

    const editor = editorRef.current;
    if (!editor) return;

    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, incoming));
    refreshToolbar();
  }, [value, ready, refreshToolbar]);

  useEffect(() => {
    if (!ready) return;
    const editor = editorRef.current;
    if (!editor) return;
    const hasCollaborators = collaborators.length > 0;
    if (!hasCollaborators && !hadCollaboratorsRef.current) return;
    hadCollaboratorsRef.current = hasCollaborators;
    editor.action((ctx) => setCollaboratorHighlights(ctx, collaborators));
  }, [collaborators, ready]);

  // AI edits get their own path so the diff still applies when a realtime
  // update already pushed the new Markdown into the editor. The previous
  // Markdown is parsed independently; the current doc is never reused as the
  // "before" snapshot.
  useEffect(() => {
    if (!ready || !aiEdit) return;
    if (lastAiEditRef.current === aiEdit.id) return;

    const editor = editorRef.current;
    if (!editor) return;

    const incoming = normalizeMarkdown(aiEdit.markdown);
    lastAiEditRef.current = aiEdit.id;
    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    applyAiMarkdown(editor, incoming, aiEdit.previousMarkdown, aiEdit.sections);
    refreshToolbar();
  }, [aiEdit, ready, refreshToolbar]);

  // A pane that was focused while an external value arrived catches up on blur.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleFocusOut = () => {
      window.setTimeout(() => {
        const editor = editorRef.current;
        if (!editor || root.contains(document.activeElement)) return;
        const incoming = normalizeMarkdown(valueRef.current);
        if (incoming === lastAppliedRef.current) return;
        lastAppliedRef.current = incoming;
        lastEmittedRef.current = incoming;
        editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, incoming));
        refreshToolbar();
      }, 0);
    };

    root.addEventListener('focusout', handleFocusOut);
    return () => root.removeEventListener('focusout', handleFocusOut);
  }, [refreshToolbar]);

  useEffect(() => {
    if (!ready) return;
    editorRef.current?.action((ctx) => setEditorEditable(ctx, readOnly));
  }, [readOnly, ready]);

  useEffect(() => {
    if (!ready) return;
    onFocusChangeRef.current?.(focused);
  }, [focused, ready]);

  useEffect(() => {
    if (!ready) return;
    const editor = editorRef.current;
    if (!editor) return;
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dom.setAttribute('aria-label', ariaLabel);
    view.dom.setAttribute('spellcheck', spellcheck ? 'true' : 'false');
  }, [ariaLabel, spellcheck, ready]);

  const run = useCallback((action: EditorActionId) => {
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.action((ctx) => runEditorAction(ctx, action));
  }, []);

  const applyHref = useCallback((href: string) => {
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.action((ctx) => applyLink(ctx, href));
  }, []);

  const focus = useCallback(() => {
    editorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus());
  }, []);

  const getMarkdown = useCallback(() => {
    const editor = editorRef.current;
    return editor ? editor.action((ctx) => getEditorMarkdown(ctx)) : normalizeMarkdown(valueRef.current);
  }, []);

  const setMarkdown = useCallback(
    (markdown: string) => {
      const normalized = normalizeMarkdown(markdown);
      const editor = editorRef.current;
      if (!editor) return;
      lastAppliedRef.current = normalized;
      lastEmittedRef.current = normalized;
      editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, normalized));
      refreshToolbar();
    },
    [refreshToolbar],
  );

  const getView = useCallback(() => {
    const editor = editorRef.current;
    return editor ? editor.action((ctx) => ctx.get(editorViewCtx)) : null;
  }, []);

  const getSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    return editor.action((ctx) => {
      const { selection } = ctx.get(editorStateCtx);
      return { from: selection.from, to: selection.to };
    });
  }, []);

  const setSelection = useCallback((from: number, to: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const max = state.doc.content.size;
      const start = Math.min(Math.max(0, from), max);
      const end = Math.min(Math.max(start, to), max);
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
      view.focus();
    });
  }, []);

  // The listener fires before React knows about the new document; keep the
  // toolbar snapshot in sync after every external value application too.
  useEffect(() => {
    if (ready) refreshToolbar();
  }, [ready, refreshToolbar]);

  return {
    containerRef,
    ready,
    focused,
    toolbar,
    run,
    applyHref,
    focus,
    getMarkdown,
    setMarkdown,
    getSelection,
    setSelection,
    getView,
  };
}
