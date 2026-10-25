import { useEffect, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { rehypeSanitizePlugin } from '../../lib/sanitize';
import { rewriteLegacyFileUrl } from '../../lib/legacy-urls';
import type { ViewMode } from './EditorHeader';

interface EditorContentProps {
  content: string;
  onContentChange: (content: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  editablePreview?: boolean;
}

export function EditorContent({ content, onContentChange, readOnly = false, viewMode }: EditorContentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isPreviewMode = viewMode === 'preview';
  const isSplitMode = viewMode === 'split';
  const previewMode = readOnly ? 'preview' : viewMode === 'text' ? 'edit' : viewMode === 'preview' ? 'preview' : 'live';
  const showDragbar = viewMode === 'split';
  const previewTagFallbacks = {
    iso: ({ children }: any) => <span>{children}</span>,
    docname: ({ children }: any) => <span>{children}</span>,
    img: ({ src, alt, ...props }: any) => <img src={rewriteLegacyFileUrl(src)} alt={alt} {...props} />,
    a: ({ href, children, ...props }: any) => <a href={rewriteLegacyFileUrl(href)} {...props}>{children}</a>,
  } as any;

  useEffect(() => {
    if (viewMode === 'preview') {
      return;
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const isEditingOtherField =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.isContentEditable;

      if (isEditingOtherField) {
        return;
      }

      const container = containerRef.current;
      const editorTextarea = container?.querySelector('textarea') as HTMLTextAreaElement | null;
      if (!editorTextarea) {
        return;
      }

      event.preventDefault();
      editorTextarea.focus();
      editorTextarea.setSelectionRange(0, editorTextarea.value.length);
    };

    window.document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      window.document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [viewMode]);

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
      return;
    }

    if (viewMode === 'preview') {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') {
      return;
    }

    const container = event.currentTarget;
    const editorTextarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!editorTextarea) {
      return;
    }

    event.preventDefault();
    editorTextarea.focus();
    editorTextarea.setSelectionRange(0, editorTextarea.value.length);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-canvas px-2.5 py-2.5 md:px-5 md:py-4">
      <div
        className={`relative mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-panel border border-line bg-surface ${
          isSplitMode ? 'max-w-[1240px]' : 'max-w-[920px]'
        }`}
      >
        <div
          ref={containerRef}
          className="scrollbar-autohide relative flex h-full min-h-0 flex-1 overflow-hidden"
          onKeyDownCapture={handleKeyDownCapture}
        >
          <MDEditor
            value={content}
            onChange={(val) => onContentChange(val || '')}
            preview={previewMode}
            previewOptions={{
              skipHtml: true,
              rehypePlugins: [rehypeSanitizePlugin],
              components: previewTagFallbacks,
            }}
            height="100%"
            visibleDragbar={showDragbar}
            hideToolbar={true}
            enableScroll={true}
            textareaProps={{
              readOnly,
              placeholder: readOnly ? 'Read-only trash document' : 'Start writing…',
            }}
            style={{
              width: '100%',
              backgroundColor: 'transparent',
              minHeight: '100%',
              ...(!isSplitMode ? { border: 'none', boxShadow: 'none' } : {}),
            }}
            className={`!bg-transparent ${!isSplitMode ? '!border-none !shadow-none [&_.w-md-editor]:!border-none [&_.w-md-editor]:!shadow-none [&_.w-md-editor-text]:!border-none [&_.w-md-editor-preview]:!border-none [&_.w-md-editor-preview]:!shadow-none [&_.wmde-markdown]:!border-none [&_.wmde-markdown]:!shadow-none' : ''} [&_.wmde-markdown]:!bg-transparent [&_.w-md-editor-preview]:!bg-transparent [&_.w-md-editor]:!h-full [&_.w-md-editor]:!min-h-0 [&_.w-md-editor-text]:!px-6 [&_.w-md-editor-text]:!py-4 md:[&_.w-md-editor-text]:!px-10 md:[&_.w-md-editor-text]:!py-6 [&_.w-md-editor-preview]:!px-6 [&_.w-md-editor-preview]:!py-4 md:[&_.w-md-editor-preview]:!px-10 [&_.w-md-editor-preview]:!rounded-none [&_.wmde-markdown-var]:!w-2 [&_.wmde-markdown-var]:!cursor-col-resize [&_.wmde-markdown-var]:!bg-line-strong [&_.wmde-markdown-var]:hover:!bg-signal [&_.w-md-editor-text]:scrollbar-autohide [&_.w-md-editor-preview]:scrollbar-autohide [&_.wmde-markdown]:scrollbar-autohide [&_textarea]:!font-sans [&_textarea]:!outline-none [&_textarea]:!ring-0 [&_textarea]:!text-[15px] [&_textarea]:!leading-7 [&_textarea]:!caret-signal [&_.w-md-editor-text-pre]:!font-sans [&_.w-md-editor-text-pre]:!text-[15px] [&_textarea::placeholder]:!text-ink-muted [&_textarea::placeholder]:!opacity-100 [&_.w-md-editor-text-pre]:!text-ink [&_.w-md-editor-text-input]:!text-ink [&_.w-md-editor-preview]:!border-l [&_.w-md-editor-preview]:!border-line`}
          />
        </div>
      </div>
    </div>
  );
}
