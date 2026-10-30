import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ChevronLeftIcon,
  Cog6ToothIcon,
  DocumentPlusIcon,
  EllipsisHorizontalIcon,
  LockClosedIcon,
  PlusIcon,
  QuestionMarkCircleIcon,
  ShareIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Document } from '../lib/documents';
import {
  getBoard,
  restoreBoard,
  summarizeTaskCounts,
  type Board,
} from '../lib/boards';
import {
  createTaskFromDocument,
  duplicateTask,
  type Task,
  type TaskDraft,
  type TaskPriority,
  type UpdateTaskData,
} from '../lib/tasks';
import {
  canDragTasks,
  DEFAULT_BOARD_PREFERENCES,
  filterTasks,
  hasActiveFilters,
  isBoardView,
  loadBoardPreferences,
  saveBoardPreferences,
  searchTasks,
  sortTasks,
  type BoardPreferences,
  type BoardView,
  type FilterSubject,
} from '../lib/board-preferences';
import { useAuth } from '../lib/auth';
import { useToasts } from '../state/hooks';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  PageHeader,
  PageShell,
  cn,
} from '../components/ui';
import { BoardView as BoardLanes } from '../components/board/BoardView';
import { BoardToolbar } from '../components/board/BoardToolbar';
import { BoardBulkBar } from '../components/board/BoardBulkBar';
import { BoardSettingsPanel } from '../components/board/BoardSettingsPanel';
import { BacklogView } from '../components/board/BacklogView';
import { CalendarView } from '../components/board/CalendarView';
import { GanttView } from '../components/board/GanttView';
import { ListView } from '../components/board/ListView';
import { TaskContextMenu } from '../components/board/TaskContextMenu';
import { TaskPanel } from '../components/board/TaskPanel';
import { useResourceAccess } from '../state/hooks/useResourceAccess';
import { ImportNotePanel } from '../components/board/ImportNotePanel';
import { useBoardState } from '../components/board/useBoardState';
import { useBoardMetadata } from '../components/board/useBoardMetadata';
import { defaultLabelColor, type BoardLabel } from '../components/board/board-config';
import { formatRelativeDate } from '../components/board/dates';
import { menuPositionFromRect, useIsMobile } from '../components/board/TaskQuickPickers';
import { ShareButton } from '../components/sharing';
import '../components/board/board.css';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 404
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    Boolean(target.closest('[role="textbox"]'))
  );
}

function isInOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[role="menu"],[role="dialog"],[data-dialog-layer]'));
}

interface DeleteState {
  kind: 'single';
  task: Task;
}

interface BulkDeleteState {
  kind: 'bulk';
  ids: string[];
}

const SHORTCUTS = [
  {
    title: 'General',
    rows: [
      ['/', 'Focus search'],
      ['C', 'New task'],
      ['?', 'This shortcut sheet'],
      ['Esc', 'Clear selection or close'],
    ],
  },
  {
    title: 'Move',
    rows: [
      ['J / K', 'Next or previous task'],
      ['Home / End', 'First or last task'],
      ['Enter / Space', 'Open the focused task'],
      ['X', 'Select the focused task'],
      ['Cmd/Ctrl + A', 'Select every visible task'],
    ],
  },
  {
    title: 'Edit',
    rows: [
      ['S / P / A / L', 'Status, priority, assignee, labels'],
      ['Shift + D', 'Due date'],
      ['Alt + ← / →', 'Move to the previous or next column'],
      ['Alt + ↑ / ↓', 'Reorder within the column'],
    ],
  },
];

export function BoardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { boardId } = useParams<{ boardId: string }>();
  const { user } = useAuth();
  const { showToast } = useToasts();
  const isMobile = useIsMobile();

  const [searchParams, setSearchParams] = useSearchParams();

  const [board, setBoard] = useState<Board | null>(null);
  const [isBoardLoading, setIsBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAutoFocus, setEditAutoFocus] = useState(false);
  const [editNewBoard, setEditNewBoard] = useState(false);

  const [preferences, setPreferences] = useState<BoardPreferences>(() =>
    boardId ? loadBoardPreferences(boardId) : DEFAULT_BOARD_PREFERENCES,
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesBoardId, setPreferencesBoardId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [composerStatus, setComposerStatus] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{
    taskId: string;
    anchor: DOMRect;
    section?: 'status' | 'priority' | 'assignee' | 'due' | 'labels';
  } | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | BulkDeleteState | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [movingAll, setMovingAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<DOMRect | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedId = useRef<string | null>(null);

  const activeBoardId =
    board && board.id === boardId && !board.archived ? board.id : undefined;
  const {
    tasks,
    columns,
    loadingColumns,
    byStatus,
    defaultStatus,
    isLoading,
    error,
    draggingId,
    dropTarget,
    load,
    reloadColumns,
    retry,
    addTask,
    addExistingTask,
    editTask,
    removeTask,
    startDrag,
    endDrag,
    dragOver,
    drop,
    moveTask,
  } = useBoardState(activeBoardId);
  const { members, labels, createLabel } = useBoardMetadata();
  const boardLabels = useMemo<BoardLabel[]>(() => {
    const known = new Set(labels.map((label) => label.name));
    const extras: BoardLabel[] = [];
    for (const task of tasks) {
      for (const name of task.labels ?? []) {
        if (!name || known.has(name)) continue;
        known.add(name);
        extras.push({ id: `task-label-${name}`, name, color: defaultLabelColor(name) });
      }
    }
    return [...labels, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [labels, tasks]);

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
        if (!cancelled) setBoard(record);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (isNotFound(loadError)) {
          setNotFound(true);
          return;
        }
        setBoardError(
          loadError instanceof Error ? loadError.message : 'Could not load the board.',
        );
      })
      .finally(() => {
        if (!cancelled) setIsBoardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [boardId, reloadToken]);

  useEffect(() => {
    if (!boardId) return;
    setPreferences(loadBoardPreferences(boardId));
    setPreferencesBoardId(boardId);
    setPreferencesReady(true);
    setQuery('');
    setComposerStatus(null);
    setSelection(new Set());
    setSelectionMode(false);
    setDeleteState(null);
    setMenuState(null);
    setImportOpen(false);
    setEditOpen(false);
    setEditAutoFocus(false);
    setEditNewBoard(false);
    setMoreAnchor(null);
  }, [boardId]);

  useEffect(() => {
    if (!boardId || !preferencesReady || preferencesBoardId !== boardId) return;
    saveBoardPreferences(boardId, preferences);
  }, [boardId, preferences, preferencesBoardId, preferencesReady]);

  const requestView = searchParams.get('view');
  const view: BoardView = isBoardView(requestView) ? requestView : preferences.view;

  useEffect(() => {
    if (!isBoardView(requestView)) return;
    setPreferences((current) =>
      current.view === requestView ? current : { ...current, view: requestView },
    );
  }, [requestView]);

  const taskParam = searchParams.get('task');
  const openTaskId = taskParam;

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

  useEffect(() => {
    setSelection((current) => {
      if (current.size === 0) return current;
      const known = new Set(tasks.map((task) => task.id));
      const next = new Set([...current].filter((id) => known.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  const counts = useMemo(() => summarizeTaskCounts(tasks, columns), [tasks, columns]);
  const taskCountsByStatus = useMemo(() => {
    const result: Record<string, number> = {};
    for (const status of Object.keys(byStatus)) result[status] = byStatus[status]?.length ?? 0;
    return result;
  }, [byStatus]);

  const displayTasks = useMemo(
    () =>
      sortTasks(
        searchTasks(filterTasks(tasks, preferences.filters), query),
        preferences.sort,
        preferences.sortDirection,
      ),
    [tasks, preferences.filters, preferences.sort, preferences.sortDirection, query],
  );

  const workflowSlugs = useMemo(
    () => new Set(columns.map((column) => column.slug)),
    [columns],
  );
  const isBacklogStatus = (status: string) => status === 'planned' || status === 'archived';
  const viewTasks = useMemo(() => {
    if (view === 'backlog') return displayTasks.filter((task) => isBacklogStatus(task.status));
    if (view === 'board' || view === 'list') {
      return displayTasks.filter((task) => workflowSlugs.has(task.status));
    }
    return displayTasks;
  }, [displayTasks, view, workflowSlugs]);
  const viewTotal = useMemo(() => {
    if (view === 'backlog') return tasks.filter((task) => isBacklogStatus(task.status)).length;
    if (view === 'board' || view === 'list') {
      return tasks.filter((task) => workflowSlugs.has(task.status)).length;
    }
    return tasks.length;
  }, [tasks, view, workflowSlugs]);

  const grouped = useMemo(() => {
    const groups: Record<string, Task[]> = {};
    for (const column of columns) groups[column.slug] = [];
    groups.planned = [];
    groups.archived = [];
    for (const task of viewTasks) {
      const group = groups[task.status] ?? (groups[task.status] = []);
      group.push(task);
    }
    return groups;
  }, [columns, viewTasks]);

  const filtering = hasActiveFilters(preferences.filters, query);
  const { access: boardAccess } = useResourceAccess('board', board?.id);
  const isBoardOwner = Boolean(board && user?.id === board.author);
  const canEditBoard = Boolean(
    board && !board.archived && (isBoardOwner || boardAccess.role === 'edit'),
  );
  const canCommentBoard = canEditBoard || boardAccess.role === 'comment';
  const dragEnabled = canEditBoard && canDragTasks(preferences, query);
  const selectedTasks = useMemo(
    () => tasks.filter((task) => selection.has(task.id)),
    [selection, tasks],
  );
  const menuTask = menuState ? tasks.find((task) => task.id === menuState.taskId) ?? null : null;

  const firstOpenColumn = columns.find((column) => !column.is_final) ?? columns[0];

  const announce = (message: string) => setLiveMessage(message);

  const setView = (next: BoardView) => {
    setPreferences((current) => ({ ...current, view: next }));
    setSelection(new Set());
    setSelectionMode(false);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set('view', next);
        return params;
      },
      { replace: true },
    );
  };

  const updateFilters = (next: BoardPreferences['filters']) => {
    setPreferences((current) => ({ ...current, filters: next }));
    clearSelection();
  };

  const clearFilters = () => {
    setPreferences((current) => ({
      ...current,
      filters: DEFAULT_BOARD_PREFERENCES.filters,
    }));
    setQuery('');
    clearSelection();
  };

  const clearSelection = () => {
    setSelection(new Set());
    setSelectionMode(false);
    setLastSelectedId(null);
  };

  const openTask = (task: Task) => {
    setComposerStatus(null);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set('task', task.id);
        return params;
      },
      { replace: false },
    );
  };

  const closeTask = () => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete('task');
        return params;
      },
      { replace: false },
    );
  };

  const openComposer = (status?: string) => {
    if (!board || board.archived || !canEditBoard) return;
    const target = status ?? firstOpenColumn?.slug ?? 'planned';
    if (openTaskId) closeTask();
    setView('board');
    setComposerStatus(target);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(`[data-lane-composer="${CSS.escape(target)}"] input`)
        ?.focus();
    });
  };

  const openInlineComposer = (status?: string) => {
    if (!board || board.archived || !canEditBoard) return;
    if (openTaskId) closeTask();
    setComposerStatus(status ?? firstOpenColumn?.slug ?? 'planned');
  };

  const openNewTask = () => {
    openComposer(firstOpenColumn?.slug ?? defaultStatus);
  };

  const focusTask = (id: string) => {
    lastFocusedId.current = id;
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-task-id="${CSS.escape(id)}"] [data-task-open]`,
      );
      element?.focus({ preventScroll: false });
    });
  };

  const focusedTask = (): Task | null => {
    const active = document.activeElement as HTMLElement | null;
    const id =
      active?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ??
      lastFocusedId.current;
    return tasks.find((task) => task.id === id) ?? null;
  };

  const visibleTaskNodes = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-task-id] [data-task-open]'),
    ).filter((element) => element.offsetParent !== null);

  const moveFocus = (direction: 1 | -1) => {
    const nodes = visibleTaskNodes();
    if (nodes.length === 0) return false;
    const active = document.activeElement;
    const index = nodes.findIndex((node) => node === active || node.closest('[data-task-id]')?.contains(active));
    const next =
      index === -1
        ? direction > 0
          ? nodes[0]
          : nodes[nodes.length - 1]
        : nodes[Math.max(0, Math.min(nodes.length - 1, index + direction))];
    next?.focus();
    const id = next?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
    if (id) lastFocusedId.current = id;
    return Boolean(next);
  };

  const focusFirstOrLast = (which: 'first' | 'last') => {
    const nodes = visibleTaskNodes();
    if (nodes.length === 0) return false;
    const node = which === 'first' ? nodes[0] : nodes[nodes.length - 1];
    node?.focus();
    const id = node?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId;
    if (id) lastFocusedId.current = id;
    return Boolean(node);
  };

  const toggleSelected = (task: Task, event?: React.MouseEvent<HTMLElement>) => {
    if (!canEditBoard) return;
    const shift = Boolean(event?.shiftKey);
    setSelectionMode(true);

    if (shift && lastSelectedId) {
      const ids = viewTasks.map((entry) => entry.id);
      const from = ids.indexOf(lastSelectedId);
      const to = ids.indexOf(task.id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelection((current) => {
          const next = new Set(current);
          for (const id of ids.slice(start, end + 1)) next.add(id);
          return next;
        });
        setLastSelectedId(task.id);
        return;
      }
    }

    setSelection((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    setLastSelectedId(task.id);
  };

  const selectAllVisible = () => {
    if (!canEditBoard) return;
    setSelectionMode(true);
    setSelection(new Set(viewTasks.map((task) => task.id)));
  };

  const openTaskMenu = (
    task: Task,
    anchor: DOMRect,
    section?: 'status' | 'priority' | 'assignee' | 'due' | 'labels',
  ) => {
    if (!canEditBoard) {
      openTask(task);
      return;
    }
    lastFocusedId.current = task.id;
    setMenuState({ taskId: task.id, anchor, section });
  };

  const openFocusedPicker = (field: 'status' | 'priority' | 'assignee' | 'due' | 'labels') => {
    const task = focusedTask();
    if (!task) return;
    const element = document.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(task.id)}"] [data-task-open]`,
    );
    if (!element) return;
    openTaskMenu(task, element.getBoundingClientRect(), field);
  };

  const handleCreateTask = async (draft: TaskDraft) => {
    const created = await addTask(draft);
    showToast(`“${created.title || 'Untitled task'}” added`, 'success');
  };

  const handleUpdateFromMenu = async (task: Task, patch: UpdateTaskData) => {
    try {
      await editTask(task.id, patch);
    } catch (updateError) {
      const message =
        updateError instanceof Error ? updateError.message : 'Could not update the task.';
      showToast(message, 'error');
      announce(message);
      throw updateError;
    }
  };

  const handleDuplicate = async (task: Task) => {
    if (!board) return;
    try {
      const created = await duplicateTask(task, board.id);
      addExistingTask(created);
      showToast('Task duplicated to Planned', 'success');
    } catch (duplicateError) {
      const message =
        duplicateError instanceof Error ? duplicateError.message : 'Could not duplicate the task.';
      showToast(message, 'error');
      announce(message);
      throw duplicateError;
    }
  };

  const runBulk = async (
    ids: string[],
    patchFor: (task: Task) => UpdateTaskData,
    successMessage: (count: number) => string,
  ) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    const selected = tasks.filter((task) => ids.includes(task.id));
    const results = await Promise.allSettled(
      selected.map((task) => editTask(task.id, patchFor(task))),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    const succeeded = results.length - failed;

    if (failed > 0) {
      const message = `${successMessage(succeeded)} ${failed} ${failed === 1 ? 'task' : 'tasks'} could not be updated. Reloading.`;
      showToast(message, 'error');
      announce(message);
      await load();
      setBulkBusy(false);
      return;
    }

    showToast(successMessage(succeeded), 'success');
    setBulkBusy(false);
    clearSelection();
  };

  const bulkStatus = (status: string) =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ status }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} moved.`,
    );

  const bulkPriority = (priority: TaskPriority | '') =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ priority }),
      (count) => `Priority updated on ${count} ${count === 1 ? 'task' : 'tasks'}.`,
    );

  const bulkAssignee = (assignee: string) =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ assignee }),
      (count) => `Assignee updated on ${count} ${count === 1 ? 'task' : 'tasks'}.`,
    );

  const bulkDue = (patch: { start_date?: string; due_date: string }) =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => patch,
      (count) => `Dates updated on ${count} ${count === 1 ? 'task' : 'tasks'}.`,
    );

  const bulkToggleLabel = (label: string) => {
    const everyHas = selectedTasks.every((task) => task.labels.includes(label));
    void runBulk(
      selectedTasks.map((task) => task.id),
      (task) => ({
        labels: everyHas
          ? task.labels.filter((entry) => entry !== label)
          : Array.from(new Set([...task.labels, label])),
      }),
      (count) =>
        `${everyHas ? 'Removed' : 'Added'} “${label}” on ${count} ${count === 1 ? 'task' : 'tasks'}.`,
    );
  };

  const bulkArchive = () =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ status: 'archived' }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} archived.`,
    );

  const bulkRestore = () => {
    const target = firstOpenColumn?.slug ?? 'planned';
    return runBulk(
      selectedTasks.filter((task) => task.status === 'archived').map((task) => task.id),
      () => ({ status: target }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} restored.`,
    );
  };

  const bulkPlanned = () =>
    runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ status: 'planned' }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} moved to Planned.`,
    );

  const bulkBoard = () => {
    if (!firstOpenColumn) return;
    return runBulk(
      selectedTasks.map((task) => task.id),
      () => ({ status: firstOpenColumn.slug }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} moved to ${firstOpenColumn.name}.`,
    );
  };

  const archiveLane = (laneTasks: Task[]) => {
    if (laneTasks.length === 0) return;
    void runBulk(
      laneTasks.map((task) => task.id),
      () => ({ status: 'archived' }),
      (count) => `${count} ${count === 1 ? 'task' : 'tasks'} archived.`,
    );
  };

  const moveAllPlanned = async () => {
    if (!canEditBoard || !firstOpenColumn) return;
    const planned = grouped.planned ?? [];
    if (planned.length === 0) return;
    setMovingAll(true);
    const results = await Promise.allSettled(
      planned.map((task) => editTask(task.id, { status: firstOpenColumn.slug })),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      const message = `${planned.length - failed} moved · ${failed} could not move. Reloading.`;
      showToast(message, 'error');
      announce(message);
      await load();
    } else {
      showToast(
        `${planned.length} ${planned.length === 1 ? 'task' : 'tasks'} moved to ${firstOpenColumn.name}`,
        'success',
      );
      clearSelection();
    }
    setMovingAll(false);
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setDeleteBusy(true);
    try {
      if (deleteState.kind === 'single') {
        await removeTask(deleteState.task.id);
        if (openTaskId === deleteState.task.id) closeTask();
        showToast('Task deleted', 'info');
      } else {
        const ids = deleteState.ids;
        const results = await Promise.allSettled(ids.map((id) => removeTask(id)));
        const failed = results.filter((result) => result.status === 'rejected').length;
        if (failed > 0) {
          const message = `${ids.length - failed} deleted · ${failed} could not be deleted. Reloading.`;
          showToast(message, 'error');
          announce(message);
          await load();
        } else {
          showToast(`${ids.length} ${ids.length === 1 ? 'task' : 'tasks'} deleted`, 'info');
        }
        clearSelection();
      }
      setDeleteState(null);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : 'Could not delete the task.';
      showToast(message, 'error');
      announce(message);
      setDeleteState(null);
      await load();
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleImport = async (document: Document) => {
    if (!board) return;
    const created = await createTaskFromDocument(
      document,
      board.id,
      firstOpenColumn?.slug ?? 'planned',
    );
    created.expand = { document };
    addExistingTask(created);
    showToast(`“${document.title || 'Untitled'}” added to ${board.name}`, 'success');
  };

  const handleRestoreBoard = async () => {
    if (!board) return;
    setRestoring(true);
    try {
      const restored = await restoreBoard(board.id);
      setBoard(restored);
      showToast('Board restored', 'success');
    } catch (restoreError) {
      showToast(
        restoreError instanceof Error ? restoreError.message : 'Could not restore the board.',
        'error',
      );
    } finally {
      setRestoring(false);
    }
  };

  const resetPreferences = () => {
    setPreferences((current) => ({
      ...DEFAULT_BOARD_PREFERENCES,
      view: current.view,
    }));
    showToast('Board view preferences reset', 'info');
  };

  const nudgeTask = async (task: Task, direction: 'left' | 'right' | 'up' | 'down') => {
    if (!canEditBoard) return;
    if (direction === 'left' || direction === 'right') {
      const index = columns.findIndex((column) => column.slug === task.status);
      const next = columns[index + (direction === 'left' ? -1 : 1)];
      if (!next) return;
      try {
        await moveTask(task.id, next.slug);
        focusTask(task.id);
      } catch {
        announce('The task could not move.');
      }
      return;
    }

    const list = byStatus[task.status] ?? [];
    const index = list.findIndex((entry) => entry.id === task.id);
    const other = list[index + (direction === 'up' ? -1 : 1)];
    if (!other) return;
    try {
      await Promise.all([
        editTask(task.id, { board_order: other.board_order }),
        editTask(other.id, { board_order: task.board_order }),
      ]);
      focusTask(task.id);
    } catch {
      announce('The task could not be reordered.');
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (isInOverlay(target)) return;

      const typing = isTypingTarget(target);
      const key = event.key;
      const lower = key.toLowerCase();

      if (event.altKey && !typing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
        const task = focusedTask();
        if (!task) return;
        event.preventDefault();
        void nudgeTask(
          task,
          key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : key === 'ArrowUp' ? 'up' : 'down',
        );
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lower === 'a' && !typing) {
        event.preventDefault();
        selectAllVisible();
        return;
      }

      if (event.metaKey || event.ctrlKey) return;

      if (typing) {
        if (key === 'Escape') {
          if (target === searchRef.current) {
            setQuery('');
            clearSelection();
          }
          (target as HTMLElement).blur();
        }
        return;
      }

      if (key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (key === 'Escape') {
        if (composerStatus) {
          event.preventDefault();
          setComposerStatus(null);
        } else if (selection.size > 0 || selectionMode) {
          event.preventDefault();
          clearSelection();
        } else if (query) {
          event.preventDefault();
          setQuery('');
        }
        return;
      }
      if (lower === 'c' && !event.shiftKey) {
        event.preventDefault();
        openNewTask();
        return;
      }
      if (lower === 'j' || lower === 'k') {
        if (!moveFocus(lower === 'j' ? 1 : -1)) return;
        event.preventDefault();
        return;
      }
      if (key === 'Home') {
        if (!focusFirstOrLast('first')) return;
        event.preventDefault();
        return;
      }
      if (key === 'End') {
        if (!focusFirstOrLast('last')) return;
        event.preventDefault();
        return;
      }
      if (key === 'Enter' || key === ' ') {
        const active = document.activeElement as HTMLElement | null;
        if (!active?.matches('[data-task-open]')) return;
        const task = focusedTask();
        if (!task) return;
        event.preventDefault();
        openTask(task);
        return;
      }
      if (lower === 'x') {
        const task = focusedTask();
        if (!task) return;
        event.preventDefault();
        toggleSelected(task);
        return;
      }
      if (event.shiftKey && lower === 'd') {
        event.preventDefault();
        openFocusedPicker('due');
        return;
      }
      if (lower === 's') {
        event.preventDefault();
        openFocusedPicker('status');
        return;
      }
      if (lower === 'p') {
        event.preventDefault();
        openFocusedPicker('priority');
        return;
      }
      if (lower === 'a') {
        event.preventDefault();
        openFocusedPicker('assignee');
        return;
      }
      if (lower === 'l') {
        event.preventDefault();
        openFocusedPicker('labels');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const skeletonColumns: Array<{ id?: string }> =
    columns.length > 0
      ? columns
      : Array.from({ length: 4 }, (_, index) => ({ id: `loading-${index}` }));

  const renderSkeleton = () => (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden" aria-label="Loading board">
      {skeletonColumns.map((column, index) => (
        <div
          key={column?.id || index}
          className="flex min-w-[248px] flex-1 flex-col rounded-panel border border-line bg-surface-sunken/50 p-2.5"
        >
          <div className="mb-3 flex h-9 items-center gap-2 px-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-surface-raised" />
            <span className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
          </div>
          {[0, 1].map((item) => (
            <div key={item} className="mb-2 space-y-2 rounded-[7px] border border-line bg-surface p-3">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-raised" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface-raised" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const showOnboarding =
    Boolean(board) &&
    !board?.archived &&
    canEditBoard &&
    tasks.length === 0 &&
    !isLoading &&
    !filtering &&
    !preferences.onboardingDismissed;

  const boardReady =
    Boolean(board) &&
    !board?.archived &&
    !isBoardLoading &&
    !isLoading &&
    !loadingColumns &&
    !error;

  return (
    <PageShell
      width="wide"
      scroll={editOpen ? 'page' : 'content'}
      className="board-page"
      contentClassName="desktop-page-content-enter board-page-content"
    >
      <PageHeader
        back={{ label: 'Timeline', onClick: () => navigate('/timeline') }}
        className={cn('board-page-header', !editOpen && boardReady && '!mb-0')}
        title={
          board ? (
            <span className="inline-flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-surface-sunken text-ink-muted sm:h-9 sm:w-9">
                {board.icon && board.icon.length <= 4 ? (
                  <span className="text-[17px]" aria-hidden="true">
                    {board.icon}
                  </span>
                ) : (
                  <ViewColumnsIcon className="h-4 w-4 sm:h-[1.15rem] sm:w-[1.15rem]" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 break-words">{board.name}</span>
              {board.is_private && (
                <Badge tone="warning" className="shrink-0">
                  <LockClosedIcon className="h-3 w-3" aria-hidden="true" />
                  Private
                </Badge>
              )}
              {board.is_public && (
                <Badge tone="success" className="shrink-0">
                  <ShareIcon className="h-3 w-3" aria-hidden="true" />
                  Public
                </Badge>
              )}
              <Badge tone="outline" className="hidden shrink-0 sm:inline-flex">
                {user?.id && user.id === board.author ? 'Owner' : 'Shared'}
              </Badge>
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
                <span className="text-[13px] font-medium tabular-nums text-ink">{counts.open}</span>
                open
              </span>
              <span aria-hidden="true" className="text-line-strong">·</span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{counts.done}</span>
                done
              </span>
              <span aria-hidden="true" className="text-line-strong">·</span>
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium tabular-nums text-ink">{columns.length}</span>
                {columns.length === 1 ? 'column' : 'columns'}
              </span>
              {(isLoading || loadingColumns) && <span>Loading tasks…</span>}
            </>
          ) : undefined
        }
        actions={
          board && !board.archived && !editOpen ? (
            <>
              {canEditBoard && (
                <Button
                  variant="primary"
                  icon={<PlusIcon />}
                  className="h-11 sm:h-9"
                  aria-label="New task"
                  onClick={openNewTask}
                >
                  <span className="hidden sm:inline">New task</span>
                  <span className="sm:hidden">New</span>
                </Button>
              )}
              {isBoardOwner && (
                isMobile ? (
                  <ShareButton
                    targetType="board"
                    targetId={board.id}
                    targetTitle={board.name}
                    folderId={board.folder}
                    label="Share board"
                    iconOnly
                    className="h-11 w-11"
                    onChanged={() => setReloadToken((token) => token + 1)}
                  />
                ) : (
                  <ShareButton
                    targetType="board"
                    targetId={board.id}
                    targetTitle={board.name}
                    folderId={board.folder}
                    label="Share"
                    variant="secondary"
                    className="h-9"
                    onChanged={() => setReloadToken((token) => token + 1)}
                  />
                )
              )}
              {isBoardOwner && (
                <IconButton
                  ref={editButtonRef}
                  label="Board settings"
                  variant="secondary"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                  aria-expanded={editOpen}
                  onClick={() => {
                    setEditNewBoard(false);
                    setEditAutoFocus(true);
                    setEditOpen(true);
                  }}
                >
                  <Cog6ToothIcon />
                </IconButton>
              )}
              <IconButton
                label="More board actions"
                variant="secondary"
                className="h-11 w-11 sm:h-9 sm:w-9"
                aria-expanded={moreAnchor !== null}
                onClick={(event) => setMoreAnchor(event.currentTarget.getBoundingClientRect())}
              >
                <EllipsisHorizontalIcon />
              </IconButton>
            </>
          ) : undefined
        }
      />

      {board && !board.archived && isBoardOwner && (
        <BoardSettingsPanel
          board={board}
          open={editOpen}
          autoFocus={editAutoFocus}
          newBoard={editNewBoard}
          taskCount={isLoading ? undefined : tasks.length}
          columns={columns}
          taskCounts={taskCountsByStatus}
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
            void reloadColumns();
            window.requestAnimationFrame(() => editButtonRef.current?.focus());
            showToast(editNewBoard ? 'Board created' : 'Board saved', 'success');
          }}
          onColumnsChanged={reloadColumns}
          onArchived={() => {
            setEditOpen(false);
            showToast('Board archived', 'info');
            navigate('/timeline');
          }}
        />
      )}

      {!editOpen &&
        (notFound ? (
          <EmptyState
            title="That board is not here"
            description="It may have been deleted, or it belongs to another account."
            action={
              <Button variant="secondary" icon={<ChevronLeftIcon />} onClick={() => navigate('/timeline')}>
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
                  loading={restoring}
                  onClick={() => void handleRestoreBoard()}
                >
                  Restore
                </Button>
                <Button variant="ghost" onClick={() => navigate('/timeline')}>
                  Back to timeline
                </Button>
              </>
            }
          />
        ) : isBoardLoading || isLoading || loadingColumns ? (
          renderSkeleton()
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
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <BoardToolbar
              view={view}
              onViewChange={setView}
              query={query}
              onQueryChange={(next) => {
                setQuery(next);
                clearSelection();
              }}
              searchRef={searchRef}
              filters={preferences.filters}
              columns={columns}
              members={members}
              labels={boardLabels}
              sort={preferences.sort}
              direction={preferences.sortDirection}
              display={preferences.display}
              resultCount={viewTasks.length}
              totalCount={viewTotal}
              dragEnabled={dragEnabled}
              selectionMode={selectionMode}
              canSelect={canEditBoard}
              onToggleSelectionMode={() => {
                if (!canEditBoard) return;
                if (selectionMode) clearSelection();
                else setSelectionMode(true);
              }}
              onFiltersChange={updateFilters}
              onClearFilters={clearFilters}
              onClearAll={clearFilters}
              onSortChange={(sort) => {
                setPreferences((current) => ({ ...current, sort }));
                clearSelection();
              }}
              onDirectionChange={(sortDirection) => {
                setPreferences((current) => ({ ...current, sortDirection }));
                clearSelection();
              }}
              onDisplayChange={(display) =>
                setPreferences((current) => ({ ...current, display }))
              }
              onResetToManual={() => {
                setPreferences((current) => ({
                  ...current,
                  sort: 'manual',
                  filters: DEFAULT_BOARD_PREFERENCES.filters,
                }));
                setQuery('');
                clearSelection();
              }}
              onRemoveFilter={(subject: FilterSubject, value: string) => {
                setPreferences((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    [subject]:
                      subject === 'due'
                        ? current.filters.due.filter((entry) => entry !== value)
                        : current.filters[subject].filter((entry) => entry !== value),
                  },
                }));
                clearSelection();
              }}
              onClearSearch={() => {
                setQuery('');
                clearSelection();
              }}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />

            <div className="board-page-hint mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
              {view === 'board' && (
                <>
                  <span className="md:hidden">Swipe between columns · Tap a card to open.</span>
                  <span className="hidden md:inline xl:hidden">Scroll between columns · Drag to reorder.</span>
                  <span className="hidden xl:inline">Drag between columns · Alt + arrows move a focused card.</span>
                </>
              )}
              {view === 'list' && <span>Grouped by column · Click a cell to change a property.</span>}
              {view === 'backlog' && <span>Drag rows between Planned and Archived.</span>}
              {view === 'calendar' && <span>Month grid · {isMobile ? 'agenda below' : 'unscheduled tasks on the right'}.</span>}
              {view === 'gantt' && <span>91-day timeline · Drag bars to move dates, or use arrow keys.</span>}
              {!dragEnabled && view === 'board' && (
                <span className="text-ink-muted">Drag is paused while filters or another sort are active.</span>
              )}
            </div>

            {showOnboarding && (
              <div className="board-onboarding mb-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-ink">This board is empty</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">
                    Add the first task to a lane, or bring a note in as a task. Columns are editable in board settings.
                  </p>
                </div>
                <div className="board-onboarding-actions flex shrink-0 items-center gap-1.5">
                  <Button variant="secondary" size="sm" icon={<DocumentPlusIcon />} onClick={() => setImportOpen(true)}>
                    Import note
                  </Button>
                  <IconButton
                    label="Dismiss empty-board tip"
                    size="sm"
                    onClick={() =>
                      setPreferences((current) => ({ ...current, onboardingDismissed: true }))
                    }
                  >
                    <XMarkIcon />
                  </IconButton>
                </div>
              </div>
            )}

            {view === 'board' && (
              <BoardLanes
                columns={columns}
                grouped={grouped}
                display={preferences.display}
                labels={boardLabels}
                members={members}
                selection={selection}
                selectionMode={selectionMode}
                draggingId={draggingId}
                dropTarget={dropTarget}
                canDrag={dragEnabled}
                canEdit={canEditBoard}
                composerStatus={composerStatus}
                filtering={filtering}
                onOpenTask={openTask}
                onSelectTask={toggleSelected}
                onOpenMenu={openTaskMenu}
                onQuickPick={(task, field, anchor) => openTaskMenu(task, anchor, field)}
                onOpenNote={(documentId) => navigate(`/document/${documentId}`)}
                onStartDrag={startDrag}
                onEndDrag={endDrag}
                onDragOver={dragOver}
                onDrop={(status, index) => void drop(status, index)}
                onOpenComposer={openComposer}
                onCancelComposer={() => setComposerStatus(null)}
                onCreateTask={handleCreateTask}
                onArchiveLane={archiveLane}
                onClearFilters={clearFilters}
              />
            )}

            {view === 'list' && (
              <ListView
                columns={columns}
                grouped={grouped}
                display={preferences.display}
                labels={boardLabels}
                members={members}
                selection={selection}
                selectionMode={selectionMode}
                canEdit={canEditBoard}
                collapsed={new Set(preferences.collapsedListGroups)}
                onToggleGroup={(status) =>
                  setPreferences((current) => ({
                    ...current,
                    collapsedListGroups: current.collapsedListGroups.includes(status)
                      ? current.collapsedListGroups.filter((entry) => entry !== status)
                      : [...current.collapsedListGroups, status],
                  }))
                }
                filtering={filtering}
                composerStatus={composerStatus}
                onOpenTask={openTask}
                onSelectTask={toggleSelected}
                onOpenMenu={openTaskMenu}
                onQuickPick={(task, field, anchor) => openTaskMenu(task, anchor, field)}
                onOpenNote={(documentId) => navigate(`/document/${documentId}`)}
                onOpenComposer={openInlineComposer}
                onCancelComposer={() => setComposerStatus(null)}
                onCreateTask={handleCreateTask}
                onClearFilters={clearFilters}
              />
            )}

            {view === 'backlog' && (
              <BacklogView
                columns={columns}
                planned={grouped.planned ?? []}
                archived={grouped.archived ?? []}
                display={preferences.display}
                labels={boardLabels}
                members={members}
                selection={selection}
                selectionMode={selectionMode}
                filtering={filtering}
                canEdit={canEditBoard}
                composerStatus={composerStatus}
                movingAll={movingAll}
                onOpenTask={openTask}
                onSelectTask={toggleSelected}
                onOpenMenu={openTaskMenu}
                onQuickPick={(task, field, anchor) => openTaskMenu(task, anchor, field)}
                onOpenNote={(documentId) => navigate(`/document/${documentId}`)}
                onMoveTask={(task, status) => {
                  if (!canEditBoard) return;
                  if (task.status !== status) {
                    void editTask(task.id, { status }).catch((moveError: unknown) => {
                      const message =
                        moveError instanceof Error
                          ? moveError.message
                          : 'Could not move the task.';
                      showToast(message, 'error');
                      announce(message);
                    });
                  }
                }}
                onMovePlannedToBoard={() => void moveAllPlanned()}
                onOpenComposer={openInlineComposer}
                onCancelComposer={() => setComposerStatus(null)}
                onCreateTask={handleCreateTask}
                onClearFilters={clearFilters}
              />
            )}

            {view === 'calendar' && (
              <CalendarView
                tasks={displayTasks}
                columns={columns}
                onOpenTask={openTask}
              />
            )}

            {view === 'gantt' && (
              <GanttView
                tasks={displayTasks}
                columns={columns}
                canEdit={canEditBoard}
                onOpenTask={openTask}
                onUpdateDates={async (task, patch) => {
                  try {
                    await editTask(task.id, patch);
                  } catch (updateError) {
                    const message =
                      updateError instanceof Error
                        ? updateError.message
                        : 'Could not move the task dates.';
                    showToast(message, 'error');
                    announce(message);
                    throw updateError;
                  }
                }}
              />
            )}

            <p aria-live="polite" className="sr-only">
              {liveMessage}
            </p>
          </div>
        ))}

      {canEditBoard && (
        <BoardBulkBar
          selectedTasks={selectedTasks}
          columns={columns}
          members={members}
          labels={boardLabels}
          busy={bulkBusy}
          onClear={clearSelection}
          onStatus={(status) => void bulkStatus(status)}
          onPriority={(priority) => void bulkPriority(priority)}
          onAssignee={(assignee) => void bulkAssignee(assignee)}
          onToggleLabel={bulkToggleLabel}
          onDue={(patch) => void bulkDue(patch)}
          onPlanned={() => void bulkPlanned()}
          onBoard={() => void bulkBoard()}
          onArchive={() => void bulkArchive()}
          onRestore={() => void bulkRestore()}
          onDelete={() => setDeleteState({ kind: 'bulk', ids: [...selection] })}
        />
      )}

      <TaskContextMenu
        open={menuState !== null && menuTask !== null}
        task={menuTask}
        anchor={menuState?.anchor ?? null}
        initialSection={menuState?.section ?? null}
        columns={columns}
        members={members}
        labels={boardLabels}
        onClose={() => setMenuState(null)}
        onUpdate={handleUpdateFromMenu}
        onDuplicate={handleDuplicate}
        onDelete={(task) => {
          setMenuState(null);
          setDeleteState({ kind: 'single', task });
        }}
        onCreateLabel={createLabel}
      />

      <TaskPanel
        open={Boolean(openTaskId) && Boolean(board) && !board?.archived}
        taskId={openTaskId}
        boardId={board?.id ?? ''}
        columns={columns}
        canEdit={canEditBoard}
        canDelete={canEditBoard}
        canComment={canCommentBoard}
        onClose={closeTask}
        onChanged={() => void load()}
        onOpenFullPage={(id) => {
          const url = `/board/${board?.id ?? boardId}?view=${view}&task=${encodeURIComponent(id)}`;
          const opened = window.open(url, '_blank', 'noopener,noreferrer');
          if (!opened) {
            setSearchParams((current) => {
              const params = new URLSearchParams(current);
              params.set('task', id);
              return params;
            });
          }
        }}
      />

      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        description="These work anywhere on a board unless you are typing."
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setShortcutsOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-5">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                {group.title}
              </h3>
              <dl className="mt-2 space-y-1.5">
                {group.rows.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-4">
                    <dt className="text-[12.5px] text-ink-secondary">{label}</dt>
                    <dd>
                      <kbd className="rounded-[4px] border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteState !== null}
        title={
          deleteState?.kind === 'bulk'
            ? `Delete ${deleteState.ids.length} ${deleteState.ids.length === 1 ? 'task' : 'tasks'}?`
            : `Delete “${deleteState?.task.title || 'Untitled task'}”?`
        }
        description={
          deleteState?.kind === 'bulk'
            ? 'This removes the selected tasks from the board. Notes stay untouched.'
            : 'The task is removed from the board. The note it came from stays untouched.'
        }
        confirmLabel="Delete task"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleteBusy) setDeleteState(null);
        }}
      />

      <MenuSurface
        open={moreAnchor !== null}
        onClose={() => setMoreAnchor(null)}
        position={menuPositionFromRect(moreAnchor ?? new DOMRect(16, 16, 0, 0), {
          width: 220,
          height: 300,
        })}
        ariaLabel="Board actions"
      >
        {canEditBoard && (
          <MenuItem
            icon={<DocumentPlusIcon />}
            label="Import note"
            onClick={() => {
              setMoreAnchor(null);
              setImportOpen(true);
            }}
          />
        )}
        {isBoardOwner && (
          <MenuItem
            icon={<Cog6ToothIcon />}
            label="Board settings"
            onClick={() => {
              setMoreAnchor(null);
              setEditNewBoard(false);
              setEditAutoFocus(true);
              setEditOpen(true);
            }}
          />
        )}
        <MenuItem
          icon={<QuestionMarkCircleIcon />}
          label="Keyboard shortcuts"
          hint="?"
          onClick={() => {
            setMoreAnchor(null);
            setShortcutsOpen(true);
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<ArrowPathIcon />}
          label="Reset view preferences"
          onClick={() => {
            setMoreAnchor(null);
            resetPreferences();
          }}
        />
        {isBoardOwner && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<ArchiveBoxIcon />}
              label="Archive board"
              onClick={() => {
                setMoreAnchor(null);
                setEditNewBoard(false);
                setEditAutoFocus(false);
                setEditOpen(true);
              }}
            />
          </>
        )}
      </MenuSurface>

      {board && !board.archived && canEditBoard && (
        <ImportNotePanel
          open={importOpen}
          boardId={board.id}
          boardName={board.name}
          onClose={() => setImportOpen(false)}
          existingDocumentIds={
            new Set(tasks.map((task) => task.document).filter((id): id is string => Boolean(id)))
          }
          onImport={handleImport}
        />
      )}
    </PageShell>
  );
}

export default BoardPage;
