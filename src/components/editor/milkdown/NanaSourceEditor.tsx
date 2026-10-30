import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  placeholder as cmPlaceholder,
  keymap,
} from '@codemirror/view';
import { cn } from '../../ui';
import { isSameMarkdown, normalizeMarkdown } from './helpers';

export interface NanaSourceEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
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
  onReady,
}: NanaSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
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
