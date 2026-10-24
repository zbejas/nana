import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  DocumentPlusIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Document } from '../lib/documents';
import {
  createTaskFromDocument,
  type CreateTaskData,
  type Task,
  type TaskStatus,
  type UpdateTaskData,
} from '../lib/tasks';
import { useToasts } from '../state/hooks';
import { Button, EmptyState, IconButton, Input, PageHeader } from '../components/ui';
import { BOARD_COLUMNS, columnToneClass } from '../components/board/board-config';
import { TaskCard } from '../components/board/TaskCard';
import { TaskDialog } from '../components/board/TaskDialog';
import { ImportNoteDialog } from '../components/board/ImportNoteDialog';
import { useBoardState } from '../components/board/useBoardState';

export function BoardPage() {
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const {
    tasks,
    byStatus,
    isLoading,
    error,
    draggingId,
    dropTarget,
    load,
    addTask,
    addExistingTask,
    editTask,
    removeTask,
    startDrag,
    endDrag,
    dragOver,
    drop,
  } = useBoardState();

  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('backlog');
  const [importOpen, setImportOpen] = useState(false);

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
    setEditingTask(null);
    setDefaultStatus(status);
    setDialogOpen(true);
  };

  const openTask = (task: Task) => {
    setEditingTask(task);
    setDefaultStatus(task.status);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: CreateTaskData | UpdateTaskData) => {
    if (editingTask) {
      await editTask(editingTask.id, data as UpdateTaskData);
      showToast('Task saved', 'success');
    } else {
      await addTask(data as CreateTaskData);
      showToast('Task added to the board', 'success');
    }
  };

  const handleDelete = async (id: string) => {
    await removeTask(id);
    showToast('Task deleted', 'info');
  };

  const handleImport = async (document: Document) => {
    const created = await createTaskFromDocument(document, 'backlog');
    created.expand = { document };
    addExistingTask(created);
    showToast(`“${document.title || 'Untitled'}” is on the board`, 'success');
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-5 sm:px-6 sm:pt-6 lg:px-8">
      <PageHeader
        eyebrow="Workspace"
        title="Board"
        description="Move work from intent to done. Notes stay in your library; tasks live here."
        actions={
          <>
            <Button variant="secondary" icon={<DocumentPlusIcon />} onClick={() => setImportOpen(true)}>
              Import note
            </Button>
            <Button variant="primary" icon={<PlusIcon />} onClick={() => openNewTask()}>
              New task
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink-secondary">{openCount}</span> open
          <span className="mx-1.5 text-line-strong">·</span>
          <span className="font-medium text-ink-secondary">{doneCount}</span> done
        </p>
        {isFiltering && (
          <p className="text-[11px] text-ink-muted">
            Moving is paused while searching.
          </p>
        )}
      </div>

      {tasks.length === 0 && !isLoading && !error && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-panel border border-ember/20 bg-ember-soft px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ember/25 bg-canvas/40 text-ember">
            <DocumentPlusIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">A clear desk, a fresh board.</p>
            <p className="text-xs text-ink-secondary">Add the first task, or pull one in from a note.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            Import a note
          </Button>
        </div>
      )}

      {error ? (
        <EmptyState
          title="The board could not load"
          description={error}
          action={
            <Button variant="secondary" icon={<ArrowPathIcon />} onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden lg:gap-4" aria-label="Loading board">
          {BOARD_COLUMNS.map((column) => (
            <div key={column.status} className="flex min-w-0 flex-1 flex-col rounded-panel border border-line bg-surface/40 p-2">
              <div className="mb-2 flex items-center gap-2 px-1.5 py-1.5">
                <span className={`h-2 w-2 rounded-full ${columnToneClass(column.tone)}`} />
                <span className="text-xs font-medium text-ink-secondary">{column.label}</span>
              </div>
              {[0, 1].map((index) => (
                <div key={index} className="mb-2 h-20 animate-pulse rounded-[10px] border border-line bg-surface" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-autohide lg:snap-none lg:gap-4">
          {BOARD_COLUMNS.map((column) => {
            const items = visibleByStatus[column.status];
            const isColumnTarget = dropTarget?.status === column.status;

            return (
              <section
                key={column.status}
                aria-label={`${column.label} column`}
                className={`flex w-[min(86vw,320px)] shrink-0 snap-start flex-col rounded-panel border bg-surface/45 transition-colors lg:w-auto lg:min-w-0 lg:flex-1 ${
                  isColumnTarget && draggingId ? 'border-ember/35 bg-ember-soft/20' : 'border-line'
                }`}
              >
                <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                  <span className={`h-2 w-2 rounded-full ${columnToneClass(column.tone)}`} aria-hidden="true" />
                  <h2 className="text-[13px] font-semibold text-ink">{column.label}</h2>
                  <span className="rounded-full border border-line px-1.5 text-[10px] leading-5 text-ink-muted">
                    {items.length}
                  </span>
                  <span className="ml-auto">
                    <IconButton
                      label={`Add task to ${column.label}`}
                      size="sm"
                      className="h-7 w-7 [&>svg]:h-4 [&>svg]:w-4"
                      onClick={() => openNewTask(column.status)}
                    >
                      <PlusIcon />
                    </IconButton>
                  </span>
                </header>

                <div
                  className="flex min-h-[160px] flex-1 flex-col gap-2 overflow-y-auto p-2 scrollbar-autohide"
                  onDragOver={(event) => {
                    if (!draggingId || isFiltering) return;
                    event.preventDefault();
                    dragOver(column.status, items.length);
                  }}
                  onDrop={(event) => {
                    if (!draggingId || isFiltering) return;
                    event.preventDefault();
                    const index = dropTarget?.status === column.status ? dropTarget.index : items.length;
                    void drop(column.status, index);
                  }}
                >
                  {items.map((task, index) => (
                    <Fragment key={task.id}>
                      {isColumnTarget && dropTarget?.index === index && draggingId && (
                        <div className="mx-1 h-0.5 rounded-full bg-ember" aria-hidden="true" />
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
                    <div className="mx-1 h-0.5 rounded-full bg-ember" aria-hidden="true" />
                  )}

                  {items.length === 0 && (
                    <button
                      type="button"
                      onClick={() => openNewTask(column.status)}
                      className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong/60 px-3 py-6 text-center transition-colors hover:border-ember/40 hover:bg-ember-soft/30"
                    >
                      <PlusIcon className="h-4 w-4 text-ink-muted" />
                      <span className="text-[12px] text-ink-muted">{column.hint}</span>
                      <span className="text-[11px] font-medium text-ember">Add a task</span>
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-3 hidden text-[11px] text-ink-muted md:block">
        Drag a card between columns to change its status. Click any card to edit it.
      </p>

      <TaskDialog
        open={dialogOpen}
        task={editingTask}
        defaultStatus={defaultStatus}
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
        onClose={() => setImportOpen(false)}
        existingDocumentIds={existingDocumentIds}
        onImport={handleImport}
      />
    </div>
  );
}

export default BoardPage;
