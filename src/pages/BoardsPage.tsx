import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  LockClosedIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import type { Board } from '../lib/boards';
import { useToasts } from '../state/hooks';
import { Button, EmptyState, PageHeader, PageShell } from '../components/ui';
import { BoardDialog } from '../components/board/BoardDialog';
import { formatRelativeDate } from '../components/board/dates';
import { useBoardSummaries } from '../components/board/useBoardSummaries';

export function BoardsPage() {
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const { boards, isLoading, error, retry } = useBoardSummaries();
  const [createOpen, setCreateOpen] = useState(false);

  const openCount = boards.reduce((total, board) => total + board.openCount, 0);
  const doneCount = boards.reduce((total, board) => total + board.doneCount, 0);
  const isEmpty = !isLoading && !error && boards.length === 0;

  const handleCreated = (board: Board) => {
    showToast('Board created', 'success');
    navigate(`/board/${board.id}`);
  };

  return (
    <PageShell contentClassName="desktop-page-content-enter">
      <PageHeader
        title="Boards"
        description="Every board keeps its own tasks, separate from the notes in your library."
        meta={
          <>
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium tabular-nums text-ink">{boards.length}</span>
              {boards.length === 1 ? 'board' : 'boards'}
            </span>
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium tabular-nums text-ink">{openCount}</span>
              open
            </span>
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium tabular-nums text-ink">{doneCount}</span>
              done
            </span>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<ArchiveBoxIcon />}
              onClick={() => navigate('/board/archive')}
            >
              Archived
            </Button>
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
              New board
            </Button>
          </>
        }
      />

      {error ? (
        <EmptyState
          title="The boards could not load"
          description={error}
          action={
            <Button variant="secondary" icon={<ArrowPathIcon />} onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Loading boards" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="min-h-56 animate-pulse rounded-panel border border-line bg-surface p-5">
              <div className="h-3 w-16 bg-surface-raised" />
              <div className="mt-5 h-5 w-40 bg-surface-raised" />
              <div className="mt-3 h-3 w-56 max-w-full bg-surface-raised" />
              <div className="mt-10 h-1.5 w-full bg-surface-raised" />
              <div className="mt-5 h-6 w-32 bg-surface-raised" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex min-h-[52vh] items-center justify-center pb-16">
          <EmptyState
            title="No boards yet"
            description="Create a board to separate the work from the writing. Each board keeps its own tasks."
            action={
              <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
                Create board
              </Button>
            }
            className="max-w-lg"
          />
        </div>
      ) : (
        <div className="pb-2">
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {boards.map((board) => {
              const percent = board.total > 0 ? (board.doneCount / board.total) * 100 : 0;
              const updated = formatRelativeDate(board.updated);

              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => navigate(`/board/${board.id}`)}
                  className="group relative flex min-h-40 flex-col rounded-panel border border-line bg-surface p-5 text-left transition-colors hover:border-line-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink">
                      <span className="min-w-0 truncate">{board.name}</span>
                      {board.is_private && (
                        <LockClosedIcon
                          className="h-3.5 w-3.5 shrink-0 text-warning"
                          aria-label="Private board"
                        />
                      )}
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11.5px] text-ink-muted">{updated || '—'}</span>
                  </span>
                  <span className="mt-1.5 line-clamp-2 block min-h-10 text-[13px] leading-relaxed text-ink-muted">
                    {board.description || 'No description'}
                  </span>

                  <span className="mt-auto block pt-5">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-[11.5px] font-medium text-ink-muted">
                        {board.total > 0 ? `${board.doneCount} of ${board.total} done` : 'No tasks yet'}
                      </span>
                      <span className="flex items-center gap-2 text-[11.5px] font-medium tabular-nums text-ink-secondary">
                        {Math.round(percent)}%
                        <span className="text-ink-muted transition-colors group-hover:text-ink" aria-hidden="true">
                          →
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
                      <span
                        className="block h-full rounded-full bg-signal-bright"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                  </span>
                </button>
              );
            })}
            {boards.length < 3 && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="group hidden min-h-40 flex-col items-center md:col-span-2 2xl:col-span-1 justify-center gap-3 rounded-panel border border-dashed border-line-strong bg-transparent p-5 text-center transition-colors hover:border-ink-muted/40 hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:flex"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-line bg-surface text-ink-muted transition-colors group-hover:text-ink">
                  <PlusIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-[14px] font-medium tracking-[-0.01em] text-ink">
                    New board
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-muted">
                    Start a separate stream of work.
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      <BoardDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </PageShell>
  );
}

export default BoardsPage;
