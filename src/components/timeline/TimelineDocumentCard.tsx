import { ClockIcon, DocumentTextIcon, EllipsisVerticalIcon, FolderIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { useRef, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { rehypeSanitizePlugin } from '../../lib/sanitize';
import type { Document } from '../../lib/documents';
import { highlightText } from '../../lib/highlightText';

type TimelineDocumentCardProps = {
  document: Document;
  isMobile?: boolean;
  folderName?: string;
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onOpenItemMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onLongPressMenu: (position: { x: number; y: number }) => void;
  wordCount: number;
  readingTime: number;
  highlightQuery?: string;
  variant?: 'legacy' | 'preview';
};

export function TimelineDocumentCard({
  document,
  isMobile = false,
  folderName,
  onClick,
  onContextMenu,
  onOpenItemMenu,
  onLongPressMenu,
  wordCount,
  readingTime,
  highlightQuery = '',
  variant = 'preview',
}: TimelineDocumentCardProps) {
  const attachmentCount = document.attachments?.length || 0;
  const visibleTagLimit = isMobile ? 2 : 3;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const previewLines = document.content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const hasMorePreview = previewLines.length > 5;
  const previewMarkdown = previewLines
    .slice(0, 5)
    .join('\n');
  const previewTagFallbacks = {
    iso: ({ children }: any) => <span>{children}</span>,
    docname: ({ children }: any) => <span>{children}</span>,
  } as any;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTriggeredRef.current = false;
    clearLongPressTimer();

    longPressTimerRef.current = window.setTimeout(() => {
      const start = touchStartRef.current;
      if (!start) {
        return;
      }
      longPressTriggeredRef.current = true;
      onLongPressMenu(start);
    }, 450);
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }
    const movedX = Math.abs(touch.clientX - touchStartRef.current.x);
    const movedY = Math.abs(touch.clientY - touchStartRef.current.y);

    if (movedX > 10 || movedY > 10) {
      clearLongPressTimer();
    }
  };

  const handleTouchEnd = () => {
    clearLongPressTimer();
    touchStartRef.current = null;
  };

  const handleCardClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    onClick();
  };

  return (
    <div
      onClick={handleCardClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="relative overflow-hidden w-full text-left rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors p-3 cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {variant === 'legacy' ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <DocumentTextIcon className="w-4 h-4 text-gray-400" />
                <span className="text-white font-medium truncate">{highlightText(document.title || 'Untitled', highlightQuery)}</span>
                {document.is_public && (
                  <GlobeAltIcon className="w-4 h-4 flex-shrink-0 text-emerald-400/70" title="Public" />
                )}
              </div>
              {(document.folder || attachmentCount > 0) && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  {document.folder && (
                    <span className="inline-flex items-center gap-1">
                      <FolderIcon className="w-3.5 h-3.5" />
                      <span className="truncate max-w-32">{folderName || 'Folder'}</span>
                    </span>
                  )}
                  {document.folder && attachmentCount > 0 && <span>•</span>}
                  {attachmentCount > 0 && <span>{attachmentCount} {attachmentCount === 1 ? 'attachment' : 'attachments'}</span>}
                </div>
              )}
            </div>

            <div className="shrink-0 text-right text-xs text-gray-500 space-y-1">
              <button
                type="button"
                onClick={(event) => {
                  onOpenItemMenu(event);
                }}
                className="ml-auto mb-1 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 p-1 text-gray-300 hover:bg-white/10 transition-colors"
                aria-label="Open document actions"
                title="Document actions"
              >
                <EllipsisVerticalIcon className="w-4 h-4" />
              </button>
              {document.tags.length > 0 ? (
                <div className="flex items-center justify-end gap-1 max-w-48 overflow-hidden pt-1 pb-1">
                  {document.tags.slice(0, visibleTagLimit).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded-full border border-white/15 bg-white/10 text-[10px] text-gray-200 truncate max-w-20"
                      title={tag}
                    >
                      {highlightText(tag, highlightQuery)}
                    </span>
                  ))}
                  {document.tags.length > visibleTagLimit && (
                    <span className="px-1.5 py-0.5 rounded-full border border-white/15 bg-white/10 text-[10px] text-gray-300">
                      +{document.tags.length - visibleTagLimit}
                    </span>
                  )}
                </div>
              ) : (
                <div>No tags</div>
              )}
              <div>{wordCount} words</div>
              <div>{readingTime} min read</div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Updated {new Date(document.updated).toLocaleDateString()}</span>
            <div className="inline-flex items-center gap-1">
              <ClockIcon className="w-3.5 h-3.5" />
              <span>{new Date(document.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <DocumentTextIcon className="w-4 h-4 text-gray-400" />
              <span className="text-white font-medium truncate">{highlightText(document.title || 'Untitled', highlightQuery)}</span>
              {document.is_public && (
                <GlobeAltIcon className="w-4 h-4 flex-shrink-0 text-emerald-400/70" title="Public" />
              )}
            </div>
            <button
              type="button"
              onClick={(event) => {
                onOpenItemMenu(event);
              }}
              className="shrink-0 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 p-1 text-gray-300 hover:bg-white/10 transition-colors"
              aria-label="Open document actions"
              title="Document actions"
            >
              <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <div className="min-w-0 flex items-center gap-2 text-gray-500">
              {document.folder && (
                <span className="inline-flex items-center gap-1">
                  <FolderIcon className="w-3.5 h-3.5" />
                  <span className="truncate max-w-44">{folderName || 'Folder'}</span>
                </span>
              )}
              {document.folder && attachmentCount > 0 && <span>•</span>}
              {attachmentCount > 0 && <span>{attachmentCount} {attachmentCount === 1 ? 'attachment' : 'attachments'}</span>}
              {!document.folder && attachmentCount === 0 && <span>No folder • No attachments</span>}
            </div>

            <div className="text-right min-w-0 overflow-hidden">
              {document.tags.length > 0 ? (
                <div className="inline-flex max-w-full items-center justify-end gap-1 overflow-hidden pt-1">
                  {document.tags.slice(0, visibleTagLimit).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded-full border border-white/15 bg-white/10 text-[10px] text-gray-200 truncate max-w-20"
                      title={tag}
                    >
                      {highlightText(tag, highlightQuery)}
                    </span>
                  ))}
                  {document.tags.length > visibleTagLimit && (
                    <span className="px-1.5 py-0.5 rounded-full border border-white/15 bg-white/10 text-[10px] text-gray-300">
                      +{document.tags.length - visibleTagLimit}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-gray-500">No tags</div>
              )}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 items-start gap-3 text-xs">
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Updated</div>
              <div className="inline-flex items-center gap-1 text-gray-400 whitespace-nowrap">
                <span>{new Date(document.updated).toLocaleDateString()}</span>
              </div>
              <div className="inline-flex items-center gap-1 text-gray-400 whitespace-nowrap">
                <ClockIcon className="w-3.5 h-3.5" />
                <span>{new Date(document.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              </div>
            </div>

            <div className="text-right flex flex-col items-end gap-0.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Stats</div>
              <div className="flex flex-col items-end gap-0.5 text-gray-400">
                <div className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span>{document.folder ? (folderName || 'Folder') : 'No folder'}</span>
                  <span>•</span>
                  <span>{attachmentCount} {attachmentCount === 1 ? 'attachment' : 'attachments'}</span>
                </div>
                <div className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span>{wordCount} words</span>
                  <span>•</span>
                  <span>{readingTime} min read</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-white/10 pt-2">
            {previewMarkdown ? (
              <div className="relative pointer-events-none [&_.wmde-markdown]:!bg-transparent [&_.wmde-markdown]:!text-xs [&_.wmde-markdown]:!leading-5 [&_.wmde-markdown]:!text-gray-300 [&_.wmde-markdown_p]:!m-0 [&_.wmde-markdown_ul]:!m-0 [&_.wmde-markdown_ol]:!m-0 [&_.wmde-markdown_blockquote]:!m-0 [&_.wmde-markdown_h1]:!m-0 [&_.wmde-markdown_h2]:!m-0 [&_.wmde-markdown_h3]:!m-0 [&_.wmde-markdown_pre]:!m-0 [&_.wmde-markdown_code]:!text-[11px]">
                <MDEditor.Markdown
                  source={previewMarkdown}
                  skipHtml={true}
                  rehypePlugins={[rehypeSanitizePlugin]}
                  components={previewTagFallbacks}
                  style={{ backgroundColor: 'transparent' }}
                />
                {hasMorePreview && (
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">More…</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-500 italic">No preview available.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
