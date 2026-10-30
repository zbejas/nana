import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { NanaMarkdownEditor } from './milkdown/NanaMarkdownEditor';
import { NanaSourceEditor } from './milkdown/NanaSourceEditor';
import { NanaSplitMarkdownEditor } from './milkdown/NanaSplitMarkdownEditor';
import { applyAiMarkdown, type AiChangedSection } from './milkdown/aiEdits';
import type { ViewMode } from './EditorHeader';

export interface EditorAiEdit {
  id: string;
  markdown: string;
  sections: AiChangedSection[];
}

interface EditorContentProps {
  content: string;
  onContentChange: (content: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  onDropFiles?: (event: DragEvent<HTMLDivElement>) => void;
  aiEdit?: EditorAiEdit | null;
  fullscreen?: boolean;
}

/**
 * The document editor surface. `wysiwyg` is the rendered Milkdown editor,
 * `text` is the CodeMirror source, and `split` shows both. All three keep
 * Markdown as the storage format and emit through `onContentChange`.
 */
export function EditorContent({
  content,
  onContentChange,
  readOnly = false,
  viewMode,
  onDropFiles,
  aiEdit = null,
  fullscreen = false,
}: EditorContentProps) {
  const isSplitMode = viewMode === 'split';
  const editorPlaceholder = readOnly ? '' : 'Start writing…';
  const editorRef = useRef<Editor | null>(null);
  const [editorReadyVersion, setEditorReadyVersion] = useState(0);

  useEffect(() => {
    editorRef.current = null;
  }, [viewMode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !aiEdit) return;
    applyAiMarkdown(editor, aiEdit.markdown, aiEdit.sections);
  }, [aiEdit, editorReadyVersion]);

  const handleEditorReady = (editor: Editor) => {
    editorRef.current = editor;
    setEditorReadyVersion((value) => value + 1);
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-1 overflow-hidden bg-canvas ${
        fullscreen ? 'p-0' : 'px-2.5 py-2.5 md:px-5 md:py-4'
      }`}
      onDropCapture={(event) => {
        // CodeMirror and ProseMirror try to read dropped files as text.
        // Attachment drops belong to the document editor's upload handler.
        if (!onDropFiles || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onDropFiles(event);
      }}
    >
      <div
        className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface ${
          fullscreen
            ? 'max-w-none rounded-none border-0'
            : `mx-auto rounded-panel border border-line ${isSplitMode ? 'max-w-[1240px]' : 'max-w-[920px]'}`
        }`}
      >
        {viewMode === 'text' && (
          <div className="scrollbar-autohide relative h-full min-h-0 flex-1 overflow-hidden">
            <NanaSourceEditor
              value={content}
              onChange={onContentChange}
              readOnly={readOnly}
              placeholder={editorPlaceholder}
              ariaLabel="Document Markdown source"
              className="h-full"
            />
          </div>
        )}

        {viewMode === 'split' && (
          <NanaSplitMarkdownEditor
            value={content}
            onChange={onContentChange}
            readOnly={readOnly}
            placeholder={editorPlaceholder}
            ariaLabel="Document content"
            className="min-h-0 flex-1"
            onEditorReady={handleEditorReady}
          />
        )}

        {viewMode === 'wysiwyg' && (
          <NanaMarkdownEditor
            value={content}
            onChange={onContentChange}
            readOnly={readOnly}
            placeholder={editorPlaceholder}
            ariaLabel="Document content"
            className="scrollbar-autohide h-full min-h-0 flex-1"
            showToolbar
            enableSlash
            onEditorReady={handleEditorReady}
          />
        )}
      </div>
    </div>
  );
}
