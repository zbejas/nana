import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTask,
  deleteTask,
  listTasks,
  persistTaskPositions,
  subscribeToTasks,
  updateTask,
  type CreateTaskData,
  type Task,
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

export function useBoardState() {
  const { user } = useAuth();
  const { showToast } = useToasts();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragOrigin = useRef<DropTarget | null>(null);
  const skipRealtimeRefresh = useRef(false);

  const load = useCallback(async () => {
    if (skipRealtimeRefresh.current) return;

    try {
      setError(null);
      const next = await listTasks();
      setTasks(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the board.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;

    let refreshTimer: number | undefined;
    const unsubscribe = subscribeToTasks(user.id, () => {
      if (skipRealtimeRefresh.current) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(), 450);
    });

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [user?.id, load]);

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

  const addTask = useCallback(
    async (data: CreateTaskData) => {
      const created = await createTask({ ...data, board_order: data.board_order ?? nextOrder(data.status) });
      setTasks((current) => [...current, created]);
      return created;
    },
    [nextOrder]
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
    dragOrigin.current = { status: task.status, index: task.board_order };
  }, []);

  const endDrag = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
    dragOrigin.current = null;
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

      if (status === dragged.status && insertAt === dragged.board_order) {
        // persistTaskPositions filters no-op writes, so still call it to keep
        // any reindexed board_order values in sync with the server.
      }

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
