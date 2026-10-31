import { describe, expect, test } from 'bun:test';
import type { SharedItem, SharedTarget, ShareUser } from '../../src/lib/sharing';
import {
  PERMISSION_LABELS,
  PERMISSION_OPTIONS,
  SHARED_TABS,
  filterSharedItems,
  groupSharedItems,
  inviteSearchCopy,
  permissionDescription,
  permissionLabel,
  shareCandidates,
  sharedEmptyCopy,
  sharedItemHref,
  sharedItemTitle,
  sharedTabCounts,
  targetTitle,
} from '../../src/components/sharing/share-copy';

const created = '2026-10-01T10:00:00.000Z';
const updated = '2026-10-30T10:00:00.000Z';

function person(id: string, name: string, email?: string): ShareUser {
  return {
    id,
    collectionName: 'users',
    name,
    avatar: '',
    ...(email ? { email } : {}),
  };
}

function target(type: 'document' | 'folder' | 'board', id: string, title: string): SharedTarget {
  return {
    id,
    ...(type === 'document' ? { title } : { name: title }),
    created,
    updated,
  };
}

function item(
  type: 'document' | 'folder' | 'board',
  id: string,
  title: string,
  options: Partial<SharedItem> = {}
): SharedItem {
  return {
    id: `share-${id}`,
    shareId: `share-${id}`,
    grantId: '',
    type,
    permission: 'view',
    level: 1,
    inherited: false,
    sharedBy: person('owner-1', 'Alex Rivera'),
    target: target(type, id, title),
    ...options,
  };
}

describe('permission labels', () => {
  test('maps every grant level and owner to the shared labels', () => {
    expect(PERMISSION_LABELS).toEqual({
      view: 'Can view',
      comment: 'Can comment',
      edit: 'Can edit',
      owner: 'Owner',
    });
    expect(permissionLabel('view')).toBe('Can view');
    expect(permissionLabel('comment')).toBe('Can comment');
    expect(permissionLabel('edit')).toBe('Can edit');
    expect(permissionLabel('owner')).toBe('Owner');
    expect(permissionLabel(null)).toBe('No access');
  });

  test('offers only the three grant levels in the picker', () => {
    expect(PERMISSION_OPTIONS.map((option) => option.value)).toEqual([
      'view',
      'comment',
      'edit',
    ]);
    expect(PERMISSION_OPTIONS.map((option) => option.label)).toEqual([
      'Can view',
      'Can comment',
      'Can edit',
    ]);
  });

  test('describes owner and unknown values without leaking a raw role', () => {
    expect(permissionDescription('owner')).toContain('Full control');
    expect(permissionDescription(null)).toContain('cannot open');
  });
});

describe('shared tabs and counts', () => {
  const items = [
    item('folder', 'f1', 'Design'),
    item('folder', 'f2', 'Research'),
    item('board', 'b1', 'Launch'),
    item('document', 'd1', 'Kickoff notes'),
  ];

  test('counts every tab from one item list', () => {
    expect(sharedTabCounts(items)).toEqual({
      all: 4,
      folders: 2,
      boards: 1,
      notes: 1,
    });
    expect(sharedTabCounts([])).toEqual({ all: 0, folders: 0, boards: 0, notes: 0 });
  });

  test('tab definitions are stable', () => {
    expect(SHARED_TABS).toEqual([
      { value: 'all', label: 'All' },
      { value: 'boards', label: 'Boards' },
      { value: 'notes', label: 'Notes' },
      { value: 'folders', label: 'Folders' },
    ]);
  });

  test('filters by tab before searching', () => {
    expect(filterSharedItems(items, 'folders', '').map(sharedItemTitle)).toEqual([
      'Design',
      'Research',
    ]);
    expect(filterSharedItems(items, 'boards', '').map(sharedItemTitle)).toEqual(['Launch']);
    expect(filterSharedItems(items, 'notes', '').map(sharedItemTitle)).toEqual([
      'Kickoff notes',
    ]);
  });

  test('searches titles and owner names case-insensitively', () => {
    expect(filterSharedItems(items, 'all', 'kick').map(sharedItemTitle)).toEqual([
      'Kickoff notes',
    ]);
    expect(filterSharedItems(items, 'all', 'ALEX')).toHaveLength(4);
    expect(
      filterSharedItems(
        [item('board', 'b2', 'Roadmap', { sharedBy: person('owner-2', 'Sam Chen') })],
        'all',
        'sam'
      ).map(sharedItemTitle)
    ).toEqual(['Roadmap']);
  });

  test('preserves server order while filtering', () => {
    expect(filterSharedItems(items, 'all', '').map(sharedItemTitle)).toEqual([
      'Design',
      'Research',
      'Launch',
      'Kickoff notes',
    ]);
  });
});

describe('grouping', () => {
  test('groups folders, then boards, then notes', () => {
    const groups = groupSharedItems([
      item('document', 'd1', 'Kickoff notes'),
      item('board', 'b1', 'Launch'),
      item('folder', 'f1', 'Design'),
      item('board', 'b2', 'Ops'),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Folders', 'Boards', 'Notes']);
    expect(groups.map((group) => group.items.map(sharedItemTitle))).toEqual([
      ['Design'],
      ['Launch', 'Ops'],
      ['Kickoff notes'],
    ]);
  });

  test('omits empty groups and tolerates no items', () => {
    expect(groupSharedItems([])).toEqual([]);
    expect(groupSharedItems([item('document', 'd1', 'Only a note')]).map((group) => group.type)).toEqual([
      'document',
    ]);
  });
});

describe('empty-state copy', () => {
  test('distinguishes an empty account from filtered results', () => {
    expect(sharedEmptyCopy({ total: 0, tab: 'all', query: '' })).toEqual({
      title: 'Nothing shared with you yet',
      description:
        'When someone shares a note, board, or folder with you, it appears here. Ask the owner for access if you expected something.',
    });

    expect(sharedEmptyCopy({ total: 3, tab: 'all', query: 'design' })).toEqual({
      title: 'No matches for “design”',
      description: 'Try a different title or name, or clear the search.',
    });

    expect(sharedEmptyCopy({ total: 3, tab: 'boards', query: '' })).toEqual({
      title: 'No shared boards',
      description: 'Boards other people share with you appear here.',
    });
  });
});

describe('invite search copy', () => {
  test('starts with the empty search hint', () => {
    expect(inviteSearchCopy({ query: '   ', resultCount: 0 })).toEqual({
      tone: 'muted',
      message: 'Search by name, or enter the exact email address of a Nana account.',
    });
  });

  test('explains name misses and exact-email misses differently', () => {
    expect(inviteSearchCopy({ query: 'Sam', resultCount: 0 })).toEqual({
      tone: 'muted',
      message: 'No people match “Sam”.',
    });
    expect(
      inviteSearchCopy({ query: 'sam@example.com', resultCount: 0, exactEmail: true })
    ).toEqual({
      tone: 'muted',
      message: 'No Nana account uses that email address.',
    });
  });

  test('calls out the current account and never offers an invite', () => {
    expect(
      inviteSearchCopy({
        query: 'me@example.com',
        resultCount: 0,
        exactEmail: true,
        isSelf: true,
      })
    ).toEqual({
      tone: 'muted',
      message: 'That is your account. You already own this item.',
    });
  });

  test('returns no message when results can be shown and surfaces search errors', () => {
    expect(inviteSearchCopy({ query: 'sam', resultCount: 2 })).toBeNull();
    expect(
      inviteSearchCopy({
        query: 'sam',
        resultCount: 0,
        error: 'Could not search people. Try again.',
      })
    ).toEqual({
      tone: 'danger',
      message: 'Could not search people. Try again.',
    });
  });

  test('filters self and marks people who already have access', () => {
    const candidates = shareCandidates(
      [
        person('me', 'Me'),
        person('u1', 'Sam Chen'),
        person('u2', 'Rae Patel'),
      ],
      ['u2'],
      'me'
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(['u1', 'u2']);
    expect(candidates[0]?.alreadyHasAccess).toBe(false);
    expect(candidates[1]?.alreadyHasAccess).toBe(true);
  });
});

describe('target labels and links', () => {
  test('uses the type-specific title and route', () => {
    expect(targetTitle('document', target('document', 'd1', 'Read me'))).toBe('Read me');
    expect(targetTitle('folder', target('folder', 'f1', ''))).toBe('Untitled folder');
    expect(targetTitle('board', target('board', 'b1', ''))).toBe('Untitled board');
    expect(sharedItemHref('folder', 'f1')).toBe('/shared/folders/f1');
    expect(sharedItemHref('document', 'd1')).toBe('/document/d1');
    expect(sharedItemHref('board', 'b1')).toBe('/board/b1');
  });
});
