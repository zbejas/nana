import { useCallback, useEffect, useRef, useState } from 'react';
import { listBoardSummaries, subscribeToBoards, type Board, type BoardSummary } from '../../lib/boards';
import { subscribeToTasks } from '../../lib/tasks';
import { useAuth } from '../../lib/auth';

/**
 * Board index data. Boards and tasks both drive it: task changes move the
 * counts, board changes add, rename, archive, or remove a row. Realtime events
 * are debounced into one refresh.
 */
export function useBoardSummaries(includeArchived = false) {
  const { user } = useAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await listBoardSummaries({ includeArchived });
      if (mounted.current) {
        setBoards(next);
      }
    } catch (loadError) {
      if (mounted.current) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load your boards.');
      }
    } finally {
      if (mounted.current) {
        setIsLoading(false);
      }
    }
  }, [includeArchived]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void load();
  }, [load]);

  const removeBoardLocally = useCallback((id: string) => {
    setBoards((current) => current.filter((board) => board.id !== id));
  }, []);

  const replaceBoardLocally = useCallback((updated: Board) => {
    setBoards((current) =>
      current.map((board) =>
        board.id === updated.id
          ? { ...board, ...updated, openCount: board.openCount, doneCount: board.doneCount, total: board.total, lastActivity: board.lastActivity }
          : board,
      ),
    );
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setBoards([]);
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;

    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(), 450);
    };

    const unsubscribeBoards = subscribeToBoards(scheduleRefresh);
    const unsubscribeTasks = subscribeToTasks(user.id, scheduleRefresh);

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribeBoards();
      unsubscribeTasks();
    };
  }, [user?.id, load]);

  return { boards, isLoading, error, retry, removeBoardLocally, replaceBoardLocally };
}
