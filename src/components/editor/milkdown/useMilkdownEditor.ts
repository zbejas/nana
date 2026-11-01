import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorStateCtx, editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  clearAiHighlights,
  createMilkdownEditor,
  getEditorMarkdown,
  getMarkdownSelection,
  replaceEditorMarkdownPreservingSelection,
  setCollaboratorHighlights,
  setEditorEditable,
  withSuppressedDocumentChange,
  type SlashTriggerPosition,
} from './createEditor';
import {
  EMPTY_TOOLBAR_STATE,
  applyLink,
  readToolbarState,
  runEditorAction,
  type EditorToolbarState,
} from './editorActions';
import {
  applyAiMarkdown,
  editorMatchesMarkdown,
  planAiMarkdownApply,
  type AiChangedSection,
} from './aiEdits';
import type { EditorActionId } from './helpers';
import { normalizeMarkdown } from './helpers';
import {
  WYSIWYG_BINDING_ORIGIN,
  WysiwygSessionBinding,
  initialWysiwygMarkdown,
  wysiwygLocalOps,
} from './wysiwygBinding';
import type { Collaborator } from '../../../lib/collaboration/types';
import type { CollabSession } from '../../../lib/collaboration/session';

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
    /** false when a live room already owns the body; paint only. */
    replace?: boolean;
  } | null;
  collaborators?: Collaborator[];
  /**
   * The open note's live session. When present, the editor publishes canonical
   * ops and applies observed session text directly; `value`/`onChange` stay as
   * UI state only. When null, the controlled snapshot path is unchanged.
   */
  session?: CollabSession | null;
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
 *
 * With a live `session`, the canonical text replaces that snapshot loop: local
 * transactions publish ops tagged `WYSIWYG_BINDING_ORIGIN`, and every other
 * canonical transaction is applied here without echoing back. Inline editors
 * and notes without a room keep the controlled `value`/`onChange` path.
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
  session = null,
  onSelectionChange,
  onFocusChange,
  onSlash,
  onReady,
}: UseMilkdownEditorOptions): UseMilkdownEditorResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const sessionRef = useRef(session);
  const bindingRef = useRef<WysiwygSessionBinding | null>(null);
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
  // Canonical baseline used before the binding effect attaches. It tracks the
  // session, not the React value, so an early keystroke diffs against Yjs.
  const lastCanonicalRef = useRef(initialWysiwygMarkdown(session?.markdown, value));
  const toolbarRef = useRef(toolbar);
  const suppressDocChangeRef = useRef(false);

  valueRef.current = value;
  sessionRef.current = session;
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

    const binding = bindingRef.current;
    if (binding) {
      const changed = binding.publishLocal(normalized);
      lastCanonicalRef.current = binding.canonicalMarkdown;
      if (!changed || normalized === lastEmittedRef.current) return;
      lastEmittedRef.current = normalized;
      // UI statistics, AI diff, and dirty state only. The canonical edit was
      // already published through this pane's ops, so onChange must not be a
      // second session write.
      onChangeRef.current?.(normalized);
      return;
    }

    const activeSession = sessionRef.current;
    if (activeSession) {
      // The editor became editable before the attach effect ran. Publish the
      // same minimal ops instead of falling back to a full snapshot write.
      const ops = wysiwygLocalOps(lastCanonicalRef.current, normalized);
      lastCanonicalRef.current = normalized;
      if (ops.length > 0) activeSession.applyLocalOps(ops, WYSIWYG_BINDING_ORIGIN);
      if (normalized === lastEmittedRef.current) return;
      lastEmittedRef.current = normalized;
      onChangeRef.current?.(normalized);
      return;
    }

    if (normalized === lastEmittedRef.current) return;
    lastEmittedRef.current = normalized;
    onChangeRef.current?.(normalized);
  }, []);

  /**
   * Dispatch a value that came from Yjs, another pane, or an AI edit. The
   * synchronous document-change plugin is muted for that dispatch, so a
   * round-tripped or normalization-different snapshot cannot be written back
   * into the shared text as a duplicate edit. Local keystrokes never pass
   * through here.
   */
  const runExternalApply = useCallback((apply: () => void) => {
    withSuppressedDocumentChange(suppressDocChangeRef, apply);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    let cancelled = false;
    let instance: Editor | null = null;

    const bootstrap = async () => {
      const editor = await createMilkdownEditor({
        root,
        // In session mode the canonical text is the source; `value` is only the
        // fallback before the room's first sync.
        initialValue: initialWysiwygMarkdown(sessionRef.current?.markdown, valueRef.current),
        readOnlyRef,
        placeholderRef,
        ariaLabel,
        spellcheck,
        enableSlash,
        onDocChangeRef: { current: emitChange },
        suppressDocChangeRef,
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
      lastCanonicalRef.current = baseline;
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

  // The session binding owns content in live mode. It applies every canonical
  // transaction that did not originate in this pane, and catches up when the
  // editor mounts after the room already synced.
  useLayoutEffect(() => {
    if (!ready || !session) return;
    const editor = editorRef.current;
    if (!editor) return;

    const binding = new WysiwygSessionBinding(
      session,
      {
        getMarkdown: () => {
          const current = editorRef.current;
          return current
            ? current.action((ctx) => getEditorMarkdown(ctx))
            : lastCanonicalRef.current;
        },
        applyMarkdown: (markdown) => {
          lastAppliedRef.current = markdown;
          lastEmittedRef.current = markdown;
          lastCanonicalRef.current = markdown;
          runExternalApply(() => {
            const current = editorRef.current;
            current?.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, markdown));
          });
          refreshToolbar();
        },
      },
      lastCanonicalRef.current,
    );

    bindingRef.current = binding;
    binding.attach();
    lastCanonicalRef.current = binding.canonicalMarkdown;

    return () => {
      if (bindingRef.current === binding) bindingRef.current = null;
      binding.dispose();
    };
  }, [ready, session, refreshToolbar, runExternalApply]);

  // Incoming values from the other pane, realtime, or a document switch.
  // Layout timing is deliberate: a remote Yjs update must reach this editor
  // before the next local keystroke can diff against a newer Y.Doc.
  // In session mode the canonical observer is the only content path; replaying
  // `value` here would apply source→WYS updates twice.
  useLayoutEffect(() => {
    if (!ready || session) return;
    const incoming = normalizeMarkdown(value);
    if (incoming === lastAppliedRef.current) return;

    const editor = editorRef.current;
    if (!editor) return;

    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    runExternalApply(() => {
      editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, incoming));
    });
    refreshToolbar();
  }, [value, ready, session, refreshToolbar, runExternalApply]);

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
  //
  // In session mode the AI body already reached Yjs through the room and the
  // canonical observer applied it here. This path must never replace the
  // document: the room owns content, and a stale replacement would desync
  // ProseMirror from Yjs so the next local edit could delete newer text. When
  // the room body already matches the fetched body, paint only; otherwise wait
  // for the room/content commit to reach this editor, then paint against it.
  useEffect(() => {
    if (!ready || !aiEdit) return;
    if (lastAiEditRef.current === aiEdit.id) return;

    const editor = editorRef.current;
    if (!editor) return;

    // A newer edit supersedes the previous flash even before this pane has
    // received the new body and can paint its own decorations.
    if (lastAiEditRef.current !== null && lastAiEditRef.current !== aiEdit.id) {
      clearAiHighlights(editor.action((ctx) => ctx.get(editorViewCtx)));
    }

    const matchesNext = editorMatchesMarkdown(editor, aiEdit.markdown);
    const matchesPrevious = matchesNext
      ? false
      : editorMatchesMarkdown(editor, aiEdit.previousMarkdown);
    const plan = planAiMarkdownApply({
      liveSession: Boolean(session),
      ...(aiEdit.replace === undefined ? {} : { replace: aiEdit.replace }),
      matchesNext,
      matchesPrevious,
    });

    if (plan === 'skip') {
      lastAiEditRef.current = aiEdit.id;
      return;
    }

    if (plan === 'decorate') {
      lastAiEditRef.current = aiEdit.id;
      applyAiMarkdown(editor, aiEdit.markdown, aiEdit.previousMarkdown, aiEdit.sections, {
        replace: false,
        editId: aiEdit.id,
      });
      return;
    }

    if (plan === 'wait') {
      // The room or the React content commit can still be delivering the AI
      // body when this effect runs. Observe without dispatching; paint only
      // once this editor holds the exact fetched body.
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (editorRef.current !== editor) {
          window.clearInterval(timer);
          return;
        }
        if (editorMatchesMarkdown(editor, aiEdit.markdown)) {
          window.clearInterval(timer);
          lastAiEditRef.current = aiEdit.id;
          applyAiMarkdown(editor, aiEdit.markdown, aiEdit.previousMarkdown, aiEdit.sections, {
            replace: false,
            editId: aiEdit.id,
          });
          return;
        }
        if (Date.now() - startedAt >= 1000) window.clearInterval(timer);
      }, 80);
      return () => window.clearInterval(timer);
    }

    lastAiEditRef.current = aiEdit.id;
    const incoming = normalizeMarkdown(aiEdit.markdown);
    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    runExternalApply(() => {
      applyAiMarkdown(editor, aiEdit.markdown, aiEdit.previousMarkdown, aiEdit.sections, {
        editId: aiEdit.id,
      });
    });
    refreshToolbar();
  }, [aiEdit, ready, session, refreshToolbar, runExternalApply]);

  // A pane that was focused while an external value arrived catches up on blur.
  // Session mode has no deferred apply: the canonical observer always reaches
  // the editor, even while it is focused.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || session) return;

    const handleFocusOut = () => {
      window.setTimeout(() => {
        const editor = editorRef.current;
        if (!editor || root.contains(document.activeElement)) return;
        const incoming = normalizeMarkdown(valueRef.current);
        if (incoming === lastAppliedRef.current) return;
        lastAppliedRef.current = incoming;
        lastEmittedRef.current = incoming;
        runExternalApply(() => {
          editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, incoming));
        });
        refreshToolbar();
      }, 0);
    };

    root.addEventListener('focusout', handleFocusOut);
    return () => root.removeEventListener('focusout', handleFocusOut);
  }, [session, refreshToolbar, runExternalApply]);

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
      runExternalApply(() => {
        editor.action((ctx) => replaceEditorMarkdownPreservingSelection(ctx, normalized));
      });
      refreshToolbar();
    },
    [refreshToolbar, runExternalApply],
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
