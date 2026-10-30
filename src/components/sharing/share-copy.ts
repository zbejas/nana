import type {
  AccessRole,
  SharePermission,
  ShareTargetType,
  ShareUser,
  SharedItem,
  SharedTarget,
} from '../../lib/sharing';

/**
 * The single source of truth for sharing language. Permissions, type names,
 * empty states, and invite messages all live here so the share panel and the
 * "Shared with me" page never drift apart.
 */

export type PermissionValue = SharePermission | 'owner';

export const PERMISSION_LABELS: Record<PermissionValue, string> = {
  view: 'Can view',
  comment: 'Can comment',
  edit: 'Can edit',
  owner: 'Owner',
};

export const PERMISSION_DESCRIPTIONS: Record<PermissionValue, string> = {
  view: 'Open and read. No changes or comments.',
  comment: 'Read and join the comment thread. No edits.',
  edit: 'Change content, tasks, and fields. No sharing or privacy changes.',
  owner: 'Full control, including sharing and privacy.',
};

export const PERMISSION_OPTIONS: ReadonlyArray<{ value: SharePermission; label: string }> = [
  { value: 'view', label: PERMISSION_LABELS.view },
  { value: 'comment', label: PERMISSION_LABELS.comment },
  { value: 'edit', label: PERMISSION_LABELS.edit },
];

export const PERMISSION_VALUES: ReadonlyArray<SharePermission> = ['view', 'comment', 'edit'];

export function isSharePermission(value: unknown): value is SharePermission {
  return value === 'view' || value === 'comment' || value === 'edit';
}

export function permissionLabel(value: AccessRole | PermissionValue | null | undefined): string {
  if (value === 'view' || value === 'comment' || value === 'edit' || value === 'owner') {
    return PERMISSION_LABELS[value];
  }
  return 'No access';
}

export function permissionDescription(value: AccessRole | PermissionValue | null | undefined): string {
  if (value === 'view' || value === 'comment' || value === 'edit' || value === 'owner') {
    return PERMISSION_DESCRIPTIONS[value];
  }
  return 'This account cannot open the record.';
}

/** Short noun used in panel copy: "Share this note". */
export function targetKindLabel(type: ShareTargetType): string {
  if (type === 'document') return 'note';
  if (type === 'folder') return 'folder';
  return 'board';
}

/** Capitalised noun used in lists and group headings. */
export function targetTypeLabel(type: ShareTargetType): string {
  if (type === 'document') return 'Note';
  if (type === 'folder') return 'Folder';
  return 'Board';
}

export function targetTitle(type: ShareTargetType, target: SharedTarget): string {
  if (type === 'document') return target.title?.trim() || 'Untitled note';
  if (type === 'folder') return target.name?.trim() || 'Untitled folder';
  return target.name?.trim() || 'Untitled board';
}

export function sharedItemTitle(item: SharedItem): string {
  return targetTitle(item.type, item.target);
}

export function sharedItemHref(type: ShareTargetType, id: string): string {
  if (type === 'folder') return `/shared/folders/${encodeURIComponent(id)}`;
  if (type === 'document') return `/document/${encodeURIComponent(id)}`;
  return `/board/${encodeURIComponent(id)}`;
}

export type SharedTab = 'all' | 'boards' | 'notes' | 'folders';

export const SHARED_TABS: ReadonlyArray<{ value: SharedTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'boards', label: 'Boards' },
  { value: 'notes', label: 'Notes' },
  { value: 'folders', label: 'Folders' },
];

const TAB_TYPE: Record<Exclude<SharedTab, 'all'>, ShareTargetType> = {
  boards: 'board',
  notes: 'document',
  folders: 'folder',
};

export interface SharedTabCounts {
  all: number;
  boards: number;
  notes: number;
  folders: number;
}

export function sharedTabCounts(items: ReadonlyArray<Pick<SharedItem, 'type'>>): SharedTabCounts {
  const counts: SharedTabCounts = { all: items.length, boards: 0, notes: 0, folders: 0 };
  for (const item of items) {
    if (item.type === 'board') counts.boards += 1;
    else if (item.type === 'document') counts.notes += 1;
    else if (item.type === 'folder') counts.folders += 1;
  }
  return counts;
}

function matchesQuery(item: SharedItem, query: string): boolean {
  if (!query) return true;
  const target = item.target;
  const haystack = [
    target.title,
    target.name,
    target.slug,
    target.description,
    item.sharedBy?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Applies the active tab first, then a case-insensitive title/owner search.
 * Order is preserved so the server's last-activity sort survives.
 */
export function filterSharedItems(
  items: ReadonlyArray<SharedItem>,
  tab: SharedTab,
  query: string
): SharedItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (tab !== 'all' && item.type !== TAB_TYPE[tab]) return false;
    return matchesQuery(item, needle);
  });
}

export interface SharedGroup {
  type: ShareTargetType;
  label: string;
  items: SharedItem[];
}

const GROUP_ORDER: ShareTargetType[] = ['folder', 'board', 'document'];

/** Groups folders, boards, then notes, keeping the server order inside each. */
export function groupSharedItems(items: ReadonlyArray<SharedItem>): SharedGroup[] {
  return GROUP_ORDER.map((type) => ({
    type,
    label: `${targetTypeLabel(type)}s`,
    items: items.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);
}

export interface SharedEmptyCopy {
  title: string;
  description: string;
}

/**
 * Empty-state copy distinguishes "nothing shared yet" from "nothing matches
 * this filter" so the page never tells a user their library is empty when it
 * is only filtered.
 */
export function sharedEmptyCopy(input: {
  total: number;
  tab: SharedTab;
  query: string;
}): SharedEmptyCopy {
  const query = input.query.trim();

  if (input.total === 0) {
    return {
      title: 'Nothing shared with you yet',
      description:
        'When someone shares a note, board, or folder with you, it appears here. Ask the owner for access if you expected something.',
    };
  }

  if (query) {
    return {
      title: `No matches for “${query}”`,
      description: 'Try a different title or name, or clear the search.',
    };
  }

  if (input.tab !== 'all') {
    const labels: Record<Exclude<SharedTab, 'all'>, { title: string; description: string }> = {
      boards: {
        title: 'No shared boards',
        description: 'Boards other people share with you appear here.',
      },
      notes: {
        title: 'No shared notes',
        description: 'Notes other people share with you appear here.',
      },
      folders: {
        title: 'No shared folders',
        description: 'Folders other people share with you appear here.',
      },
    };
    return labels[input.tab];
  }

  return {
    title: 'Nothing shared with you yet',
    description:
      'When someone shares a note, board, or folder with you, it appears here. Ask the owner for access if you expected something.',
  };
}

export interface InviteSearchCopy {
  tone: 'muted' | 'danger';
  message: string;
}

/**
 * One message at a time beneath the invite field. The panel uses this instead
 * of scattering small conditional paragraphs through the list.
 */
export function inviteSearchCopy(input: {
  query: string;
  resultCount: number;
  exactEmail?: boolean;
  isSelf?: boolean;
  error?: string | null;
}): InviteSearchCopy | null {
  if (input.error) {
    return { tone: 'danger', message: input.error };
  }

  const query = input.query.trim();
  if (!query) {
    return {
      tone: 'muted',
      message: 'Search by name, or enter the exact email address of a Nana account.',
    };
  }

  if (input.isSelf) {
    return { tone: 'muted', message: 'That is your account. You already own this item.' };
  }

  if (input.resultCount === 0) {
    return input.exactEmail
      ? { tone: 'muted', message: 'No Nana account uses that email address.' }
      : { tone: 'muted', message: `No people match “${query}”.` };
  }

  return null;
}

export interface ShareCandidate extends ShareUser {
  alreadyHasAccess: boolean;
}

/**
 * Directory search results are filtered for the current account and annotated
 * when the person already has a direct grant. Existing grantees stay visible so
 * the result explains why they cannot be invited again.
 */
export function shareCandidates(
  users: ReadonlyArray<ShareUser>,
  existingUserIds: Iterable<string>,
  selfId?: string
): ShareCandidate[] {
  const existing = new Set(existingUserIds);
  return users
    .filter((user) => Boolean(user?.id) && user.id !== selfId)
    .map((user) => ({ ...user, alreadyHasAccess: existing.has(user.id) }));
}

export function sharedItemPermissionLabel(item: SharedItem): string {
  return permissionLabel(item.permission);
}
