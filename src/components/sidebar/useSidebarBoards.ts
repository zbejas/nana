import { useCallback, useEffect, useRef, useState } from 'react';
import { listBoards, subscribeToBoards, type Board } from '../../lib/boards';
import { useAuth } from '../../lib/auth';
import { createLogger } from '../../lib/logger';

const logger = createLogger('SidebarBoards');

/**
 * Active boards for the sidebar library. Notes and boards share the folder
 * tree, so the sidebar needs the same lightweight board set the folder view
 * uses. Board changes (create, rename, move, archive) refresh it; task changes
 * do not affect the tree.
 */
export function useSidebarBoards() {
  const { user } = useAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await listBoards();
      if (mounted.current) {
        setBoards(next);
      }
    } catch (error) {
      logger.debug('Failed to load sidebar boards', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setBoards([]);
      return;
    }

    setBoards([]);
    void load();
  }, [user?.id, load]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let refreshTimer: number | undefined;
    const unsubscribe = subscribeToBoards(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void load(), 450);
    });

    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [user?.id, load]);

  return boards;
}
