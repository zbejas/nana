import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronLeftIcon,
  DocumentPlusIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  ShareIcon,
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
  PageHeader,
  PageShell,
  SidePanel,
} from '../components/ui';
import { BOARD_COLUMNS } from '../components/board/board-config';
import { BoardSettingsPanel } from '../components/board/BoardSettingsPanel';
import { TaskCard } from '../components/board/TaskCard';
import { TaskEditor } from '../components/board/TaskEditor';
import { ImportNotePanel } from '../components/board/ImportNotePanel';
import { useBoardState } from '../components/board/useBoardState';
import { formatRelativeDate } from '../components/board/dates';
import { PublicSharePanel } from '../components/modals/PublicSharePanel';
import { usePublicSharePanelState } from '../components/modals/usePublicSharePanelState';

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
  const location = useLocation();
  const { boardId } = useParams<{ boardId: string }>();
  const { showToast } = useToasts();
  const publicSharePanel = usePublicSharePanelState();

  const [board, setBoard] = useState<Board | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAutoFocus, setEditAutoFocus] = useState(false);
  const [editNewBoard, setEditNewBoard] = useState(false);

  const [query, setQuery] = useState('');
  const [composerStatus, setComposerStatus] = useState<TaskStatus | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);

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
    setComposerStatus(null);
    setEditingTaskId(null);
    setImportOpen(false);
    setEditOpen(false);
    setEditAutoFocus(false);
    setEditNewBoard(false);
  }, [boardId]);

  const boardEditState = location.state as { editBoard?: boolean; newBoard?: boolean } | null;
  const wantsBoardEdit = Boolean(boardEditState?.editBoard);
  const wantsNewBoard = Boolean(boardEditState?.newBoard);

  useEffect(() => {
    if (!wantsBoardEdit || !board || board.archived || board.id !== boardId) return;

    setEditOpen(true);
    setEditAutoFocus(true);
    setEditNewBoard(wantsNewBoard);
    navigate(location.pathname, { replace: true, state: null });
  }, [wantsBoardEdit, wantsNewBoard, board, boardId, location.pathname, navigate]);

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
  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [tasks, editingTaskId]
  );

  const openNewTask = (status: TaskStatus = 'backlog') => {
    if (!board || board.archived) return;
    setEditingTaskId(null);
    setComposerStatus(status);
  };

  const openTask = (task: Task) => {
    setComposerStatus(null);
    setEditingTaskId(task.id);
  };

  const handleCreateTask = async (data: TaskDraft) => {
    const created = await addTask(data);
    setComposerStatus(created.status);
    showToast('Task added to the board', 'success');
  };

  const handleUpdateTask = async (id: string, data: TaskDraft) => {
    await editTask(id, data);
    setEditingTaskId(null);
    showToast('Task saved', 'success');
  };

  const handleDelete = async (id: string) => {
    await removeTask(id);
    setEditingTaskId(null);
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
    <PageShell scroll={editOpen ? 'page' : 'content'} contentClassName="desktop-page-content-enter">
      <PageHeader
        back={{ label: 'Timeline', onClick: () => navigate('/timeline') }}
        title={
          board ? (
            <span className="inline-flex items-center gap-2">
              <span className="min-w-0 break-words">{board.name}</span>
              {board.is_private && (
                <LockClosedIcon
                  className="h-4 w-4 shrink-0 text-warning"
                  aria-label="Private board"
                />
              )}
              {board.is_public && (
                <ShareIcon
                  className="h-4 w-4 shrink-0 text-success"
                  aria-label="Shared publicly"
                />
              )}
            </span>
          ) : (
            'Board'
          )
        }
        description={board?.description || undefined}
        meta={
          board?.archived ? (
            <span>Archived {formatRelativeDate(board.updated) || ''}</span>
          ) : board ? (
            <>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{openCount}</span>
                open
              </span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{doneCount}</span>
                done
              </span>
              {isLoading && <span>Loading tasks…</span>}
            </>
          ) : undefined
        }
        actions={
          board && !board.archived && !editOpen ? (
            <>
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
                label="Share board"
                variant="secondary"
                className="h-10 w-10"
                onClick={() => void publicSharePanel.openBoard(board.id)}
              >
                <ShareIcon />
              </IconButton>
              <IconButton
                ref={editButtonRef}
                label="Edit board"
                variant="secondary"
                className="h-10 w-10"
                aria-expanded={editOpen}
                onClick={() => {
                  if (editOpen) {
                    setEditOpen(false);
                    setEditAutoFocus(false);
                  } else {
                    setEditNewBoard(false);
                    setEditAutoFocus(true);
                    setEditOpen(true);
                  }
                }}
              >
                <PencilSquareIcon />
              </IconButton>
            </>
          ) : undefined
        }
      />

      {board && !board.archived && (
        <BoardSettingsPanel
          board={board}
          open={editOpen}
          autoFocus={editAutoFocus}
          newBoard={editNewBoard}
          taskCount={isLoading ? undefined : tasks.length}
          onClose={() => {
            setEditOpen(false);
            setEditAutoFocus(false);
            setEditNewBoard(false);
            window.requestAnimationFrame(() => editButtonRef.current?.focus());
          }}
          onSaved={(updated) => {
            setBoard(updated);
            setEditOpen(false);
            setEditAutoFocus(false);
            setEditNewBoard(false);
            window.requestAnimationFrame(() => editButtonRef.current?.focus());
            showToast(editNewBoard ? 'Board created' : 'Board saved', 'success');
          }}
          onArchived={() => {
            setEditOpen(false);
            showToast('Board archived', 'info');
            navigate('/timeline');
          }}
        />
      )}

      {!editOpen && (notFound ? (
        <EmptyState
          title="That board is not here"
          description="It may have been deleted, or it belongs to another account."
          action={
            <Button
              variant="secondary"
              icon={<ChevronLeftIcon />}
              onClick={() => navigate('/timeline')}
            >
              Back to timeline
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
          description="Restore it to work with its tasks again, or return to the timeline to pick another board."
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
              <Button variant="ghost" onClick={() => navigate('/timeline')}>
                Back to timeline
              </Button>
            </>
          }
        />
      ) : isBoardLoading ? (
        <div
          className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-4"
          aria-label="Loading board"
        >
          {BOARD_COLUMNS.map((column) => (
            <div
              key={column.status}
              className="flex min-w-0 flex-col rounded-panel border border-line bg-surface-sunken/50 p-2.5"
            >
              <div className="mb-3 flex h-9 items-center gap-2 px-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-surface-raised" />
                <span className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
              </div>
              {[0, 1].map((index) => (
                <div key={index} className="mb-2 space-y-2 rounded-[8px] border border-line bg-surface p-3.5">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-raised" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-surface-raised" />
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
          className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-4"
          aria-label="Loading tasks"
        >
          {BOARD_COLUMNS.map((column) => (
            <div
              key={column.status}
              className="flex min-w-0 flex-col rounded-panel border border-line bg-surface-sunken/50 p-2.5"
            >
              <div className="mb-3 flex h-9 items-center gap-2 px-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-surface-raised" />
                <span className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
              </div>
              {[0, 1].map((index) => (
                <div key={index} className="mb-2 space-y-2 rounded-[8px] border border-line bg-surface p-3.5">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-raised" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-surface-raised" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : tasks.length === 0 && composerStatus === null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center pb-10">
          <div className="w-full max-w-md rounded-panel border border-line bg-surface px-8 py-10 text-center">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">No tasks yet</h2>
            <p className="mx-auto mt-2 max-w-[38ch] text-[13px] leading-relaxed text-ink-secondary">
              Create the first task, or import a note to turn the writing into work.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" size="sm" icon={<PlusIcon />} onClick={() => openNewTask()}>
                New task
              </Button>
              <Button variant="secondary" size="sm" icon={<DocumentPlusIcon />} onClick={() => setImportOpen(true)}>
                Import note
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="w-full sm:w-72">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
                icon={<MagnifyingGlassIcon />}
                className="h-9 bg-surface-sunken text-[13px]"
                trailing={
                  isFiltering ? (
                    <IconButton
                      label="Clear search"
                      size="sm"
                      className="h-7 w-7"
                      onClick={() => setQuery('')}
                    >
                      <XMarkIcon />
                    </IconButton>
                  ) : undefined
                }
              />
            </div>
            <p className="text-[11.5px] text-ink-muted">
              {isFiltering ? (
                'Moving is paused while searching.'
              ) : (
                <>
                  <span className="lg:hidden">Swipe between columns. Open a task to edit it.</span>
                  <span className="hidden lg:inline xl:hidden">Scroll between columns. Open a task to edit it.</span>
                  <span className="hidden xl:inline">Drag between columns. Open a task to edit it.</span>
                </>
              )}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-autohide xl:grid xl:snap-none xl:grid-cols-4 xl:overflow-hidden">
            {BOARD_COLUMNS.map((column) => {
              const items = visibleByStatus[column.status];
              const isColumnTarget = dropTarget?.status === column.status && Boolean(draggingId);
              const dotClass =
                column.status === 'progress'
                  ? 'bg-signal'
                  : column.status === 'done'
                    ? 'bg-success'
                    : column.status === 'next'
                      ? 'bg-warning'
                      : 'bg-ink-muted';

              return (
                <section
                  key={column.status}
                  aria-label={`${column.label} column`}
                  className={`flex h-full min-h-0 w-[min(86vw,340px)] shrink-0 snap-start flex-col rounded-panel border p-2.5 transition-colors xl:w-auto xl:min-w-0 ${
                    isColumnTarget
                      ? 'border-signal/45 bg-signal-soft/30'
                      : 'border-line bg-surface-sunken/50'
                  }`}
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
                  <header className="flex h-9 shrink-0 items-center gap-2 px-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
                    <h2 className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink">
                      {column.label}
                    </h2>
                    <span className="text-[11.5px] font-medium tabular-nums text-ink-muted">
                      {items.length}
                    </span>
                    <IconButton
                      label={`Add task to ${column.label}`}
                      size="sm"
                      className="ml-auto h-7 w-7 text-ink-muted [&>svg]:h-4 [&>svg]:w-4"
                      onClick={() => openNewTask(column.status)}
                    >
                      <PlusIcon />
                    </IconButton>
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
                    <div className="space-y-2 pb-1">
                      {items.map((task, index) => (
                        <Fragment key={task.id}>
                          {isColumnTarget && dropTarget?.index === index && draggingId && (
                            <div className="h-0.5 rounded-full bg-signal" aria-hidden="true" />
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
                        <div className="h-0.5 rounded-full bg-signal" aria-hidden="true" />
                      )}

                      {items.length === 0 && composerStatus !== column.status && (
                        <p className="rounded-[8px] border border-dashed border-line px-3 py-5 text-center text-[11.5px] leading-relaxed text-ink-muted">
                          {column.hint}.
                        </p>
                      )}
                    </div>
                  </div>

                  {composerStatus === column.status && (
                    <div className="mt-1 shrink-0">
                      <TaskEditor
                        mode="create"
                        status={column.status}
                        autoFocus
                        onCancel={() => setComposerStatus(null)}
                        onSubmit={handleCreateTask}
                      />
                    </div>
                  )}

                  {composerStatus !== column.status && (
                    <button
                      type="button"
                      onClick={() => openNewTask(column.status)}
                      className="mt-1 flex h-8 w-full shrink-0 items-center gap-1.5 rounded-[8px] px-1.5 text-left text-[12px] font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      Add task
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ))}

      {board && editingTask && (
        <SidePanel
          open
          onClose={() => setEditingTaskId(null)}
          title="Edit task"
          description={board.name ? `On ${board.name}` : undefined}
        >
          <TaskEditor
            mode="edit"
            task={editingTask}
            surface="panel"
            autoFocus
            onCancel={() => setEditingTaskId(null)}
            onSubmit={(data) => handleUpdateTask(editingTask.id, data)}
            onDelete={handleDelete}
            onOpenDocument={(documentId) => {
              setEditingTaskId(null);
              navigate(`/document/${documentId}`);
            }}
          />
        </SidePanel>
      )}

      <PublicSharePanel
        target={publicSharePanel.target}
        isOpen={publicSharePanel.isOpen}
        isSaving={publicSharePanel.isSaving}
        onClose={publicSharePanel.close}
        onSave={async (options) => {
          const updated = await publicSharePanel.save(options);
          if (updated && typeof updated === 'object' && 'is_public' in updated) {
            setBoard(updated as Board);
          }
          return updated;
        }}
      />

      {board && !board.archived && (
        <ImportNotePanel
          open={importOpen}
          boardId={board.id}
          boardName={board.name}
          onClose={() => setImportOpen(false)}
          existingDocumentIds={existingDocumentIds}
          onImport={handleImport}
        />
      )}
    </PageShell>
  );
}

export default BoardPage;
