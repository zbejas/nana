import { useEffect, useLayoutEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  dropCursor,
  placeholder as cmPlaceholder,
  keymap,
} from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { cn } from '../../ui';
import { useSpellcheck } from '../../../lib/settings';
import type { AiTextChange } from './aiDiff';
import { isSameMarkdown, normalizeMarkdown } from './helpers';
import { withSuppressedDocumentChange } from './createEditor';
import { isRemoteSourceTransaction, SourceBinding } from './sourceBinding';
import { minimalTextChange } from '../../../lib/collaboration/text';
import type { CollabSession } from '../../../lib/collaboration/session';
import type { Collaborator } from '../../../lib/collaboration/types';

export interface SourceAiDiff {
  id: string;
  /** Body the decorations were computed against. */
  markdown: string;
  changes: AiTextChange[];
}

const setSourceAiDiff = StateEffect.define<DecorationSet>();
const sourceAiDiffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSourceAiDiff)) return effect.value;
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
const sourceAiTimers = new WeakMap<EditorView, number>();

const setSourceCollaborators = StateEffect.define<DecorationSet>();
const sourceCollaboratorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSourceCollaborators)) return effect.value;
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function collaboratorCaretElement(name: string, color: string): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'nana-collab-caret';
  caret.style.setProperty('--nana-collab', color);
  caret.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'nana-collab-caret-label';
  label.textContent = name;
  caret.appendChild(label);
  return caret;
}

class CollaboratorCaretWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    super();
  }

  eq(other: CollaboratorCaretWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }

  toDOM(): HTMLElement {
    return collaboratorCaretElement(this.name, this.color);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function sourceCollaboratorDecorations(
  length: number,
  collaborators: readonly Collaborator[],
): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const collaborator of collaborators) {
    if (!collaborator.focused) continue;
    const anchor = Math.max(0, Math.min(collaborator.anchor, length));
    const head = Math.max(0, Math.min(collaborator.head, length));
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    if (to > from) {
      ranges.push(Decoration.mark({
        class: 'nana-collab-selection',
        attributes: { style: `--nana-collab: ${collaborator.color}` },
      }).range(from, to));
    }
    ranges.push(Decoration.widget({
      widget: new CollaboratorCaretWidget(collaborator.name, collaborator.color),
      side: 1,
    }).range(head));
  }

  return Decoration.set(ranges, true);
}

class DeletedTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DeletedTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'nana-ai-diff-delete';
    span.textContent = this.text.length > 600 ? `${this.text.slice(0, 600)}…` : this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function sourceDiffDecorations(length: number, changes: readonly AiTextChange[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const change of changes) {
    if (change.type === 'insert') {
      const from = Math.max(0, Math.min(change.start, length));
      const to = Math.max(from, Math.min(change.end, length));
      if (from < to) {
        ranges.push(Decoration.mark({ class: 'nana-ai-diff-insert' }).range(from, to));
      }
    } else {
      const pos = Math.max(0, Math.min(change.start, length));
      ranges.push(Decoration.widget({
        widget: new DeletedTextWidget(change.text),
        side: -1,
      }).range(pos));
    }
  }
  return Decoration.set(ranges, true);
}

function applySourceDiff(view: EditorView, diff: SourceAiDiff): void {
  const decorations = sourceDiffDecorations(view.state.doc.length, diff.changes);
  view.dispatch({
    effects: [
      setSourceAiDiff.of(decorations),
      EditorView.scrollIntoView(Math.max(0, Math.min(diff.changes[0]?.start ?? 0, view.state.doc.length)), {
        y: 'center',
      }),
    ],
  });

  const previous = sourceAiTimers.get(view);
  if (previous !== undefined) window.clearTimeout(previous);
  const timer = window.setTimeout(() => {
    sourceAiTimers.delete(view);
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: setSourceAiDiff.of(Decoration.none) });
  }, 450);
  sourceAiTimers.set(view, timer);
}

export interface NanaSourceEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  aiDiff?: SourceAiDiff | null;
  collaborators?: Collaborator[];
  /**
   * Live session for this note. When present, the pane binds straight to the
   * canonical `Y.Text` through `SourceBinding` and `value`/`onChange` is only
   * a UI-stat mirror. Without it the pane keeps the controlled value path.
   */
  session?: CollabSession | null;
  onSelectionChange?: (selection: { anchor: number; head: number; focused: boolean; pane?: "source" | "wysiwyg" }) => void;
  onReady?: (view: EditorView) => void;
}

/**
 * CodeMirror 6 source pane. The component owns its view. In live mode a
 * `SourceBinding` converts local transactions into canonical ops and applies
 * remote Markdown as an annotated minimal change; otherwise `value` sync
 * follows the same last-emitted rule as the Milkdown pane.
 */
export function NanaSourceEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel = 'Markdown source',
  placeholder = 'Start writing…',
  className,
  aiDiff = null,
  collaborators = [],
  session = null,
  onSelectionChange,
  onReady,
}: NanaSourceEditorProps) {
  const spellcheck = useSpellcheck();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceBindingRef = useRef<SourceBinding | null>(null);
  const lastAiDiffRef = useRef<string | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const hadCollaboratorsRef = useRef(false);
  const lastEmittedRef = useRef(normalizeMarkdown(value));
  const lastAppliedRef = useRef(normalizeMarkdown(value));
  const readOnlyRef = useRef(readOnly);
  const applyingExternalRef = useRef(false);

  valueRef.current = value;
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  onSelectionChangeRef.current = onSelectionChange;
  readOnlyRef.current = readOnly;

  const notifySelection = (view: EditorView, focused = view.hasFocus) => {
    const { anchor, head } = view.state.selection.main;
    onSelectionChangeRef.current?.({ anchor, head, focused, pane: 'source' });
  };

  // Create the view in a layout effect so the session-binding layout effect
  // below can attach in the same commit. A passive effect would run after the
  // binding effect on a mode switch to Source/Split, leaving the pane detached
  // from the room until the component remounted.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: normalizeMarkdown(valueRef.current),
      extensions: [
        markdown(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
        EditorState.tabSize.of(2),
        cmPlaceholder(placeholder),
        sourceAiDiffField,
        sourceCollaboratorsField,
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
          spellcheck: spellcheck ? 'true' : 'false',
        }),
        readOnlyCompartment.current.of([
          EditorState.readOnly.of(readOnlyRef.current),
          EditorView.editable.of(!readOnlyRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          // Remote/live snapshots and merged values are applied below. They
          // must not be echoed back into Yjs as local edits, which would
          // duplicate the other writer's text. Live binding applies its own
          // remote updates with an annotation, so the same rule covers both.
          if (update.docChanged) {
            const next = normalizeMarkdown(update.state.doc.toString());
            lastAppliedRef.current = next;
            const binding = sourceBindingRef.current;
            if (isRemoteSourceTransaction(update)) {
              // Applied from the canonical session; never emit it again.
            } else if (binding && !applyingExternalRef.current) {
              binding.handleUpdate(update);
            } else if (!binding && !applyingExternalRef.current && next !== lastEmittedRef.current) {
              lastEmittedRef.current = next;
              onChangeRef.current?.(next);
            }
          }
          if (update.selectionSet || update.focusChanged) {
            notifySelection(update.view);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    lastAppliedRef.current = normalizeMarkdown(state.doc.toString());
    onReadyRef.current?.(view);
    notifySelection(view, false);

    const handleFocus = () => notifySelection(view, true);
    const handleBlur = () => notifySelection(view, false);
    view.dom.addEventListener('focus', handleFocus);
    view.dom.addEventListener('blur', handleBlur);

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (viewRef.current !== view || view.hasFocus) return;
        // In live mode the session observer owns every non-local apply. A
        // stale controlled `value` must not overwrite canonical text.
        if (sourceBindingRef.current) return;
        const incoming = normalizeMarkdown(valueRef.current);
        if (incoming === lastAppliedRef.current) return;
        lastAppliedRef.current = incoming;
        lastEmittedRef.current = incoming;
        const change = minimalTextChange(view.state.doc.toString(), incoming);
        if (!change) return;
        withSuppressedDocumentChange(applyingExternalRef, () => {
          view.dispatch({
            changes: change,
            annotations: Transaction.addToHistory.of(false),
          });
        });
      }, 0);
    };
    host.addEventListener('focusout', handleFocusOut);

    return () => {
      host.removeEventListener('focusout', handleFocusOut);
      view.dom.removeEventListener('focus', handleFocus);
      view.dom.removeEventListener('blur', handleBlur);
      const timer = sourceAiTimers.get(view);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        sourceAiTimers.delete(view);
      }
      // Unsubscribe before the view goes away; the binding effect cleanup is
      // idempotent and may already have run.
      sourceBindingRef.current?.destroy();
      sourceBindingRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once; value and read-only changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bind the live session to the existing view. The binding registers its
  // observer first and aligns the pane second; its remote annotation keeps
  // the update listener above from treating that alignment as local input.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !session) return;

    const binding = new SourceBinding({
      view,
      session,
      onChange: (markdown) => {
        const next = normalizeMarkdown(markdown);
        lastEmittedRef.current = next;
        lastAppliedRef.current = next;
        onChangeRef.current?.(next);
      },
    });
    sourceBindingRef.current = binding;

    return () => {
      binding.destroy();
      if (sourceBindingRef.current === binding) sourceBindingRef.current = null;
    };
  }, [session]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    // Live mode writes canonical text through SourceBinding; the controlled
    // snapshot is only a mirror for React state. Keying this on the prop (not
    // the ref) also restores the controlled path when a session goes away.
    if (!view || session) return;
    const incoming = normalizeMarkdown(value);
    if (incoming === lastAppliedRef.current || isSameMarkdown(incoming, view.state.doc.toString())) return;
    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    const change = minimalTextChange(view.state.doc.toString(), incoming);
    if (!change) return;
    withSuppressedDocumentChange(applyingExternalRef, () => {
      view.dispatch({
        changes: change,
        annotations: Transaction.addToHistory.of(false),
      });
    });
  }, [value, session]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const hasCollaborators = collaborators.length > 0;
    if (!hasCollaborators && !hadCollaboratorsRef.current) return;
    hadCollaboratorsRef.current = hasCollaborators;
    view.dispatch({
      effects: setSourceCollaborators.of(sourceCollaboratorDecorations(
        view.state.doc.length,
        collaborators,
      )),
    });
  }, [collaborators]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !aiDiff || aiDiff.changes.length === 0) return;
    if (lastAiDiffRef.current === aiDiff.id) return;
    // A live room can move the source after the flash was queued. Paint only
    // when the pane still holds the body the offsets were computed for.
    if (!isSameMarkdown(view.state.doc.toString(), aiDiff.markdown)) return;
    lastAiDiffRef.current = aiDiff.id;
    applySourceDiff(view, aiDiff);
  }, [aiDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
    view.dom.dataset.readonly = readOnly ? 'true' : 'false';
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dom.setAttribute('aria-label', ariaLabel);
    view.contentDOM.setAttribute('spellcheck', spellcheck ? 'true' : 'false');
  }, [ariaLabel, spellcheck]);

  return (
    <div
      ref={hostRef}
      className={cn('nana-source', className)}
      data-readonly={readOnly ? 'true' : undefined}
    />
  );
}
