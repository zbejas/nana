import { ClockIcon, FolderIcon, LockClosedIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import type { KeyboardEvent } from 'react';
import type { BoardSummary } from '../../lib/boards';
import { highlightText } from '../../lib/highlightText';
import { formatUpdatedLabel } from './dates';

type TimelineBoardCardProps = {
  board: BoardSummary;
  folderName?: string;
  onClick: () => void;
  highlightQuery?: string;
};

function taskLabel(board: BoardSummary): string {
  if (board.total === 0) {
    return 'No tasks yet';
  }

  return `${board.openCount} open · ${board.doneCount} done`;
}

export function TimelineBoardCard({
  board,
  folderName,
  onClick,
  highlightQuery = '',
}: TimelineBoardCardProps) {
  return (
    <article
      onClick={onClick}
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
              <ViewColumnsIcon
                className="h-4 w-4 shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <h3 className="min-w-0 truncate text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {highlightText(board.name || 'Untitled board', highlightQuery)}
              </h3>
              {board.is_private && (
                <LockClosedIcon
                  className="h-3.5 w-3.5 shrink-0 text-warning"
                  aria-label="Private board"
                />
              )}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] leading-4 text-ink-muted">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ClockIcon className="h-3 w-3" aria-hidden="true" />
                {formatUpdatedLabel(board.lastActivity)}
              </span>
              {folderName && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FolderIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{folderName}</span>
                </span>
              )}
            </p>
          </div>
        </div>

        <p className="mt-2.5 line-clamp-3 text-[12.5px] leading-relaxed text-ink-muted">
          {board.description
            ? highlightText(board.description, highlightQuery)
            : 'No description yet.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-medium tabular-nums text-ink-secondary">
            {taskLabel(board)}
          </span>
          <span className="ml-auto shrink-0 text-[11.5px] text-ink-muted">
            Open board →
          </span>
        </div>
      </div>
    </article>
  );
}
