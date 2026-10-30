import { useCallback, useEffect, useState } from 'react';
import { pb } from '../../lib/pocketbase';
import { useAuth } from '../../lib/auth';
import type { BoardLabel } from './board-config';
import { LABEL_COLORS } from './board-config';

export interface BoardMember {
  id: string;
  name: string;
  avatar?: string;
}

interface DirectoryUser {
  id?: string;
  name?: string;
  avatar?: string;
}

interface DirectoryResponse {
  items?: DirectoryUser[];
}

function directoryMember(user: DirectoryUser): BoardMember | null {
  if (!user?.id) return null;
  return {
    id: user.id,
    name: (user.name ?? '').trim() || 'Member',
    ...(user.avatar ? { avatar: user.avatar } : {}),
  };
}

function currentUserMember(user: ReturnType<typeof useAuth>['user']): BoardMember | null {
  if (!user?.id) return null;
  return {
    id: user.id,
    name: (user.name as string | undefined)?.trim() || (user.email as string | undefined) || 'You',
    ...(user.avatar ? { avatar: user.avatar as string } : {}),
  };
}

/**
 * The small people and label catalogs the card menus need. Both are optional:
 * a failed directory request leaves assignment menus usable for the current
 * user, and an empty label catalog falls back to stable hashed dot colours.
 */
export function useBoardMetadata() {
  const { user } = useAuth();
  const self = currentUserMember(user);
  const [members, setMembers] = useState<BoardMember[]>(self ? [self] : []);
  const [labels, setLabels] = useState<BoardLabel[]>([]);

  useEffect(() => {
    let cancelled = false;

    void pb
      .send<DirectoryResponse>('/sharing/users')
      .then((response) => {
        if (cancelled) return;
        const next: BoardMember[] = [];
        if (self) next.push(self);
        for (const item of response.items ?? []) {
          const member = directoryMember(item);
          if (member && !next.some((entry) => entry.id === member.id)) next.push(member);
        }
        setMembers(next);
      })
      .catch(() => {
        // A directory read failure must not hide the board. Keep self only.
      });

    void pb
      .collection<BoardLabel & { author?: string }>('labels')
      .getFullList({ sort: 'name', requestKey: null })
      .then((records) => {
        if (cancelled) return;
        setLabels(
          records
            .filter((record) => record.name)
            .map((record) => ({
              id: record.id,
              name: record.name,
              color: record.color || 'ash',
            })),
        );
      })
      .catch(() => {
        // Label colours are a nice-to-have; card chips still render text.
      });

    return () => {
      cancelled = true;
    };
  }, [self?.id]);

  const createLabel = useCallback(
    async (name: string): Promise<BoardLabel | null> => {
      const clean = name.trim().slice(0, 40);
      if (!clean) return null;

      const existing = labels.find(
        (label) => label.name.toLowerCase() === clean.toLowerCase(),
      );
      if (existing) return existing;

      const color = LABEL_COLORS[labels.length % LABEL_COLORS.length]!.value;
      const record = await pb.collection<BoardLabel>('labels').create<BoardLabel>({
        name: clean,
        color,
      });
      setLabels((current) =>
        [...current, record].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return record;
    },
    [labels],
  );

  return { members, labels, createLabel };
}
