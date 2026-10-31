import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { SharedItem } from '../lib/sharing';
import {
  EMPTY_OWNED_SHARE_TARGETS,
  type OwnedShareTargets,
} from '../lib/sharing/targets';

/** Records another user has shared with the current account. */
export const sharedWithMeAtom = atom<SharedItem[]>([]);
export const sharedWithMeLoadingAtom = atom(false);
export const sharedWithMeErrorAtom = atom<string | null>(null);

/** Bumps when a share or grant changes so access-aware surfaces can refetch. */
export const sharingRealtimeTickAtom = atom(0);

/** Direct shares owned by the current account, keyed by target type. */
export const ownedShareTargetsAtom = atom<OwnedShareTargets>(EMPTY_OWNED_SHARE_TARGETS);

export { EMPTY_OWNED_SHARE_TARGETS };
export type { OwnedShareTargets };

/** Local-only read marker for the sidebar's shared badge. */
export const sharedWithMeLastSeenAtom = atomWithStorage<number>(
  'nana-shared-last-seen',
  0,
  undefined,
  { getOnInit: true }
);
