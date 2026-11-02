import { useMemo, type DragEvent } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { NanaMarkdownEditor } from './milkdown/NanaMarkdownEditor';
import { NanaSourceEditor } from './milkdown/NanaSourceEditor';
import { NanaSplitMarkdownEditor } from './milkdown/NanaSplitMarkdownEditor';
import { diffText } from './milkdown/aiDiff';
import { aiDiffSummaryLabel, summarizeAiDiff } from './milkdown/aiDiffView';
import type { AiChangedSection } from './milkdown/aiEdits';
import { normalizeMarkdown } from './milkdown/helpers';
import type { ViewMode } from './EditorHeader';
import type { CollabSession } from '../../lib/collaboration/session';
import type { Collaborator } from '../../lib/collaboration/types';

export interface EditorAiEdit {
  id: string;
  /** Note this flash belongs to; a late event may not paint on another note. */
  targetId: string;
  previousMarkdown: string;
  markdown: string;
  sections: AiChangedSection[];
  /**
   * false when a live room already owns the body. The editor paints the diff
   * decorations only and never replaces the document.
   */
  replace: boolean;
}

interface EditorContentProps {
  content: string;
  onContentChange: (content: string) => void;
  readOnly?: boolean;
  viewMode: ViewMode;
  onDropFiles?: (event: DragEvent<HTMLDivElement>) => void;
  aiEdit?: EditorAiEdit | null;
  collaborators?: Collaborator[];
  /** Live session for the open note; null/absent keeps the controlled path. */
  session?: CollabSession | null;
  onSelectionChange?: (selection: { anchor: number; head: number; focused: boolean; pane?: "source" | "wysiwyg" }) => void;
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
  collaborators = [],
  session = null,
  onSelectionChange,
  fullscreen = false,
}: EditorContentProps) {
  const isSplitMode = viewMode === 'split';
  const editorPlaceholder = readOnly ? '' : 'Start writing…';
  const sourceAiDiff = useMemo(() => {
    if (!aiEdit) return null;
    const changes = diffText(
      normalizeMarkdown(aiEdit.previousMarkdown),
      normalizeMarkdown(aiEdit.markdown),
    );
    return changes.length > 0 ? {
      id: aiEdit.id,
      markdown: normalizeMarkdown(aiEdit.markdown),
      previousMarkdown: normalizeMarkdown(aiEdit.previousMarkdown),
      changes,
    } : null;
  }, [aiEdit]);
  const aiDiffSummary = useMemo(
    () => (sourceAiDiff ? summarizeAiDiff(sourceAiDiff.changes) : null),
    [sourceAiDiff],
  );

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
        {aiDiffSummary && aiDiffSummary.hunkCount > 1 && (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 border-b border-signal/20 bg-signal-soft px-4 py-1.5 text-[11px] font-medium text-signal"
          >
            <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{aiDiffSummaryLabel(aiDiffSummary.hunkCount)}</span>
            <span className="hidden font-normal text-ink-secondary sm:inline">
              Later changes stay highlighted in place.
            </span>
          </div>
        )}

        {viewMode === 'text' && (
          <div className="scrollbar-autohide relative h-full min-h-0 flex-1 overflow-hidden">
            <NanaSourceEditor
              value={content}
              onChange={onContentChange}
              readOnly={readOnly}
              placeholder={editorPlaceholder}
              ariaLabel="Document Markdown source"
              className="h-full"
              aiDiff={sourceAiDiff}
              collaborators={collaborators}
              session={session}
              onSelectionChange={onSelectionChange}
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
            aiEdit={aiEdit}
            aiDiff={sourceAiDiff}
            collaborators={collaborators}
            session={session}
            onSelectionChange={onSelectionChange}
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
            aiEdit={aiEdit}
            collaborators={collaborators}
            session={session}
            onSelectionChange={onSelectionChange}
          />
        )}
      </div>
    </div>
  );
}
