import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import type { Board } from '../lib/boards';
import { useToasts } from '../state/hooks';
import { Button, EmptyState, PageHeader } from '../components/ui';
import { BoardDialog } from '../components/board/BoardDialog';
import { formatRelativeDate, padCount } from '../components/board/dates';
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
    <div className="flex h-full min-h-0 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8">
      <PageHeader
        title="Boards"
        description="Every board keeps its own tasks, separate from the notes in your library."
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

      <div
        className="mb-5 flex flex-wrap items-center gap-x-2 border-y border-line py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] tabular-nums text-ink-muted"
        aria-label={`${boards.length} ${boards.length === 1 ? 'board' : 'boards'}, ${openCount} open tasks, ${doneCount} done tasks`}
      >
        <span>{padCount(boards.length)} {boards.length === 1 ? 'board' : 'boards'}</span>
        <span aria-hidden="true">·</span>
        <span>{padCount(openCount)} open</span>
        <span aria-hidden="true">·</span>
        <span>{padCount(doneCount)} done</span>
      </div>

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
        <div className="space-y-0" aria-label="Loading boards" aria-busy="true">
          <div className="hidden h-8 grid-cols-[minmax(0,1fr)_180px_64px_96px] items-center gap-6 border-b border-line px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted lg:grid">
            <span>Board</span>
            <span>Progress</span>
            <span>Open</span>
            <span>Updated</span>
          </div>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="grid gap-3 border-b border-line px-2 py-4 lg:grid-cols-[minmax(0,1fr)_180px_64px_96px] lg:items-center lg:gap-6"
            >
              <div className="space-y-2">
                <div className="h-3.5 w-40 animate-pulse bg-surface-raised" />
                <div className="h-3 w-64 max-w-full animate-pulse bg-surface-raised" />
              </div>
              <div className="h-[3px] w-full animate-pulse bg-surface-raised" />
              <div className="h-3 w-8 animate-pulse bg-surface-raised" />
              <div className="h-3 w-16 animate-pulse bg-surface-raised" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState
          title="No boards yet"
          description="Create a board to separate the work."
          action={
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
              Create board
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
          <div className="hidden h-8 grid-cols-[minmax(0,1fr)_180px_64px_96px] items-center gap-6 border-b border-line px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted lg:grid">
            <span>Board</span>
            <span>Progress</span>
            <span>Open</span>
            <span>Updated</span>
          </div>

          {boards.map((board) => {
            const percent = board.total > 0 ? (board.doneCount / board.total) * 100 : 0;
            const updated = formatRelativeDate(board.updated);

            return (
              <button
                key={board.id}
                type="button"
                onClick={() => navigate(`/board/${board.id}`)}
                className="group relative block w-full border-b border-line px-2 py-4 text-left transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal lg:grid lg:grid-cols-[minmax(0,1fr)_180px_64px_96px] lg:items-center lg:gap-6 lg:py-3.5"
              >
                <span
                  className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-signal opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />

                <span className="block min-w-0">
                  <span className="block truncate text-[15px] font-semibold leading-snug text-ink">
                    {board.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] leading-relaxed text-ink-muted">
                    {board.description || 'No description'}
                  </span>
                </span>

                <span className="mt-3 flex items-center gap-4 lg:contents">
                  <span className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
                    <span className="h-[3px] min-w-0 flex-1 bg-line" aria-hidden="true">
                      <span
                        className="block h-full bg-signal"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-muted">
                      {board.total > 0 ? `${board.doneCount}/${board.total}` : 'No tasks'}
                    </span>
                  </span>

                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums text-ink-muted lg:text-center">
                    {padCount(board.openCount)}
                    <span className="lg:hidden"> open</span>
                  </span>

                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted lg:text-right">
                    <span className="lg:hidden">Updated </span>
                    {updated || '—'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <BoardDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </div>
  );
}

export default BoardsPage;
