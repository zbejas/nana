import type { RecordModel } from '../record-model';
import { pb } from '../pocketbase';
import type { Task } from '../tasks';

export interface Board extends RecordModel {
  name: string;
  description: string;
  archived: boolean;
  author: string;
  folder: string;
  icon: string;
  task_counter: number;
  is_private: boolean;
  is_public: boolean;
  public_share_token?: string;
  public_expires_at?: string;
  created: string;
  updated: string;
}

export interface CreateBoardData {
  name: string;
  description?: string;
  archived?: boolean;
  folder?: string;
  icon?: string;
  is_private?: boolean;
}

export interface UpdateBoardData {
  name?: string;
  description?: string;
  archived?: boolean;
  folder?: string;
  icon?: string;
  is_private?: boolean;
  is_public?: boolean;
  public_share_token?: string | null;
  public_expires_at?: string | null;
}

export interface ListBoardsOptions {
  /** Include archived boards after the active ones. Defaults to false. */
  includeArchived?: boolean;
}

export interface BoardSummary extends Board {
  openCount: number;
  doneCount: number;
  total: number;
  /**
   * Latest board or task update, as a PocketBase timestamp. The timeline uses
   * it so working a board's tasks moves the board to the top of the feed.
   */
  lastActivity: string;
}

/**
 * One ordered workflow column. `slug` is the value stored in `tasks.status`
 * and is immutable while tasks reference it. `is_final` is the only completion
 * signal; a board may have several final columns and none named `done`.
 */
export interface BoardColumn extends RecordModel {
  board: string;
  name: string;
  slug: string;
  position: number;
  icon: string;
  color: string;
  is_final: boolean;
  created: string;
  updated: string;
}

export interface BoardColumnDraft {
  name: string;
  slug?: string;
  position?: number;
  icon?: string;
  color?: string;
  is_final?: boolean;
}

export type UpdateBoardColumnData = Partial<BoardColumnDraft>;

const COLLECTION = 'boards';
const COLUMNS_COLLECTION = 'board_columns';
const TASKS_COLLECTION = 'tasks';
const DEFAULT_COLUMN_ICON = 'dot';
const DEFAULT_COLUMN_COLOR = 'muted';
const RESERVED_COLUMN_SLUGS = new Set(['planned', 'archived']);

function assertColumnSlug(slug: string): string {
  if (RESERVED_COLUMN_SLUGS.has(slug)) {
    throw new Error('That column key is reserved for the virtual backlog.');
  }
  return slug;
}

function normalizeBoard(board: Board): Board {
  return {
    ...board,
    name: board.name ?? '',
    description: board.description ?? '',
    archived: board.archived === true,
    folder: board.folder ?? '',
    icon: board.icon ?? '',
    task_counter: typeof board.task_counter === 'number' ? board.task_counter : 0,
    is_private: board.is_private === true,
    is_public: board.is_public === true,
    public_share_token: board.public_share_token ?? '',
    public_expires_at: board.public_expires_at ?? '',
  };
}

function normalizeColumn(column: BoardColumn): BoardColumn {
  return {
    ...column,
    board: column.board ?? '',
    name: column.name ?? '',
    slug: column.slug ?? '',
    position: typeof column.position === 'number' ? column.position : 0,
    icon: column.icon ?? '',
    color: column.color ?? '',
    is_final: column.is_final === true,
    created: column.created ?? '',
    updated: column.updated ?? '',
  };
}

function requireAuthor(): string {
  const author = pb.authStore.record?.id;
  if (!author) {
    throw new Error('You must be signed in to manage boards.');
  }
  return author;
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim() || 'Untitled board';
}

/** Stable, URL-safe column key derived from a display name. */
export function slugifyColumnName(name: string): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'column';
}

async function uniqueColumnSlug(boardId: string, preferred: string): Promise<string> {
  const base = slugifyColumnName(preferred);
  const existing = await listBoardColumns(boardId);
  const taken = new Set(existing.map((column) => column.slug));
  for (const reserved of RESERVED_COLUMN_SLUGS) taken.add(reserved);
  if (!taken.has(base)) return base;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base.slice(0, 56)}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new Error('Could not find an unused column key.');
}

/**
 * Lists the signed-in user's boards. Active boards come first (newest first),
 * archived boards after them (most recently updated first).
 */
export async function listBoards(options: ListBoardsOptions = {}): Promise<Board[]> {
  const author = pb.authStore.record?.id;
  if (!author) return [];

  const records = await pb.collection(COLLECTION).getFullList<Board>({
    // Board rules now include records shared with the caller. Personal
    // surfaces (timeline, folders, sidebar, archive) must stay owner-only;
    // shared boards are reached through /shared and getBoard(id).
    filter: pb.filter(
      options.includeArchived
        ? 'author = {:author}'
        : 'author = {:author} && archived = false',
      { author }
    ),
    sort: '-created',
    // The sidebar, folder view, and timeline can all read boards at the same
    // time. Keep these small list requests out of the SDK's auto-cancellation
    // pool so one surface cannot abort another.
    requestKey: null,
  });

  const boards = records.map(normalizeBoard);
  const active = boards
    .filter((board) => !board.archived)
    .sort((a, b) => b.created.localeCompare(a.created));

  if (!options.includeArchived) {
    return active;
  }

  const archived = boards
    .filter((board) => board.archived)
    .sort((a, b) => b.updated.localeCompare(a.updated));

  return [...active, ...archived];
}

export async function getBoard(id: string): Promise<Board> {
  const record = await pb.collection(COLLECTION).getOne<Board>(id);
  return normalizeBoard(record);
}

/**
 * Creates a board with a provisional name and opens it for inline naming.
 * Board creation no longer interrupts the workspace with a form dialog.
 */
export async function createUntitledBoard(folder?: string): Promise<Board> {
  return createBoard({ name: 'Untitled board', folder });
}

export async function createBoard(data: CreateBoardData): Promise<Board> {
  const payload: Record<string, unknown> = {
    name: normalizeName(data.name),
    description: data.description ?? '',
    archived: data.archived === true,
    author: requireAuthor(),
  };

  if (data.folder) payload.folder = data.folder;
  if (data.icon !== undefined) payload.icon = data.icon;
  if (data.is_private !== undefined) payload.is_private = data.is_private === true;

  const record = await pb.collection(COLLECTION).create<Board>(payload);

  return normalizeBoard(record);
}

/**
 * Updates mutable board metadata. Ownership is set on create and cannot be
 * changed afterwards; archiving goes through `archived: true`. An empty
 * `folder` clears the board's folder and returns it to the root.
 */
export async function updateBoard(id: string, data: UpdateBoardData): Promise<Board> {
  const payload: Record<string, unknown> = {};

  if (data.name !== undefined) payload.name = normalizeName(data.name);
  if (data.description !== undefined) payload.description = data.description;
  if (data.archived !== undefined) payload.archived = data.archived === true;
  if (data.folder !== undefined) payload.folder = data.folder;
  if (data.icon !== undefined) payload.icon = data.icon;
  if (data.is_private !== undefined) payload.is_private = data.is_private === true;
  if (data.is_public !== undefined) payload.is_public = data.is_public === true;
  if (data.public_share_token !== undefined) {
    payload.public_share_token = data.public_share_token ?? '';
  }
  if (data.public_expires_at !== undefined) {
    payload.public_expires_at = data.public_expires_at ?? '';
  }
  if (data.is_private === true) {
    // Private and public are mutually exclusive. Clear last so privacy wins
    // even when a caller sends both states in one patch.
    payload.is_public = false;
    payload.public_share_token = '';
    payload.public_expires_at = '';
  }

  const record = await pb.collection(COLLECTION).update<Board>(id, payload);
  return normalizeBoard(record);
}

export async function archiveBoard(id: string): Promise<Board> {
  return updateBoard(id, { archived: true });
}

export async function restoreBoard(id: string): Promise<Board> {
  return updateBoard(id, { archived: false });
}

/**
 * Permanently deletes an archived board. PocketBase rejects this for active
 * boards, and its tasks are removed by the relation cascade.
 */
export async function deleteBoardPermanently(id: string): Promise<void> {
  await pb.collection(COLLECTION).delete(id);
}

// ── Workflow columns ────────────────────────────────────────────────

/** Board columns in workflow order. */
export async function listBoardColumns(boardId: string): Promise<BoardColumn[]> {
  if (!boardId) {
    return [];
  }

  const records = await pb.collection(COLUMNS_COLLECTION).getFullList<BoardColumn>({
    filter: pb.filter('board = {:board}', { board: boardId }),
    sort: 'position,created',
    // Columns are fetched next to tasks and summaries; keep them out of the
    // auto-cancellation pool.
    requestKey: null,
  });

  return records.map(normalizeColumn);
}

export async function createBoardColumn(
  boardId: string,
  draft: BoardColumnDraft
): Promise<BoardColumn> {
  if (!boardId) {
    throw new Error('Choose a board first.');
  }

  const name = (draft.name ?? '').trim();
  if (!name) {
    throw new Error('A column name is required.');
  }

  const columns = await listBoardColumns(boardId);
  const slug = assertColumnSlug(
    draft.slug?.trim()
      ? slugifyColumnName(draft.slug)
      : await uniqueColumnSlug(boardId, name)
  );
  if (columns.some((column) => column.slug === slug)) {
    throw new Error('A column with that key already exists.');
  }

  const lastPosition = columns.reduce(
    (max, column) => Math.max(max, column.position),
    -1,
  );
  const payload: Record<string, unknown> = {
    board: boardId,
    name,
    slug,
    position: draft.position ?? lastPosition + 1,
    icon: draft.icon ?? DEFAULT_COLUMN_ICON,
    color: draft.color ?? DEFAULT_COLUMN_COLOR,
    is_final: draft.is_final === true,
  };

  const record = await pb.collection(COLUMNS_COLLECTION).create<BoardColumn>(payload);
  return normalizeColumn(record);
}

export async function updateBoardColumn(
  id: string,
  data: UpdateBoardColumnData
): Promise<BoardColumn> {
  const payload: Record<string, unknown> = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) {
      throw new Error('A column name is required.');
    }
    payload.name = name;
  }
  if (data.slug !== undefined) {
    const slug = assertColumnSlug(slugifyColumnName(data.slug));
    if (!slug) {
      throw new Error('A column key is required.');
    }
    payload.slug = slug;
  }
  if (data.position !== undefined) payload.position = data.position;
  if (data.icon !== undefined) payload.icon = data.icon;
  if (data.color !== undefined) payload.color = data.color;
  if (data.is_final !== undefined) payload.is_final = data.is_final === true;

  const record = await pb.collection(COLUMNS_COLLECTION).update<BoardColumn>(id, payload);
  return normalizeColumn(record);
}

/**
 * Deletes a column. PocketBase refuses while tasks still reference its slug
 * and when it is the board's last column.
 */
export async function deleteBoardColumn(id: string): Promise<void> {
  await pb.collection(COLUMNS_COLLECTION).delete(id);
}

/** Persists the full column order; every id must belong to the board. */
export async function reorderBoardColumns(
  boardId: string,
  orderedIds: string[]
): Promise<void> {
  const columns = await listBoardColumns(boardId);
  const known = new Set(columns.map((column) => column.id));
  const ordered = orderedIds.filter((id) => known.has(id));

  if (ordered.length !== columns.length || new Set(ordered).size !== columns.length) {
    throw new Error('The column order must include every column exactly once.');
  }

  await Promise.all(
    ordered.map((id, position) =>
      pb.collection(COLUMNS_COLLECTION).update(id, { position })
    )
  );
}

/**
 * Pure completion summary over one board's tasks. A task is done only when
 * its status matches a final column; `planned` and `archived` are always open.
 */
export function summarizeTaskCounts(
  tasks: Array<Pick<Task, 'status'>>,
  columns: Array<Pick<BoardColumn, 'slug' | 'is_final'>>
): { open: number; done: number; total: number } {
  const finalSlugs = new Set(
    columns.filter((column) => column.is_final).map((column) => column.slug),
  );

  let done = 0;
  let total = 0;
  for (const task of tasks) {
    total += 1;
    if (finalSlugs.has(task.status)) {
      done += 1;
    }
  }

  return { open: total - done, done, total };
}

/**
 * Boards with task counts for the timeline and folder views. Counts come from
 * one task query plus one column query for the visible boards; boards with no
 * tasks still appear.
 */
export async function listBoardSummaries(
  options: ListBoardsOptions = {}
): Promise<BoardSummary[]> {
  const boards = await listBoards(options);
  if (boards.length === 0) {
    return [];
  }

  const boardIds = boards.map((board) => board.id);
  const filters = boardIds.map((_, index) => `board = {:board${index}}`);
  const params: Record<string, string> = {};
  boardIds.forEach((id, index) => {
    params[`board${index}`] = id;
  });

  const [tasks, columns] = await Promise.all([
    pb
      .collection(TASKS_COLLECTION)
      .getFullList<Pick<Task, 'board' | 'status' | 'updated'>>({
        filter: pb.filter(filters.join(' || '), params),
        fields: 'board,status,updated',
        // Board summaries are often fetched alongside another task query (the
        // add-to-board picker). Keep this request out of auto-cancellation.
        requestKey: null,
      }),
    pb
      .collection(COLUMNS_COLLECTION)
      .getFullList<Pick<BoardColumn, 'board' | 'slug' | 'is_final'>>({
        filter: pb.filter(filters.join(' || '), params),
        fields: 'board,slug,is_final',
        requestKey: null,
      }),
  ]);

  const columnsByBoard = new Map<string, Array<Pick<BoardColumn, 'slug' | 'is_final'>>>();
  for (const column of columns) {
    const entry = columnsByBoard.get(column.board) ?? [];
    entry.push(column);
    columnsByBoard.set(column.board, entry);
  }

  const tasksByBoard = new Map<string, Array<Pick<Task, 'status' | 'updated'>>>();
  for (const task of tasks) {
    if (!task.board) continue;
    const entry = tasksByBoard.get(task.board) ?? [];
    entry.push(task);
    tasksByBoard.set(task.board, entry);
  }

  return boards.map((board) => {
    const boardTasks = tasksByBoard.get(board.id) ?? [];
    const counts = summarizeTaskCounts(boardTasks, columnsByBoard.get(board.id) ?? []);
    let lastActivity = '';
    for (const task of boardTasks) {
      if (task.updated && task.updated > lastActivity) {
        lastActivity = task.updated;
      }
    }

    return {
      ...board,
      openCount: counts.open,
      doneCount: counts.done,
      total: counts.total,
      lastActivity:
        lastActivity && lastActivity > board.updated ? lastActivity : board.updated,
    };
  });
}

/** Realtime board changes. Returns an unsubscribe function. */
export function subscribeToBoards(onChange: () => void): () => void {
  let unsubscribe: (() => void) | undefined;

  void pb
    .collection(COLLECTION)
    .subscribe('*', () => {
      // PocketBase already scopes events to records the caller can read.
      // Personal lists refetch owner-only rows; an open shared board still
      // needs the same refresh.
      onChange();
    })
    .then((unsub) => {
      unsubscribe = unsub;
    })
    .catch(() => {
      // Realtime is an enhancement; reloading on focus still keeps boards fresh.
    });

  return () => {
    unsubscribe?.();
  };
}
