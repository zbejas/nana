import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronLeftIcon,
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
} from '../components/ui';
import { formatRelativeDate, padCount } from '../components/board/dates';
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
    <div className="flex h-full min-h-0 flex-col px-4 pb-8 pt-5 sm:px-6 sm:pt-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate('/board')}
        className="mb-4 inline-flex h-8 w-fit items-center gap-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
        Boards
      </button>

      <PageHeader
        title="Archived boards"
        description="Boards set aside with their tasks. Nothing here is deleted until you delete it for good."
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
        <div className="space-y-0" aria-label="Loading archived boards" aria-busy="true">
          {[0, 1].map((index) => (
            <div key={index} className="flex items-center gap-6 border-b border-line px-2 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-40 animate-pulse bg-surface-raised" />
                <div className="h-3 w-56 max-w-full animate-pulse bg-surface-raised" />
              </div>
              <div className="h-8 w-20 animate-pulse bg-surface-raised" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState
          title="No archived boards"
          description="Archive a board from its edit dialog to set it aside without deleting its tasks."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
          <div className="mb-4 flex items-center border-b border-line px-2 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] tabular-nums text-ink-muted">
            {padCount(archived.length)} archived
          </div>

          {archived.map((board) => {
            const restoring = restoringId === board.id;
            const archivedDate = formatRelativeDate(board.updated);

            return (
              <div
                key={board.id}
                className="border-b border-line px-2 py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold leading-snug text-ink">
                    {board.name}
                  </h2>
                  <p className="mt-0.5 truncate text-[12px] leading-relaxed text-ink-muted">
                    {board.description || 'No description'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] tabular-nums text-ink-muted">
                    <span>
                      {padCount(board.total)} {board.total === 1 ? 'task' : 'tasks'}
                    </span>
                    <span>Archived {archivedDate || '—'}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 lg:mt-0 lg:justify-end">
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
    </div>
  );
}

export default BoardArchivePage;
