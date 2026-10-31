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
import { minimalTextChange } from '../../../lib/collaboration/text';
import type { Collaborator } from '../../../lib/collaboration/types';

export interface SourceAiDiff {
  id: string;
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
  onSelectionChange?: (selection: { anchor: number; head: number; focused: boolean; pane?: "source" | "wysiwyg" }) => void;
  onReady?: (view: EditorView) => void;
}

/**
 * CodeMirror 6 source pane. The component owns its view; `value` sync follows
 * the same last-emitted rule as the Milkdown pane. Remote values apply as a
 * minimal CodeMirror change in a layout effect, and CodeMirror maps the local
 * selection through it.
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
  onSelectionChange,
  onReady,
}: NanaSourceEditorProps) {
  const spellcheck = useSpellcheck();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
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

  useEffect(() => {
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
          // duplicate the other writer's text.
          if (update.docChanged && !applyingExternalRef.current) {
            const next = normalizeMarkdown(update.state.doc.toString());
            if (next !== lastEmittedRef.current) {
              lastEmittedRef.current = next;
              lastAppliedRef.current = next;
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
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once; value and read-only changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
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
  }, [value]);

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
