import { useEffect, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { rehypeSanitizePlugin } from '../../lib/sanitize';
import type { ViewMode } from './EditorHeader';

interface EditorContentProps {
  content: string;
  onContentChange: (content: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  editablePreview?: boolean;
}

export function EditorContent({ content, onContentChange, readOnly = false, viewMode, editablePreview = false }: EditorContentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isPreviewMode = viewMode === 'preview';
  const isSplitMode = viewMode === 'split';
  const isCenteredMode = viewMode === 'preview';
  // Map our ViewMode to MDEditor's preview prop
  const previewMode = readOnly ? 'preview' : viewMode === 'text' ? 'edit' : viewMode === 'preview' ? 'preview' : 'live';
  // Only show dragbar in split (live) mode
  const showDragbar = viewMode === 'split';
  const previewTagFallbacks = {
    iso: ({ children }: any) => <span>{children}</span>,
    docname: ({ children }: any) => <span>{children}</span>,
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
    <div
      ref={containerRef}
      className={`flex-1 min-h-0 flex overflow-hidden relative h-full scrollbar-autohide ${isCenteredMode ? 'md:px-6 lg:px-8 md:justify-center' : ''}`}
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
        readOnly={readOnly}
        textareaProps={{
          placeholder: readOnly ? 'Read-only trash document' : 'Start writing...',
        }}
        style={{
          width: '100%',
          backgroundColor: 'transparent',
          minHeight: '100%',
          ...(!isSplitMode ? { border: 'none', boxShadow: 'none' } : {}),
        }}
        className={`!bg-transparent ${isCenteredMode ? 'md:!max-w-4xl md:!w-full md:!mx-auto' : ''} ${!isSplitMode ? '!border-none !shadow-none [&_.w-md-editor]:!border-none [&_.w-md-editor]:!shadow-none [&_.w-md-editor-text]:!border-none [&_.w-md-editor-preview]:!border-none [&_.w-md-editor-preview]:!shadow-none [&_.wmde-markdown]:!border-none [&_.wmde-markdown]:!shadow-none' : ''} [&_.wmde-markdown]:!bg-transparent [&_.w-md-editor-preview]:!bg-transparent [&_.w-md-editor]:!h-full [&_.w-md-editor]:!min-h-0 [&_.wmde-markdown-var]:!bg-blue-500/30 [&_.wmde-markdown-var]:!w-2 [&_.wmde-markdown-var]:!cursor-col-resize [&_.wmde-markdown-var]:hover:!bg-blue-500 [&_.w-md-editor-text]:scrollbar-autohide [&_.w-md-editor-preview]:scrollbar-autohide [&_.wmde-markdown]:scrollbar-autohide [&_textarea]:!outline-none [&_textarea]:!ring-0 [&_textarea::placeholder]:!opacity-30`}
      />
    </div>
  );
}
