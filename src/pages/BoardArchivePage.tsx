import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  deleteBoardPermanently,
  restoreBoard,
  type BoardSummary,
} from '../lib/boards';
import { useToasts } from '../state/hooks';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  PageShell,
} from '../components/ui';
import { formatRelativeDate } from '../components/board/dates';
import { useBoardSummaries } from '../components/board/useBoardSummaries';

export function BoardArchivePage() {
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const { boards, isLoading, error, retry, removeBoardLocally } = useBoardSummaries(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoardSummary | null>(null);

  const archived = boards.filter((board) => board.archived);
  const isEmpty = !isLoading && !error && archived.length === 0;

  const handleRestore = async (board: BoardSummary) => {
    setRestoringId(board.id);

    try {
      await restoreBoard(board.id);
      removeBoardLocally(board.id);
      showToast(`“${board.name}” restored`, 'success');
    } catch (restoreError) {
      showToast(
        restoreError instanceof Error ? restoreError.message : 'Could not restore the board.',
        'error'
      );
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;

    const board = pendingDelete;
    setDeletingId(board.id);

    try {
      await deleteBoardPermanently(board.id);
      removeBoardLocally(board.id);
      setPendingDelete(null);
      showToast('Board deleted forever', 'info');
    } catch (deleteError) {
      showToast(
        deleteError instanceof Error ? deleteError.message : 'Could not delete the board.',
        'error'
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <PageShell contentClassName="desktop-page-content-enter">
      <PageHeader
        back={{ label: 'Timeline', onClick: () => navigate('/timeline') }}
        title="Archived boards"
        description="Boards set aside with their tasks. Nothing here is deleted until you delete it for good."
        meta={
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-[13px] font-medium tabular-nums text-ink">{archived.length}</span>
            archived
          </span>
        }
      />

      {error ? (
        <EmptyState
          title="The archive could not load"
          description={error}
          action={
            <Button variant="secondary" icon={<ArrowPathIcon />} onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="archive-board-grid gap-4" aria-label="Loading archived boards" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="rounded-panel border border-line bg-surface p-5">
              <div className="h-4 w-40 animate-pulse rounded bg-surface-raised" />
              <div className="mt-3 h-3 w-56 max-w-full animate-pulse rounded bg-surface-raised" />
              <div className="mt-8 h-8 w-24 animate-pulse rounded bg-surface-raised" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex min-h-[52vh] items-center justify-center pb-16">
          <EmptyState
            title="No archived boards"
            description="Archive a board from its edit dialog to set it aside without deleting its tasks."
            className="max-w-lg"
          />
        </div>
      ) : (
        <div className="archive-board-grid gap-4 pb-2">
            {archived.map((board) => {
              const restoring = restoringId === board.id;
              const archivedDate = formatRelativeDate(board.updated);

              return (
                <div
                  key={board.id}
                  className="flex flex-col rounded-panel border border-line bg-surface p-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" aria-hidden="true" />
                      <h2 className="truncate text-[16px] font-semibold leading-snug tracking-[-0.015em] text-ink">
                        {board.name}
                      </h2>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">
                      {board.description || 'No description'}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11.5px] tabular-nums text-ink-muted">
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5">
                        {board.total} {board.total === 1 ? 'task' : 'tasks'}
                      </span>
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5">
                        Archived {archivedDate || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ArrowUturnLeftIcon />}
                      onClick={() => void handleRestore(board)}
                      loading={restoring}
                      disabled={restoring || deletingId !== null}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-danger-soft hover:text-danger"
                      icon={<TrashIcon />}
                      onClick={() => setPendingDelete(board)}
                      disabled={restoring || deletingId !== null}
                    >
                      Delete forever
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Permanently delete “${pendingDelete.name}”?` : 'Permanently delete this board?'}
        description={
          pendingDelete
            ? `This removes the board and its ${pendingDelete.total} tasks for good. The notes those tasks came from stay in your library. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete forever"
        tone="danger"
        busy={deletingId !== null}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (deletingId === null) {
            setPendingDelete(null);
          }
        }}
      />
    </PageShell>
  );
}

export default BoardArchivePage;
