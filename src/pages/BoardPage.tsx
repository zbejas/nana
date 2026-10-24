import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronLeftIcon,
  DocumentPlusIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Document } from '../lib/documents';
import {
  getBoard,
  restoreBoard,
  type Board,
} from '../lib/boards';
import {
  createTaskFromDocument,
  type Task,
  type TaskDraft,
  type TaskStatus,
} from '../lib/tasks';
import { useToasts } from '../state/hooks';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
} from '../components/ui';
import { BOARD_COLUMNS } from '../components/board/board-config';
import { BoardDialog } from '../components/board/BoardDialog';
import { TaskCard } from '../components/board/TaskCard';
import { TaskDialog } from '../components/board/TaskDialog';
import { ImportNoteDialog } from '../components/board/ImportNoteDialog';
import { useBoardState } from '../components/board/useBoardState';
import { formatRelativeDate, padCount } from '../components/board/dates';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 404
  );
}

export function BoardPage() {
  const navigate = useNavigate();
  const { boardId } = useParams<{ boardId: string }>();
  const { showToast } = useToasts();

  const [board, setBoard] = useState<Board | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('backlog');
  const [importOpen, setImportOpen] = useState(false);

  const activeBoardId =
    board && board.id === boardId && !board.archived ? board.id : undefined;
  const {
    tasks,
    byStatus,
    isLoading,
    error,
    draggingId,
    dropTarget,
    retry,
    addTask,
    addExistingTask,
    editTask,
    removeTask,
    startDrag,
    endDrag,
    dragOver,
    drop,
  } = useBoardState(activeBoardId);

  useEffect(() => {
    if (!boardId) {
      setNotFound(true);
      setIsBoardLoading(false);
      return;
    }

    let cancelled = false;
    setIsBoardLoading(true);
    setNotFound(false);
    setBoardError(null);
    setBoard(null);

    void getBoard(boardId)
      .then((record) => {
        if (!cancelled) {
          setBoard(record);
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (isNotFound(loadError)) {
          setNotFound(true);
          return;
        }
        setBoardError(
          loadError instanceof Error ? loadError.message : 'Could not load the board.'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsBoardLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, reloadToken]);

  useEffect(() => {
    setQuery('');
    setDialogOpen(false);
    setEditingTask(null);
    setImportOpen(false);
    setEditOpen(false);
  }, [boardId]);

  const isFiltering = query.trim().length > 0;
  const term = query.trim().toLowerCase();

  const visibleByStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = { backlog: [], next: [], progress: [], done: [] };
    if (!isFiltering) return byStatus;

    for (const task of tasks) {
      const haystack = `${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase();
      if (haystack.includes(term)) {
        groups[task.status].push(task);
      }
    }

    for (const status of Object.keys(groups) as TaskStatus[]) {
      groups[status].sort((a, b) => a.board_order - b.board_order);
    }

    return groups;
  }, [byStatus, isFiltering, tasks, term]);

  const openCount = tasks.filter((task) => task.status !== 'done').length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const existingDocumentIds = useMemo(
    () => new Set(tasks.map((task) => task.document).filter((id): id is string => Boolean(id))),
    [tasks]
  );

  const openNewTask = (status: TaskStatus = 'backlog') => {
    if (!board || board.archived) return;
    setEditingTask(null);
    setDefaultStatus(status);
    setDialogOpen(true);
  };

  const openTask = (task: Task) => {
    setEditingTask(task);
    setDefaultStatus(task.status);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: TaskDraft) => {
    if (editingTask) {
      await editTask(editingTask.id, data);
      showToast('Task saved', 'success');
    } else {
      await addTask(data);
      showToast('Task added to the board', 'success');
    }
  };

  const handleDelete = async (id: string) => {
    await removeTask(id);
    showToast('Task deleted', 'info');
  };

  const handleImport = async (document: Document) => {
    if (!board) return;
    const created = await createTaskFromDocument(document, board.id);
    created.expand = { document };
    addExistingTask(created);
    showToast(`“${document.title || 'Untitled'}” added to ${board.name}`, 'success');
  };

  const handleRestore = async () => {
    if (!board) return;
    setRestoring(true);

    try {
      const restored = await restoreBoard(board.id);
      setBoard(restored);
      showToast('Board restored', 'success');
    } catch (restoreError) {
      showToast(
        restoreError instanceof Error ? restoreError.message : 'Could not restore the board.',
        'error'
      );
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-5 sm:px-6 sm:pt-6 lg:px-8">
      <header className="mb-5 border-b border-line pb-5">
        <button
          type="button"
          onClick={() => navigate('/board')}
          className="inline-flex h-8 w-fit items-center gap-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          All boards
        </button>

        {isBoardLoading ? (
          <div className="mt-3 space-y-3" aria-label="Loading board" aria-busy="true">
            <div className="h-8 w-64 max-w-full animate-pulse bg-surface-raised" />
            <div className="h-3.5 w-96 max-w-full animate-pulse bg-surface-raised" />
            <div className="h-3 w-32 animate-pulse bg-surface-raised" />
          </div>
        ) : board ? (
          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="font-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2rem]">
                {board.name}
              </h1>
              {board.description && (
                <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-secondary">
                  {board.description}
                </p>
              )}

              {board.archived ? (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
                  Archived {formatRelativeDate(board.updated) || ''}
                </p>
              ) : isLoading ? (
                <div className="mt-3 h-3 w-32 animate-pulse bg-surface-raised" />
              ) : (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] tabular-nums text-ink-muted">
                  {padCount(openCount)} open
                  <span className="mx-1.5 text-ink-muted" aria-hidden="true">·</span>
                  {padCount(doneCount)} done
                </p>
              )}
            </div>

            {!board.archived && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  icon={<DocumentPlusIcon />}
                  onClick={() => setImportOpen(true)}
                >
                  Import note
                </Button>
                <Button variant="primary" icon={<PlusIcon />} onClick={() => openNewTask()}>
                  New task
                </Button>
                <IconButton
                  label="Edit board"
                  variant="secondary"
                  className="h-10 w-10"
                  onClick={() => setEditOpen(true)}
                  disabled={isLoading}
                >
                  <PencilSquareIcon />
                </IconButton>
              </div>
            )}
          </div>
        ) : null}
      </header>

      {notFound ? (
        <EmptyState
          title="That board is not here"
          description="It may have been deleted, or it belongs to another account."
          action={
            <Button
              variant="secondary"
              icon={<ChevronLeftIcon />}
              onClick={() => navigate('/board')}
            >
              Back to boards
            </Button>
          }
        />
      ) : boardError ? (
        <EmptyState
          title="The board could not load"
          description={boardError}
          action={
            <Button
              variant="secondary"
              icon={<ArrowPathIcon />}
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Try again
            </Button>
          }
        />
      ) : board?.archived ? (
        <EmptyState
          title="This board is archived"
          description="Restore it to work with its tasks again, or open the boards index to pick another board."
          action={
            <>
              <Button
                variant="secondary"
                icon={<ArrowUturnLeftIcon />}
                onClick={() => void handleRestore()}
                loading={restoring}
              >
                Restore
              </Button>
              <Button variant="ghost" onClick={() => navigate('/board')}>
                All boards
              </Button>
            </>
          }
        />
      ) : isBoardLoading ? (
        <div
          className="flex min-h-0 flex-1 gap-4 overflow-hidden lg:grid lg:grid-cols-4 lg:gap-0"
          aria-label="Loading board"
        >
          {BOARD_COLUMNS.map((column) => (
            <div
              key={column.status}
              className="flex min-w-0 flex-1 flex-col lg:border-l lg:border-line lg:px-3 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
            >
              <div className="mb-2 flex h-8 items-center gap-2 border-b border-line">
                <span className="h-3 w-4 animate-pulse bg-surface-raised" />
                <span className="h-3 w-20 animate-pulse bg-surface-raised" />
              </div>
              {[0, 1].map((index) => (
                <div key={index} className="space-y-2 border-b border-line px-2 py-3">
                  <div className="h-3.5 w-3/4 animate-pulse bg-surface-raised" />
                  <div className="h-3 w-1/2 animate-pulse bg-surface-raised" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="The board could not load"
          description={error}
          action={
            <Button variant="secondary" icon={<ArrowPathIcon />} onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : isLoading ? (
        <div
          className="flex min-h-0 flex-1 gap-4 overflow-hidden lg:grid lg:grid-cols-4 lg:gap-0"
          aria-label="Loading tasks"
        >
          {BOARD_COLUMNS.map((column) => (
            <div
              key={column.status}
              className="flex min-w-0 flex-1 flex-col lg:border-l lg:border-line lg:px-3 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
            >
              <div className="mb-2 flex h-8 items-center gap-2 border-b border-line">
                <span className="h-3 w-4 animate-pulse bg-surface-raised" />
                <span className="h-3 w-20 animate-pulse bg-surface-raised" />
              </div>
              {[0, 1].map((index) => (
                <div key={index} className="space-y-2 border-b border-line px-2 py-3">
                  <div className="h-3.5 w-3/4 animate-pulse bg-surface-raised" />
                  <div className="h-3 w-1/2 animate-pulse bg-surface-raised" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-8">
          <h2 className="text-sm font-medium text-ink">No tasks yet</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
            Create the first task, or import a note to get started.
          </p>
          <Button
            variant="primary"
            size="sm"
            icon={<PlusIcon />}
            className="mt-4"
            onClick={() => openNewTask()}
          >
            New task
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
                className="h-9 pl-9 pr-8 text-[13px]"
              />
              {isFiltering && (
                <IconButton
                  label="Clear search"
                  size="sm"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                  onClick={() => setQuery('')}
                >
                  <XMarkIcon />
                </IconButton>
              )}
            </div>
            <p className="text-[11px] text-ink-muted">
              {isFiltering
                ? 'Moving is paused while searching.'
                : 'Drag between columns. Open a task to edit it.'}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto pb-2 scrollbar-autohide lg:grid lg:snap-none lg:grid-cols-4 lg:gap-0">
            {BOARD_COLUMNS.map((column) => {
              const items = visibleByStatus[column.status];
              const isColumnTarget = dropTarget?.status === column.status && Boolean(draggingId);
              const highlightRule = isColumnTarget || column.status === 'progress';

              return (
                <section
                  key={column.status}
                  aria-label={`${column.label} column`}
                  className="flex h-full min-h-0 w-[min(86vw,320px)] shrink-0 snap-start flex-col lg:w-auto lg:min-w-0 lg:border-l lg:border-line lg:px-3 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0"
                  onDragOver={(event) => {
                    if (!draggingId || isFiltering) return;
                    event.preventDefault();
                    dragOver(column.status, items.length);
                  }}
                  onDrop={(event) => {
                    if (!draggingId || isFiltering) return;
                    event.preventDefault();
                    const index =
                      dropTarget?.status === column.status ? dropTarget.index : items.length;
                    void drop(column.status, index);
                  }}
                >
                  <header
                    className={`flex h-8 shrink-0 items-center gap-2 border-b border-line border-t-2 ${
                      highlightRule ? 'border-t-signal' : 'border-t-transparent'
                    }`}
                  >
                    <span className="font-mono text-[10px] tabular-nums text-ink-muted">
                      {column.index}
                    </span>
                    <h2
                      className={`text-[13px] font-semibold ${
                        column.status === 'progress' ? 'text-signal' : 'text-ink'
                      }`}
                    >
                      {column.label}
                    </h2>
                    <span className="font-mono text-[10px] tabular-nums text-ink-muted">
                      {padCount(items.length)}
                    </span>
                    <IconButton
                      label={`Add task to ${column.label}`}
                      size="sm"
                      className="ml-auto h-7 w-7 [&>svg]:h-4 [&>svg]:w-4"
                      onClick={() => openNewTask(column.status)}
                    >
                      <PlusIcon />
                    </IconButton>
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
                    {items.map((task, index) => (
                      <Fragment key={task.id}>
                        {isColumnTarget && dropTarget?.index === index && draggingId && (
                          <div className="h-0.5 bg-signal" aria-hidden="true" />
                        )}
                        <TaskCard
                          task={task}
                          index={index}
                          isDragging={draggingId === task.id}
                          draggable={!isFiltering}
                          onOpen={() => openTask(task)}
                          onDragStart={() => startDrag(task)}
                          onDragEnd={endDrag}
                          onDragOver={(targetIndex) => dragOver(column.status, targetIndex)}
                        />
                      </Fragment>
                    ))}

                    {isColumnTarget && dropTarget?.index === items.length && draggingId && (
                      <div className="h-0.5 bg-signal" aria-hidden="true" />
                    )}

                    {items.length === 0 && (
                      <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-muted">
                        {column.hint}.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openNewTask(column.status)}
                    className="flex h-8 w-full shrink-0 items-center gap-1.5 px-2 text-left text-[12px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
                  >
                    <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Add task
                  </button>
                </section>
              );
            })}
          </div>
        </>
      )}

      {board && (
        <BoardDialog
          open={editOpen}
          board={board}
          taskCount={tasks.length}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setBoard(updated);
            showToast('Board saved', 'success');
          }}
          onArchived={() => {
            showToast('Board archived', 'info');
            navigate('/board');
          }}
        />
      )}

      {board && !board.archived && (
        <>
          <TaskDialog
            open={dialogOpen}
            task={editingTask}
            defaultStatus={defaultStatus}
            boardName={board.name}
            onClose={() => setDialogOpen(false)}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
            onOpenDocument={(documentId) => {
              setDialogOpen(false);
              navigate(`/document/${documentId}`);
            }}
          />

          <ImportNoteDialog
            open={importOpen}
            boardId={board.id}
            boardName={board.name}
            onClose={() => setImportOpen(false)}
            existingDocumentIds={existingDocumentIds}
            onImport={handleImport}
          />
        </>
      )}
    </div>
  );
}

export default BoardPage;
