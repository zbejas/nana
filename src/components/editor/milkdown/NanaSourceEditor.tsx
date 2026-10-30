import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
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
import type { AiTextChange } from './aiDiff';
import { isSameMarkdown, normalizeMarkdown } from './helpers';

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
  onReady?: (view: EditorView) => void;
}

/**
 * CodeMirror 6 source pane. The component owns its view; `value` sync follows
 * the same last-emitted/focus-lock rule as the Milkdown pane so one side never
 * overwrites the caret in the other.
 */
export function NanaSourceEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel = 'Markdown source',
  placeholder = 'Start writing…',
  className,
  aiDiff = null,
  onReady,
}: NanaSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastAiDiffRef = useRef<string | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const lastEmittedRef = useRef(normalizeMarkdown(value));
  const lastAppliedRef = useRef(normalizeMarkdown(value));
  const readOnlyRef = useRef(readOnly);

  valueRef.current = value;
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  readOnlyRef.current = readOnly;

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
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
          spellcheck: 'true',
        }),
        readOnlyCompartment.current.of([
          EditorState.readOnly.of(readOnlyRef.current),
          EditorView.editable.of(!readOnlyRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const next = normalizeMarkdown(update.state.doc.toString());
          if (next === lastEmittedRef.current) return;
          lastEmittedRef.current = next;
          lastAppliedRef.current = next;
          onChangeRef.current?.(next);
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    lastAppliedRef.current = normalizeMarkdown(state.doc.toString());
    onReadyRef.current?.(view);

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (viewRef.current !== view || view.hasFocus) return;
        const incoming = normalizeMarkdown(valueRef.current);
        if (incoming === lastAppliedRef.current) return;
        lastAppliedRef.current = incoming;
        lastEmittedRef.current = incoming;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: incoming },
        });
      }, 0);
    };
    host.addEventListener('focusout', handleFocusOut);

    return () => {
      host.removeEventListener('focusout', handleFocusOut);
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const incoming = normalizeMarkdown(value);
    if (incoming === lastAppliedRef.current || isSameMarkdown(incoming, view.state.doc.toString())) return;
    if (view.hasFocus) return;
    lastAppliedRef.current = incoming;
    lastEmittedRef.current = incoming;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: incoming },
    });
  }, [value]);

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
  }, [ariaLabel]);

  return (
    <div
      ref={hostRef}
      className={cn('nana-source', className)}
      data-readonly={readOnly ? 'true' : undefined}
    />
  );
}
