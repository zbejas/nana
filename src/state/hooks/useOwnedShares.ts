import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useAuth } from '../../lib/auth';
import { createLogger } from '../../lib/logger';
import { pb } from '../../lib/pocketbase';
import type { ShareTargetType } from '../../lib/sharing';
import {
  ownedShareTargetsFromShares,
  type OwnedShareRecord,
} from '../../lib/sharing/targets';
import {
  EMPTY_OWNED_SHARE_TARGETS,
  ownedShareTargetsAtom,
  sharingRealtimeTickAtom,
} from '../sharing';

const logger = createLogger('OwnedShares');

/**
 * Loads the current account's direct user shares for the workspace indicators.
 * Only `shared_by = me` rows are requested; PocketBase's rule scopes the rest.
 */
export function useOwnedShares() {
  const { user } = useAuth();
  const setTargets = useSetAtom(ownedShareTargetsAtom);
  const tick = useAtomValue(sharingRealtimeTickAtom);
  const bumpTick = useSetAtom(sharingRealtimeTickAtom);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!user?.id) {
      setTargets(EMPTY_OWNED_SHARE_TARGETS);
      return;
    }

    const current = ++sequence.current;
    try {
      const shares = await pb.collection<OwnedShareRecord>('shares').getFullList({
        filter: pb.filter('shared_by = {:id}', { id: user.id }),
        fields: 'document,folder,board',
      });
      if (current !== sequence.current) return;
      setTargets(ownedShareTargetsFromShares(shares));
    } catch (error) {
      if (current !== sequence.current) return;
      logger.warn('Failed to load owned shares', error);
    }
  }, [setTargets, user?.id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) bumpTick((value) => value + 1);
      }, 350);
    };

    void pb
      .collection('shares')
      .subscribe('*', schedule)
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch((error) => logger.warn('Share realtime unavailable', error));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [bumpTick, user?.id]);
}

/** True when the current account has shared this record directly with people. */
export function useSharedWithPeople(
  targetType: ShareTargetType,
  targetId: string | undefined,
): boolean {
  const targets = useAtomValue(ownedShareTargetsAtom);
  if (!targetId) return false;
  if (targetType === 'document') return targets.documents.has(targetId);
  if (targetType === 'folder') return targets.folders.has(targetId);
  return targets.boards.has(targetId);
}
