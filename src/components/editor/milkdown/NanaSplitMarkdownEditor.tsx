import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import type { EditorView as CodeMirrorView } from '@codemirror/view';
import type { EditorView as ProseMirrorView } from '@milkdown/kit/prose/view';
import { NanaMarkdownEditor } from './NanaMarkdownEditor';
import { NanaSourceEditor } from './NanaSourceEditor';
import { computeScrollRatio, scrollTopForRatio } from './helpers';

export interface NanaSplitMarkdownEditorProps {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}

/**
 * Source and WYSIWYG side by side. Each pane keeps its own undo history and
 * caret; the shared Markdown value is only applied to the pane that is not
 * focused, so typing on one side never rewrites the other side's caret. Scroll
 * positions mirror as a ratio with a one-frame guard against feedback loops.
 */
export function NanaSplitMarkdownEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = 'Start writing…',
  ariaLabel = 'Document content',
  className,
  onEditorReady,
}: NanaSplitMarkdownEditorProps) {
  const [sourceView, setSourceView] = useState<CodeMirrorView | null>(null);
  const [wysiwygView, setWysiwygView] = useState<ProseMirrorView | null>(null);
  const syncingRef = useRef(false);
  const syncFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sourceView || !wysiwygView) return;
    const source = sourceView.scrollDOM;
    const wysiwyg = wysiwygView.dom;

    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (syncingRef.current) return;
      const ratio = computeScrollRatio(from.scrollTop, from.scrollHeight, from.clientHeight);
      if (ratio === 0 && from.scrollTop <= 0) return;

      syncingRef.current = true;
      to.scrollTop = scrollTopForRatio(ratio, to.scrollHeight, to.clientHeight);
      if (syncFrameRef.current !== null) window.cancelAnimationFrame(syncFrameRef.current);
      syncFrameRef.current = window.requestAnimationFrame(() => {
        syncingRef.current = false;
        syncFrameRef.current = null;
      });
    };

    const handleSourceScroll = () => sync(source, wysiwyg);
    const handleWysiwygScroll = () => sync(wysiwyg, source);

    source.addEventListener('scroll', handleSourceScroll, { passive: true });
    wysiwyg.addEventListener('scroll', handleWysiwygScroll, { passive: true });

    return () => {
      source.removeEventListener('scroll', handleSourceScroll);
      wysiwyg.removeEventListener('scroll', handleWysiwygScroll);
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }
    };
  }, [sourceView, wysiwygView]);

  return (
    <div className={`nana-split-shell h-full min-h-0 ${className ?? ''}`}>
      <div className="nana-split grid h-full min-h-0 grid-cols-2">
        <section className="nana-split-pane flex min-h-0 min-w-0 flex-col border-r border-line bg-surface">
          <div className="flex h-[38px] shrink-0 items-center border-b border-line px-4 text-[11px] font-medium text-ink-muted">
            Markdown
          </div>
          <div className="nana-split-source relative min-h-0 flex-1 overflow-hidden">
            <NanaSourceEditor
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              placeholder={readOnly ? '' : placeholder}
              ariaLabel={`${ariaLabel} Markdown source`}
              onReady={setSourceView}
            />
          </div>
        </section>

        <section className="nana-split-pane flex min-h-0 min-w-0 flex-col bg-surface">
          <NanaMarkdownEditor
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            enableSlash
            onViewReady={setWysiwygView}
            onEditorReady={onEditorReady}
            className="h-full min-h-0"
          />
        </section>
      </div>
    </div>
  );
}
