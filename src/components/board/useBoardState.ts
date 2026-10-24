import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTask,
  deleteTask,
  listTasks,
  persistTaskPositions,
  subscribeToTasks,
  updateTask,
  type Task,
  type TaskDraft,
  type TaskPosition,
  type TaskStatus,
  type UpdateTaskData,
} from '../../lib/tasks';
import { useAuth } from '../../lib/auth';
import { useToasts } from '../../state/hooks';

export interface DropTarget {
  status: TaskStatus;
  index: number;
}

export function useBoardState(boardId?: string) {
  const { user } = useAuth();
  const { showToast } = useToasts();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(boardId));
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const skipRealtimeRefresh = useRef(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (skipRealtimeRefresh.current) return;

    if (!boardId) {
      loadSequence.current += 1;
      setTasks([]);
      setIsLoading(false);
      return;
    }

    const sequence = ++loadSequence.current;

    try {
      setError(null);
      const next = await listTasks(boardId);
      if (sequence !== loadSequence.current) return;
      setTasks(next);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not load the board.');
    } finally {
      if (sequence === loadSequence.current) {
        setIsLoading(false);
      }
    }
  }, [boardId]);

  useEffect(() => {
    skipRealtimeRefresh.current = false;
    setDraggingId(null);
    setDropTarget(null);
    setError(null);
    setTasks([]);
    setIsLoading(Boolean(boardId));

    if (boardId) {
      void load();
    } else {
      loadSequence.current += 1;
    }
  }, [boardId, load]);

  useEffect(() => {
    if (!user?.id || !boardId) return;

    let refreshTimer: number | undefined;
    const unsubscribe = subscribeToTasks(
      user.id,
      () => {
        if (skipRealtimeRefresh.current) return;
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void load(), 450);
      },
      boardId
    );

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [user?.id, boardId, load]);

  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      backlog: [],
      next: [],
      progress: [],
      done: [],
    };

    for (const task of tasks) {
      groups[task.status].push(task);
    }

    for (const status of Object.keys(groups) as TaskStatus[]) {
      groups[status].sort((a, b) => a.board_order - b.board_order || a.created.localeCompare(b.created));
    }

    return groups;
  }, [tasks]);

  const nextOrder = useCallback(
    (status: TaskStatus) => (byStatus[status].at(-1)?.board_order ?? -1) + 1,
    [byStatus]
  );

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void load();
  }, [load]);

  const addTask = useCallback(
    async (data: TaskDraft) => {
      if (!boardId) {
        throw new Error('Choose a board first.');
      }

      const created = await createTask({
        ...data,
        board: boardId,
        board_order: nextOrder(data.status),
      });
      setTasks((current) => [...current, created]);
      return created;
    },
    [boardId, nextOrder]
  );

  const addExistingTask = useCallback((task: Task) => {
    setTasks((current) => [...current, task]);
  }, []);

  const editTask = useCallback(
    async (id: string, data: UpdateTaskData) => {
      if (data.status && data.status !== tasks.find((task) => task.id === id)?.status) {
        data = { ...data, board_order: nextOrder(data.status) };
      }

      const updated = await updateTask(id, data);
      setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...updated } : task)));
      return updated;
    },
    [nextOrder, tasks]
  );

  const removeTask = useCallback(async (id: string) => {
    await deleteTask(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  }, []);

  const startDrag = useCallback((task: Task) => {
    setDraggingId(task.id);
  }, []);

  const endDrag = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const dragOver = useCallback((status: TaskStatus, index: number) => {
    setDropTarget((current) =>
      current?.status === status && current.index === index ? current : { status, index }
    );
  }, []);

  const drop = useCallback(
    async (status: TaskStatus, index: number) => {
      const id = draggingId;
      setDraggingId(null);
      setDropTarget(null);

      if (!id) return;

      const dragged = tasks.find((task) => task.id === id);
      if (!dragged) return;

      const column = byStatus[status].filter((task) => task.id !== id);
      const insertAt = Math.max(0, Math.min(index, column.length));
      column.splice(insertAt, 0, { ...dragged, status });

      const positions: TaskPosition[] = column.map((task, position) => ({
        id: task.id,
        status,
        board_order: position,
      }));

      const previous = tasks;
      const positionById = new Map(positions.map((position) => [position.id, position]));

      setTasks((current) =>
        current.map((task) => {
          const position = positionById.get(task.id);
          return position ? { ...task, status: position.status, board_order: position.board_order } : task;
        })
      );

      skipRealtimeRefresh.current = true;
      try {
        await persistTaskPositions(previous, positions);
      } catch {
        showToast('Could not move the task. Reloading the board.', 'error');
        skipRealtimeRefresh.current = false;
        await load();
      } finally {
        window.setTimeout(() => {
          skipRealtimeRefresh.current = false;
        }, 600);
      }
    },
    [byStatus, draggingId, load, showToast, tasks]
  );

  const moveTask = useCallback(
    async (id: string, status: TaskStatus) => {
      await editTask(id, { status });
    },
    [editTask]
  );

  return {
    tasks,
    byStatus,
    isLoading,
    error,
    draggingId,
    dropTarget,
    load,
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
  };
}
