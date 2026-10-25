import { ClockIcon, EllipsisVerticalIcon, FolderIcon, LockClosedIcon, ShareIcon } from '@heroicons/react/24/outline';
import { useRef, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import type { Document } from '../../lib/documents';
import { plainTextExcerpt, stripMarkdown } from '../../lib/tasks/text';
import { highlightText } from '../../lib/highlightText';
import { Badge, IconButton } from '../ui';

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
};

function updatedLabel(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
}: TimelineDocumentCardProps) {
  const attachmentCount = document.attachments?.length || 0;
  const tags = document.tags ?? [];
  const visibleTagLimit = isMobile ? 2 : 3;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const body = document.content.replace(/^\s*#\s+.*(?:\n|$)/, '');
  const preview = plainTextExcerpt(stripMarkdown(body).replace(/\n+/g, ' · '), 280);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;

    const touch = event.touches.item(0);
    if (!touch) return;

    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTriggeredRef.current = false;
    clearLongPressTimer();

    longPressTimerRef.current = window.setTimeout(() => {
      const start = touchStartRef.current;
      if (!start) return;
      longPressTriggeredRef.current = true;
      onLongPressMenu(start);
    }, 450);
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current || event.touches.length !== 1) return;

    const touch = event.touches.item(0);
    if (!touch) return;

    if (
      Math.abs(touch.clientX - touchStartRef.current.x) > 10 ||
      Math.abs(touch.clientY - touchStartRef.current.y) > 10
    ) {
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
    <article
      onClick={handleCardClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      className="group relative w-full cursor-pointer overflow-hidden rounded-panel border border-line bg-surface text-left transition-colors duration-150 hover:border-line-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 truncate text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {highlightText(document.title || 'Untitled', highlightQuery)}
              </h3>
              {document.is_private && <LockClosedIcon className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Private" />}
              {document.is_public && <ShareIcon className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Shared publicly" />}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] leading-4 text-ink-muted">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ClockIcon className="h-3 w-3" aria-hidden="true" />
                {updatedLabel(document.updated)}
              </span>
              {folderName && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FolderIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{folderName}</span>
                </span>
              )}
              {attachmentCount > 0 && (
                <span className="tabular-nums">
                  {attachmentCount} {attachmentCount === 1 ? 'attachment' : 'attachments'}
                </span>
              )}
            </p>
          </div>

          <IconButton
            label="Document actions"
            size="sm"
            className="h-7 w-7 shrink-0 text-ink-muted"
            onClick={(event) => {
              event.stopPropagation();
              onOpenItemMenu(event as unknown as MouseEvent<HTMLButtonElement>);
            }}
          >
            <EllipsisVerticalIcon />
          </IconButton>
        </div>

        {preview && (
          <p className="mt-2.5 line-clamp-3 text-[12.5px] leading-relaxed text-ink-muted">
            {preview}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {tags.slice(0, visibleTagLimit).map((tag) => (
            <Badge key={tag} tone="outline" className="max-w-28 truncate font-medium">
              {highlightText(tag, highlightQuery)}
            </Badge>
          ))}
          {tags.length > visibleTagLimit && (
            <span className="text-[11.5px] text-ink-muted">+{tags.length - visibleTagLimit}</span>
          )}
          <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-ink-muted">
            {wordCount} words · {readingTime} min read
          </span>
        </div>
      </div>
    </article>
  );
}
