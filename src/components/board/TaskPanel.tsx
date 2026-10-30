import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  ExclamationCircleIcon,
  InboxIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { Board, BoardColumn } from '../../lib/boards';
import { getBoard } from '../../lib/boards';
import {
  deleteTask,
  duplicateTask,
  getTask,
  listLabels,
  listTaskRelations,
  listTasks,
  updateTask,
  type Task,
  type TaskLabel,
  type TaskPriority,
  type TaskRecurrence,
  type TaskRelation,
  type TaskUser,
} from '../../lib/tasks';
import { listShareLinks } from '../../lib/sharing';
import { useAuth } from '../../lib/auth';
import { useToasts } from '../../state/hooks';
import {
  Button,
  ConfirmDialog,
  IconButton,
  Spinner,
  cn,
} from '../ui';
import { NanaInlineMarkdownEditor } from '../editor/milkdown/NanaInlineMarkdownEditor';
import { isSameMarkdown, normalizeMarkdown } from '../editor/milkdown/helpers';
import { TaskProperties } from './TaskProperties';
import {
  PopoverAction,
  StatusMenu,
  TaskPopover,
  type AssigneeOption,
} from './TaskPropertyPickers';
import { TaskSection } from './TaskSection';
import { TaskSubtasks } from './TaskSubtasks';
import { TaskRelations } from './TaskRelations';
import { TaskActivity } from './TaskActivity';
import { TaskComments } from './TaskComments';
import { formatRelativeDate } from './dates';
import {
  formatTaskNumber,
  isSubtaskTask,
  normalizeTaskTitle,
  statusDotClass,
  statusOption,
} from './task-panel-model';
import './task-panel.css';

export interface TaskPanelProps {
  open: boolean;
  taskId: string | null;
  boardId: string;
  columns: BoardColumn[];
  canEdit?: boolean;
  canDelete?: boolean;
  /**
   * Comment permission is separate from edit permission. When omitted, the
   * server's comment access is used, with `canEdit` as the pre-load fallback.
   */
  canComment?: boolean;
  onClose: () => void;
  onChanged: (task?: Task) => void;
  onOpenFullPage?: (taskId: string) => void;
  /** Optional board-shell hook for opening a related task in the same panel. */
  onOpenTask?: (taskId: string) => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
type HeaderPicker = 'status' | 'more' | null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

function asTaskUser(member: AssigneeOption | null): TaskUser | null {
  if (!member) return null;
  return {
    id: member.id,
    collectionName: 'users',
    name: member.name,
    avatar: member.avatar ?? '',
  };
}

/**
 * The full task inspector. Non-modal, URL-owned by the board shell, and
 * independent of the board's own scroll container.
 */
export function TaskPanel({
  open,
  taskId,
  boardId,
  columns,
  canEdit,
  canDelete,
  canComment,
  onClose,
  onChanged,
  onOpenFullPage,
  onOpenTask,
}: TaskPanelProps) {
  const { user } = useAuth();
  const { showToast } = useToasts();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [task, setTask] = useState<Task | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [relations, setRelations] = useState<TaskRelation[]>([]);
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [members, setMembers] = useState<AssigneeOption[]>([]);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextRetry, setContextRetry] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);

  const [headerPicker, setHeaderPicker] = useState<HeaderPicker>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const headerStatusRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const taskRef = useRef<Task | null>(null);
  const taskIdRef = useRef(taskId);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const titleDirtyRef = useRef(titleDirty);
  const descriptionDirtyRef = useRef(descriptionDirty);
  const descriptionBaselineRef = useRef('');
  const titleVersionRef = useRef(0);
  const descriptionVersionRef = useRef(0);
  const descriptionTimerRef = useRef<number | undefined>(undefined);
  const titleSaveRef = useRef<Promise<boolean> | null>(null);
  const descriptionSaveRef = useRef<Promise<boolean> | null>(null);
  const loadSequenceRef = useRef(0);
  const closeRef = useRef<() => Promise<void>>(async () => {});
  const closingRef = useRef(false);

  taskIdRef.current = taskId;
  titleRef.current = title;
  descriptionRef.current = description;
  titleDirtyRef.current = titleDirty;
  descriptionDirtyRef.current = descriptionDirty;

  const replaceTask = (next: Task | null) => {
    taskRef.current = next;
    setTask(next);
  };

  const setTaskState = (updater: (current: Task) => Task) => {
    const current = taskRef.current;
    if (!current) return;
    const next = updater(current);
    taskRef.current = next;
    setTask(next);
  };

  const beginSave = () => setSavingCount((count) => count + 1);
  const finishSave = () => setSavingCount((count) => Math.max(0, count - 1));

  const isOwner = Boolean(user?.id && board?.author === user.id);
  const canEditTask = canEdit ?? isOwner;
  const canDeleteTask = canDelete ?? canEditTask;
  const status = task ? statusOption(task.status, columns) : null;

  const saveState =
    savingCount > 0 ? 'Saving…' : titleDirty || descriptionDirty ? 'Unsaved changes' : 'Saved';

  // ── Focus restore ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // ── Load the task and its board ─────────────────────────────────
  useEffect(() => {
    if (!open || !taskId) {
      loadSequenceRef.current += 1;
      setLoadState('idle');
      setLoadError(null);
      replaceTask(null);
      setBoard(null);
      setRelations([]);
      setBoardTasks([]);
      setLabels([]);
      setMembers([]);
      setHeaderPicker(null);
      setDeleteOpen(false);
      return;
    }

    const sequence = ++loadSequenceRef.current;
    setLoadState('loading');
    setLoadError(null);
    setSaveError(null);
    replaceTask(null);
    setBoard(null);
    setRelations([]);
    setBoardTasks([]);
    setLabels([]);
    setMembers([]);
    setContextError(null);
    setTitle('');
    setDescription('');
    setTitleDirty(false);
    setDescriptionDirty(false);
    setSavingCount(0);
    setHeaderPicker(null);
    setDeleteOpen(false);
    setDeleting(false);
    setActionBusy(null);
    descriptionBaselineRef.current = '';
    titleVersionRef.current = 0;
    descriptionVersionRef.current = 0;
    titleSaveRef.current = null;
    descriptionSaveRef.current = null;
    setActivityVersion(0);
    window.clearTimeout(descriptionTimerRef.current);

    void (async () => {
      const [taskResult, boardResult] = await Promise.allSettled([
        getTask(taskId),
        getBoard(boardId),
      ]);

      if (sequence !== loadSequenceRef.current) return;

      if (taskResult.status === 'rejected') {
        if (errorStatus(taskResult.reason) === 404) {
          setLoadState('missing');
        } else {
          setLoadState('error');
          setLoadError(errorMessage(taskResult.reason, 'Could not load this task.'));
        }
        return;
      }

      const loaded = taskResult.value;
      const boardValue = boardResult.status === 'fulfilled' ? boardResult.value : null;
      replaceTask(loaded);
      setBoard(boardValue);
      setTitle(loaded.title);
      setDescription(loaded.description);
      descriptionBaselineRef.current = normalizeMarkdown(loaded.description);
      setTitleDirty(false);
      setDescriptionDirty(false);
      setLoadState('ready');
    })();
  }, [open, taskId, boardId, retryToken]);

  // ── Context: tasks, relations, labels, members ──────────────────
  useEffect(() => {
    if (!open || loadState !== 'ready' || !taskId) return;

    let current = true;
    const owner = Boolean(user?.id && board?.author === user.id);
    setContextError(null);

    void (async () => {
      const [tasksResult, relationsResult, labelsResult, sharesResult] = await Promise.allSettled([
        listTasks(boardId),
        listTaskRelations(taskId),
        owner ? listLabels() : Promise.resolve<TaskLabel[]>([]),
        owner ? listShareLinks('board', boardId) : Promise.resolve({ items: [] }),
      ]);

      if (!current) return;

      let failed = false;
      if (tasksResult.status === 'fulfilled') {
        setBoardTasks(tasksResult.value);
      } else {
        failed = true;
      }

      if (relationsResult.status === 'fulfilled') {
        setRelations(relationsResult.value);
      } else {
        failed = true;
      }

      if (labelsResult.status === 'fulfilled') {
        setLabels(labelsResult.value);
      }

      if (failed) {
        setContextError('Could not load subtasks and relations.');
      }

      const options = new Map<string, AssigneeOption>();
      if (user?.id) {
        options.set(user.id, {
          id: user.id,
          name: String(user.name || user.email || 'You'),
          avatar: String(user.avatar || ''),
        });
      }
      if (board?.author && !options.has(board.author)) {
        options.set(board.author, { id: board.author, name: 'Board owner', avatar: '' });
      }
      if (sharesResult.status === 'fulfilled') {
        for (const share of sharesResult.value.items) {
          if (share.user?.id && !options.has(share.user.id)) {
            options.set(share.user.id, {
              id: share.user.id,
              name: share.user.name || 'Shared member',
              avatar: share.user.avatar || '',
            });
          }
        }
      }
      const assigned = taskRef.current?.expand?.assignee;
      if (assigned && !options.has(assigned.id)) {
        options.set(assigned.id, {
          id: assigned.id,
          name: assigned.name || assigned.email || 'Assigned member',
          avatar: assigned.avatar || '',
        });
      }
      setMembers(Array.from(options.values()));
    })();

    return () => {
      current = false;
    };
  }, [
    open,
    loadState,
    taskId,
    boardId,
    board?.author,
    user?.id,
    user?.name,
    user?.email,
    user?.avatar,
    contextRetry,
  ]);

  // ── Title sizing ────────────────────────────────────────────────
  useEffect(() => {
    const input = titleInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [title, loadState]);

  // A parent-driven close or task switch does not go through `handleClose`.
  // Flush dirty text so navigating to a linked note cannot lose the last edit.
  useEffect(() => {
    const flushTaskId = taskId;
    return () => {
      if (!flushTaskId) return;
      if (descriptionDirtyRef.current) {
        void updateTask(flushTaskId, { description: descriptionRef.current }).catch(() => {
          // The inspector is already gone; the next load wins.
        });
      }
      if (titleDirtyRef.current) {
        void updateTask(flushTaskId, { title: normalizeTaskTitle(titleRef.current) }).catch(() => {
          // The inspector is already gone; the next load wins.
        });
      }
    };
  }, [taskId]);

  useEffect(() => {
    setHeaderPicker(null);
  }, [taskId]);

  // ── Saves ───────────────────────────────────────────────────────
  const saveTitle = (): Promise<boolean> => {
    if (titleSaveRef.current) return titleSaveRef.current;

    const promise = (async () => {
      const current = taskRef.current;
      const id = taskIdRef.current;
      if (!current || !id) return true;

      const next = normalizeTaskTitle(titleRef.current);
      if (next === current.title && !titleDirtyRef.current) {
        if (titleRef.current !== next) {
          setTitle(next);
          titleRef.current = next;
        }
        return true;
      }

      const previous = current;
      const version = titleVersionRef.current;
      setTitle(next);
      titleRef.current = next;
      setTitleDirty(false);
      titleDirtyRef.current = false;
      setTaskState((currentTask) => ({ ...currentTask, title: next }));
      setSaveError(null);
      beginSave();

      try {
        const updated = await updateTask(id, { title: next });
        if (taskIdRef.current !== id) return true;

        if (titleVersionRef.current === version) {
          setTitle(updated.title);
          titleRef.current = updated.title;
          setTaskState((currentTask) => ({
            ...currentTask,
            ...updated,
            expand: currentTask.expand,
          }));
        } else {
          const latest = normalizeTaskTitle(titleRef.current);
          setTaskState((currentTask) => ({
            ...currentTask,
            ...updated,
            title: latest,
            expand: currentTask.expand,
          }));
          setTitleDirty(true);
          titleDirtyRef.current = true;
        }

        onChanged(updated);
        setActivityVersion((value) => value + 1);
        return true;
      } catch (error) {
        if (taskIdRef.current === id) {
          if (titleVersionRef.current === version) {
            setTitle(previous.title);
            titleRef.current = previous.title;
            setTaskState(() => previous);
            setTitleDirty(false);
            titleDirtyRef.current = false;
          } else {
            setTaskState((currentTask) => ({
              ...currentTask,
              title: normalizeTaskTitle(titleRef.current),
            }));
            setTitleDirty(true);
            titleDirtyRef.current = true;
          }
          setSaveError(errorMessage(error, 'Could not save the title. Your change was not lost.'));
        }
        return false;
      } finally {
        finishSave();
      }
    })();

    titleSaveRef.current = promise;
    void promise.finally(() => {
      if (titleSaveRef.current === promise) titleSaveRef.current = null;
    });
    return promise;
  };

  const saveDescription = (value: string): Promise<boolean> => {
    if (descriptionSaveRef.current) {
      return descriptionSaveRef.current.then((ok) => {
        if (!ok) return false;
        if (descriptionDirtyRef.current) return saveDescription(descriptionRef.current);
        return true;
      });
    }

    const promise = (async () => {
      const current = taskRef.current;
      const id = taskIdRef.current;
      if (!current || !id) return true;

      const next = value;
      if (isSameMarkdown(next, descriptionBaselineRef.current) && !descriptionDirtyRef.current) {
        return true;
      }

      const version = descriptionVersionRef.current;
      setDescription(next);
      descriptionRef.current = next;
      setTaskState((currentTask) => ({ ...currentTask, description: next }));
      setSaveError(null);
      beginSave();

      try {
        const updated = await updateTask(id, { description: next });
        if (taskIdRef.current !== id) return true;

        descriptionBaselineRef.current = normalizeMarkdown(next);
        if (descriptionVersionRef.current === version) {
          setDescription(updated.description);
          descriptionRef.current = updated.description;
          setDescriptionDirty(false);
          descriptionDirtyRef.current = false;
          setTaskState((currentTask) => ({
            ...currentTask,
            ...updated,
            expand: currentTask.expand,
          }));
        } else {
          setTaskState((currentTask) => ({
            ...currentTask,
            ...updated,
            description: descriptionRef.current,
            expand: currentTask.expand,
          }));
          setDescriptionDirty(true);
          descriptionDirtyRef.current = true;
        }

        onChanged(updated);
        setActivityVersion((valueNumber) => valueNumber + 1);
        return true;
      } catch (error) {
        if (taskIdRef.current === id) {
          const dirty = !isSameMarkdown(descriptionRef.current, descriptionBaselineRef.current);
          setDescriptionDirty(dirty);
          descriptionDirtyRef.current = dirty;
          setSaveError(errorMessage(error, 'Could not save the description. Your text is still here.'));
        }
        return false;
      } finally {
        finishSave();
      }
    })();

    descriptionSaveRef.current = promise;
    void promise.finally(() => {
      if (descriptionSaveRef.current === promise) descriptionSaveRef.current = null;
    });
    return promise;
  };

  const scheduleDescriptionSave = (value: string) => {
    window.clearTimeout(descriptionTimerRef.current);
    if (isSameMarkdown(value, descriptionBaselineRef.current)) {
      setDescriptionDirty(false);
      descriptionDirtyRef.current = false;
      return;
    }
    setDescriptionDirty(true);
    descriptionDirtyRef.current = true;
    descriptionTimerRef.current = window.setTimeout(() => {
      void saveDescription(value);
    }, 800);
  };

  const handleClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(descriptionTimerRef.current);

    if (titleSaveRef.current) {
      const ok = await titleSaveRef.current;
      if (!ok) {
        closingRef.current = false;
        return;
      }
    }
    if (descriptionSaveRef.current) {
      const ok = await descriptionSaveRef.current;
      if (!ok) {
        closingRef.current = false;
        return;
      }
    }
    if (titleDirtyRef.current) {
      const ok = await saveTitle();
      if (!ok) {
        closingRef.current = false;
        return;
      }
    }
    if (descriptionDirtyRef.current) {
      const ok = await saveDescription(descriptionRef.current);
      if (!ok) {
        closingRef.current = false;
        return;
      }
    }

    onClose();
  };
  closeRef.current = handleClose;

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-dialog-layer]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-panel-popover]')) return;
      event.preventDefault();
      void closeRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // ── Optimistic property updates ─────────────────────────────────
  const patchTask = async (
    patch: Parameters<typeof updateTask>[1],
    optimistic: (current: Task) => Task,
    fallbackMessage: string
  ): Promise<boolean> => {
    const current = taskRef.current;
    const id = taskIdRef.current;
    if (!current || !id) return false;

    const previous = current;
    setTaskState(optimistic);
    setSaveError(null);
    beginSave();

    try {
      const updated = await updateTask(id, patch);
      if (taskIdRef.current !== id) return true;
      setTaskState((currentTask) => ({
        ...currentTask,
        ...updated,
        expand: currentTask.expand,
      }));
      onChanged(updated);
      setActivityVersion((value) => value + 1);
      return true;
    } catch (error) {
      if (taskIdRef.current === id) {
        setTaskState(() => previous);
        setSaveError(errorMessage(error, fallbackMessage));
      }
      return false;
    } finally {
      finishSave();
    }
  };

  const handleStatusChange = (next: string) => {
    if (!task) return;
    setHeaderPicker(null);
    void patchTask(
      { status: next },
      (current) => ({ ...current, status: next }),
      'Could not change the status.'
    );
  };

  const handlePriorityChange = (next: TaskPriority | '') => {
    void patchTask(
      { priority: next },
      (current) => ({ ...current, priority: next }),
      'Could not change the priority.'
    );
  };

  const handleAssigneeChange = (member: AssigneeOption | null) => {
    const assigned = asTaskUser(member);
    if (member) {
      setMembers((current) =>
        current.some((candidate) => candidate.id === member.id) ? current : [...current, member]
      );
    }
    void patchTask(
      { assignee: member?.id ?? '' },
      (current) => ({
        ...current,
        assignee: member?.id ?? '',
        expand: { ...current.expand, assignee: assigned ?? undefined },
      }),
      'Could not change the assignee. Choose someone who can access this board.'
    );
  };

  const handleDateChange = (field: 'start_date' | 'due_date', value: string) => {
    const stored = value ? `${value} 00:00:00.000Z` : '';
    void patchTask(
      { [field]: stored },
      (current) => ({ ...current, [field]: stored }),
      field === 'due_date' ? 'Could not change the due date.' : 'Could not change the start date.'
    );
  };

  const handleLabelsChange = (next: string[]) => {
    void patchTask(
      { labels: next },
      (current) => ({ ...current, labels: next }),
      'Could not change the labels.'
    );
  };

  const handleRecurrenceChange = (next: TaskRecurrence | null) => {
    void patchTask(
      { recurrence: next },
      (current) => ({ ...current, recurrence: next }),
      'Could not change the repeat rule.'
    );
  };

  const handleBoardTaskPatched = (updated: Task) => {
    setBoardTasks((current) =>
      current.some((candidate) => candidate.id === updated.id)
        ? current.map((candidate) => (candidate.id === updated.id ? updated : candidate))
        : [...current, updated]
    );
  };

  // ── Actions ─────────────────────────────────────────────────────
  const handleOpenTask = (nextTaskId: string) => {
    if (nextTaskId === taskId) return;
    if (onOpenTask) {
      onOpenTask(nextTaskId);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('task', nextTaskId);
    setSearchParams(next);
  };

  const handleOpenDocument = (documentId: string) => {
    if (documentId) navigate(`/document/${documentId}`);
  };

  const handleDuplicate = async () => {
    if (!task || actionBusy) return;
    setActionBusy('duplicate');
    setHeaderPicker(null);
    try {
      const copy = await duplicateTask(task, boardId);
      showToast(
        copy.task_number ? `Task duplicated as #${copy.task_number}.` : 'Task duplicated.',
        'success'
      );
      onChanged(copy);
    } catch (error) {
      showToast(errorMessage(error, 'Could not duplicate the task.'), 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const handleMoveTo = async (statusValue: 'planned' | 'archived') => {
    if (!task || actionBusy) return;
    setActionBusy(statusValue);
    setHeaderPicker(null);
    try {
      const updated = await updateTask(task.id, { status: statusValue });
      setTaskState((current) => ({ ...current, ...updated, expand: current.expand }));
      onChanged(updated);
      setActivityVersion((value) => value + 1);
      showToast(statusValue === 'archived' ? 'Task archived.' : 'Task moved to Planned.', 'success');
    } catch (error) {
      showToast(errorMessage(error, 'Could not move the task.'), 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!task || deleting) return;
    setDeleting(true);
    try {
      await deleteTask(task.id);
      setDeleteOpen(false);
      showToast('Task deleted.', 'success');
      onChanged();
      onClose();
    } catch (error) {
      setDeleteOpen(false);
      setSaveError(errorMessage(error, 'Could not delete the task.'));
    } finally {
      setDeleting(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const panelLabel = task ? normalizeTaskTitle(task.title) : 'Task details';
  const hasMoreActions = canEditTask || canDeleteTask;

  return createPortal(
    <>
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={panelLabel}
        aria-busy={loadState === 'loading' || undefined}
        tabIndex={-1}
        className="task-panel"
      >
        <header className="task-panel__header">
          <div className="task-panel__header-row">
            <div className="task-panel__identity">
              {task?.task_number && (
                <span className="task-panel__number" title="Task number">
                  {formatTaskNumber(task.task_number)}
                </span>
              )}

              {task && status ? (
                canEditTask ? (
                  <>
                    <button
                      ref={headerStatusRef}
                      type="button"
                      onClick={() => setHeaderPicker((current) => (current === 'status' ? null : 'status'))}
                      aria-haspopup="dialog"
                      aria-expanded={headerPicker === 'status'}
                      className="task-panel__status-trigger"
                    >
                      <span className={cn('h-2 w-2 rounded-full', statusDotClass(task.status, columns))} aria-hidden="true" />
                      <span className="truncate">{status.label}</span>
                      <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                    </button>
                    <TaskPopover
                      open={headerPicker === 'status'}
                      onClose={() => setHeaderPicker(null)}
                      anchorRef={headerStatusRef}
                      label="Change status"
                    >
                      <StatusMenu value={task.status} columns={columns} onSelect={handleStatusChange} />
                    </TaskPopover>
                  </>
                ) : (
                  <span className="task-panel__status-trigger task-panel__status-trigger--static">
                    <span className={cn('h-2 w-2 rounded-full', statusDotClass(task.status, columns))} aria-hidden="true" />
                    <span className="truncate">{status.label}</span>
                  </span>
                )
              ) : (
                <span className="task-panel__number">Task</span>
              )}
            </div>

            <div className="task-panel__header-actions">
              {onOpenFullPage && task && (
                <IconButton
                  label="Open full page"
                  size="md"
                  className="task-panel__header-icon"
                  onClick={() => onOpenFullPage(task.id)}
                >
                  <ArrowTopRightOnSquareIcon />
                </IconButton>
              )}

              {hasMoreActions && task && (
                <>
                  <IconButton
                    ref={moreButtonRef}
                    label="More task actions"
                    size="md"
                    className="task-panel__header-icon"
                    aria-haspopup="dialog"
                    aria-expanded={headerPicker === 'more'}
                    onClick={() => setHeaderPicker((current) => (current === 'more' ? null : 'more'))}
                  >
                    <EllipsisHorizontalIcon />
                  </IconButton>
                  <TaskPopover
                    open={headerPicker === 'more'}
                    onClose={() => setHeaderPicker(null)}
                    anchorRef={moreButtonRef}
                    label="Task actions"
                    width={260}
                    align="end"
                  >
                    <div role="menu" aria-label="Task actions">
                      {canEditTask && (
                        <PopoverAction
                          label="Duplicate task"
                          icon={<DocumentDuplicateIcon />}
                          onClick={() => void handleDuplicate()}
                          disabled={actionBusy !== null}
                        />
                      )}
                      {canEditTask && (
                        <PopoverAction
                          label="Move to Planned"
                          icon={<InboxIcon />}
                          onClick={() => void handleMoveTo('planned')}
                          disabled={actionBusy !== null || task.status === 'planned'}
                        />
                      )}
                      {canEditTask && (
                        <PopoverAction
                          label="Move to Archived"
                          icon={<ArchiveBoxIcon />}
                          onClick={() => void handleMoveTo('archived')}
                          disabled={actionBusy !== null || task.status === 'archived'}
                        />
                      )}
                      {canDeleteTask && (
                        <>
                          <div className="my-1 border-t border-line" role="separator" />
                          <PopoverAction
                            label="Delete task"
                            icon={<TrashIcon />}
                            danger
                            onClick={() => {
                              setHeaderPicker(null);
                              setDeleteOpen(true);
                            }}
                            disabled={actionBusy !== null}
                          />
                        </>
                      )}
                    </div>
                  </TaskPopover>
                </>
              )}

              <IconButton
                label="Close task panel"
                size="md"
                className="task-panel__header-icon"
                onClick={() => void handleClose()}
              >
                <XMarkIcon />
              </IconButton>
            </div>

            {loadState === 'ready' && (
              <span
                className={cn(
                  'task-panel__save-state',
                  saveState === 'Unsaved changes' && 'text-warning',
                  saveState === 'Saving…' && 'text-ink-muted'
                )}
                aria-live="polite"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    saveState === 'Saved'
                      ? 'bg-success'
                      : saveState === 'Saving…'
                        ? 'bg-ink-muted animate-pulse'
                        : 'bg-warning'
                  )}
                  aria-hidden="true"
                />
                {saveState}
              </span>
            )}
          </div>
        </header>

        <div className="task-panel__body scrollbar-autohide">
          {saveError && (
            <div className="task-panel__error" role="alert">
              <ExclamationCircleIcon className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{saveError}</p>
              <IconButton
                label="Dismiss save error"
                size="sm"
                className="h-7 w-7"
                onClick={() => setSaveError(null)}
              >
                <XMarkIcon />
              </IconButton>
            </div>
          )}

          {(loadState === 'loading' || loadState === 'idle') && (
            <div className="task-panel__state" role="status">
              <Spinner label="Loading task" />
              <p className="text-[12.5px] text-ink-muted">
                {loadState === 'idle' ? 'No task selected.' : 'Loading task…'}
              </p>
            </div>
          )}

          {loadState === 'missing' && (
            <div className="task-panel__state">
              <InboxIcon className="h-6 w-6 text-ink-muted" aria-hidden="true" />
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Task not found</h2>
              <p className="max-w-[36ch] text-[12.5px] leading-relaxed text-ink-secondary">
                It may have been deleted, or you no longer have access to this board.
              </p>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Close panel
              </Button>
            </div>
          )}

          {loadState === 'error' && (
            <div className="task-panel__state">
              <ExclamationCircleIcon className="h-6 w-6 text-danger" aria-hidden="true" />
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
                Could not load this task
              </h2>
              <p className="max-w-[36ch] text-[12.5px] leading-relaxed text-ink-secondary">
                {loadError || 'Check your connection and try again.'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ArrowPathIcon />}
                  onClick={() => setRetryToken((token) => token + 1)}
                >
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          )}

          {loadState === 'ready' && task && (
            <div className="task-panel__layout">
              <div className="task-panel__title-area">
                {canEditTask ? (
                  <textarea
                    ref={titleInputRef}
                    value={title}
                    rows={1}
                    onChange={(event) => {
                      const next = event.target.value;
                      setTitle(next);
                      titleRef.current = next;
                      titleVersionRef.current += 1;
                      const dirty = normalizeTaskTitle(next) !== task.title;
                      setTitleDirty(dirty);
                      titleDirtyRef.current = dirty;
                      if (saveError) setSaveError(null);
                    }}
                    onBlur={() => {
                      if (titleDirtyRef.current || titleRef.current.trim() === '') {
                        void saveTitle();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void saveTitle();
                        event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setTitle(taskRef.current?.title ?? '');
                        titleRef.current = taskRef.current?.title ?? '';
                        setTitleDirty(false);
                        titleDirtyRef.current = false;
                        event.currentTarget.blur();
                      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void saveTitle();
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="Untitled task"
                    aria-label="Task title"
                    className="task-panel__title"
                    spellCheck
                  />
                ) : (
                  <h2 className="task-panel__title task-panel__title--static">
                    {normalizeTaskTitle(title)}
                  </h2>
                )}
              </div>

              <TaskProperties
                key={`properties-${task.id}`}
                task={task}
                columns={columns}
                labels={labels}
                members={members}
                canEdit={canEditTask}
                isOwner={isOwner}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                onAssigneeChange={handleAssigneeChange}
                onDateChange={handleDateChange}
                onLabelsChange={handleLabelsChange}
                onLabelCreated={(label) => {
                  setLabels((current) =>
                    current.some((candidate) => candidate.id === label.id)
                      ? current
                      : [...current, label].sort((left, right) => left.name.localeCompare(right.name))
                  );
                }}
                onRecurrenceChange={handleRecurrenceChange}
                onOpenDocument={handleOpenDocument}
              />

              <div className="task-panel__main">
                <TaskSection title="Description" id="task-description">
                  {canEditTask ? (
                    <div
                      className="task-panel__description"
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void saveDescription(descriptionRef.current);
                        }
                      }}
                    >
                      <NanaInlineMarkdownEditor
                        value={description}
                        onChange={(value) => {
                          setDescription(value);
                          descriptionRef.current = value;
                          descriptionVersionRef.current += 1;
                          scheduleDescriptionSave(value);
                        }}
                        placeholder="Add context, acceptance criteria, links…"
                        minHeight={96}
                        ariaLabel="Task description"
                        showToolbar
                        enableSlash
                      />
                      <p className="task-panel__hint">
                        Markdown. Saves after you stop typing. ⌘/Ctrl + Enter saves now.
                      </p>
                    </div>
                  ) : description.trim() ? (
                    <div className="task-panel__description">
                      <NanaInlineMarkdownEditor
                        value={description}
                        onChange={() => {}}
                        readOnly
                        minHeight={96}
                        ariaLabel="Task description"
                        showToolbar={false}
                        enableSlash={false}
                      />
                    </div>
                  ) : (
                    <p className="px-0.5 py-1 text-[12.5px] text-ink-muted">No description.</p>
                  )}
                </TaskSection>

                {contextError && (
                  <div className="task-panel__context-error">
                    <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{contextError}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ArrowPathIcon />}
                      onClick={() => setContextRetry((value) => value + 1)}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                <TaskSubtasks
                  key={`subtasks-${task.id}`}
                  task={task}
                  columns={columns}
                  relations={relations}
                  boardTasks={boardTasks}
                  canEdit={canEditTask}
                  isSubtask={isSubtaskTask(relations, task.id)}
                  onOpenTask={handleOpenTask}
                  onBoardTaskPatched={handleBoardTaskPatched}
                  onBoardTaskAdded={(created) => setBoardTasks((current) => [...current, created])}
                  onRelationAdded={(relation) => setRelations((current) => [...current, relation])}
                  onChanged={onChanged}
                />

                <TaskRelations
                  key={`relations-${task.id}`}
                  task={task}
                  columns={columns}
                  relations={relations}
                  boardTasks={boardTasks}
                  canEdit={canEditTask}
                  onOpenTask={handleOpenTask}
                  onRelationAdded={(relation) => setRelations((current) => [...current, relation])}
                  onRelationRemoved={(relationId) =>
                    setRelations((current) => current.filter((relation) => relation.id !== relationId))
                  }
                  onChanged={onChanged}
                />

                <TaskActivity taskId={task.id} columns={columns} refreshToken={activityVersion} />

                <TaskComments
                  key={`comments-${task.id}`}
                  taskId={task.id}
                  canEdit={canEditTask}
                  canComment={canComment}
                  isOwner={isOwner}
                  onChanged={() => onChanged()}
                />

                {isOwner && (
                  <footer className="task-panel__meta">
                    <span>Created {formatRelativeDate(task.created) || 'unknown'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Updated {formatRelativeDate(task.updated) || 'unknown'}</span>
                  </footer>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this task?"
        description="The task is removed from the board. The note it links to stays untouched."
        confirmLabel="Delete task"
        tone="danger"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      />
    </>,
    document.body
  );
}
