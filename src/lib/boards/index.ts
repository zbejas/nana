import type { RecordModel } from 'pocketbase';
import { pb } from '../pocketbase';
import type { Task } from '../tasks';

export interface Board extends RecordModel {
  name: string;
  description: string;
  archived: boolean;
  author: string;
  folder: string;
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
  is_private?: boolean;
}

export interface UpdateBoardData {
  name?: string;
  description?: string;
  archived?: boolean;
  folder?: string;
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

const COLLECTION = 'boards';
const TASKS_COLLECTION = 'tasks';

function normalizeBoard(board: Board): Board {
  return {
    ...board,
    name: board.name ?? '',
    description: board.description ?? '',
    archived: board.archived === true,
    folder: board.folder ?? '',
    is_private: board.is_private === true,
    is_public: board.is_public === true,
    public_share_token: board.public_share_token ?? '',
    public_expires_at: board.public_expires_at ?? '',
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

/**
 * Lists the signed-in user's boards. Active boards come first (newest first),
 * archived boards after them (most recently updated first).
 */
export async function listBoards(options: ListBoardsOptions = {}): Promise<Board[]> {
  const records = await pb.collection(COLLECTION).getFullList<Board>({
    filter: options.includeArchived ? '' : 'archived = false',
    sort: '-created',
    // The sidebar, folder view, board index, and timeline can all read boards
    // at the same time. Keep these small list requests out of the SDK's
    // auto-cancellation pool so one surface cannot abort another.
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

export async function createBoard(data: CreateBoardData): Promise<Board> {
  const payload: Record<string, unknown> = {
    name: normalizeName(data.name),
    description: data.description ?? '',
    archived: data.archived === true,
    author: requireAuthor(),
  };

  if (data.folder) payload.folder = data.folder;
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
  if (data.is_private !== undefined) payload.is_private = data.is_private === true;
  if (data.is_private === true) {
    // Private and public are mutually exclusive. Clearing the token here also
    // prevents a stale share icon when privacy is changed outside the modal.
    payload.is_public = false;
    payload.public_share_token = '';
    payload.public_expires_at = '';
  }
  if (data.is_public !== undefined) payload.is_public = data.is_public === true;
  if (data.public_share_token !== undefined) {
    payload.public_share_token = data.public_share_token ?? '';
  }
  if (data.public_expires_at !== undefined) {
    payload.public_expires_at = data.public_expires_at ?? '';
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

/**
 * Boards with task counts for the board index. Counts come from one task
 * query and include boards with no tasks.
 */
export async function listBoardSummaries(
  options: ListBoardsOptions = {}
): Promise<BoardSummary[]> {
  const [boards, tasks] = await Promise.all([
    listBoards(options),
    pb
      .collection(TASKS_COLLECTION)
      .getFullList<Pick<Task, 'board' | 'status' | 'updated'>>({
        fields: 'board,status,updated',
        // Board summaries are often fetched alongside another task query (the
        // add-to-board picker). Keep this request out of auto-cancellation.
        requestKey: null,
      }),
  ]);

  const counts = new Map<string, { open: number; done: number; lastActivity: string }>();

  for (const task of tasks) {
    if (!task.board) continue;

    const current = counts.get(task.board) ?? { open: 0, done: 0, lastActivity: '' };
    if (task.status === 'done') {
      current.done += 1;
    } else {
      current.open += 1;
    }
    if (task.updated && task.updated > current.lastActivity) {
      current.lastActivity = task.updated;
    }
    counts.set(task.board, current);
  }

  return boards.map((board) => {
    const count = counts.get(board.id) ?? { open: 0, done: 0, lastActivity: '' };
    return {
      ...board,
      openCount: count.open,
      doneCount: count.done,
      total: count.open + count.done,
      lastActivity:
        count.lastActivity && count.lastActivity > board.updated
          ? count.lastActivity
          : board.updated,
    };
  });
}

/** Realtime board changes. Returns an unsubscribe function. */
export function subscribeToBoards(onChange: () => void): () => void {
  let unsubscribe: (() => void) | undefined;

  void pb
    .collection(COLLECTION)
    .subscribe('*', (event) => {
      const record = event.record as Board | undefined;
      const userId = pb.authStore.record?.id;
      if (!record || !userId || record.author === userId) {
        onChange();
      }
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
