import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useAuth } from '../../lib/auth';
import { createLogger } from '../../lib/logger';
import { pb } from '../../lib/pocketbase';
import { listSharedWithMe, type SharedItem } from '../../lib/sharing';
import {
  sharedWithMeAtom,
  sharedWithMeErrorAtom,
  sharedWithMeLoadingAtom,
  sharingRealtimeTickAtom,
} from '../sharing';

const log = createLogger('SharedWithMe');

/**
 * Loads the "Shared with me" index and keeps it fresh when a share, grant, or
 * shared record changes. PocketBase rules scope both the list and the events;
 * the client never filters by author here.
 */
export function useSharedWithMe() {
  const { user } = useAuth();
  const [items, setItems] = useAtom(sharedWithMeAtom);
  const setLoading = useSetAtom(sharedWithMeLoadingAtom);
  const setError = useSetAtom(sharedWithMeErrorAtom);
  const bumpTick = useSetAtom(sharingRealtimeTickAtom);
  const timer = useRef<number | undefined>(undefined);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }

    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listSharedWithMe({ limit: 100 });
      if (current !== sequence.current) return;
      setItems(page.items);
    } catch (error) {
      if (current !== sequence.current) return;
      log.warn('Failed to load shared records', error);
      setError(error instanceof Error ? error.message : 'Could not load shared records.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [setError, setItems, setLoading, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;

    const schedule = (delay = 350) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        bumpTick((value) => value + 1);
        void load();
      }, delay);
    };

    const unsubs: Array<() => void> = [];
    const subscribe = (collection: string, filter?: string) => {
      void pb
        .collection(collection)
        .subscribe('*', () => schedule(), filter ? { filter } : undefined)
        .then((unsub) => {
          unsubs.push(unsub);
        })
        .catch((error) => log.warn(`${collection} realtime unavailable`, error));
    };

    subscribe('shares');
    subscribe('access_grants');
    subscribe('documents', pb.filter('author != {:id}', { id: user.id }));
    subscribe('boards', pb.filter('author != {:id}', { id: user.id }));
    subscribe('folders', pb.filter('author != {:id}', { id: user.id }));

    return () => {
      window.clearTimeout(timer.current);
      for (const unsubscribe of unsubs) unsubscribe();
    };
  }, [bumpTick, load, user?.id]);

  return { items, load };
}
