import type { RecordModel } from '../record-model';
import { pb } from '../pocketbase';
import type { Document } from '../documents';
import { stripMarkdown } from './text';

export { stripMarkdown, plainTextExcerpt } from './text';

export type TaskStatus = 'backlog' | 'next' | 'progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task extends RecordModel {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | '';
  due_date: string;
  board_order: number;
  labels: string[];
  author: string;
  board: string;
  document?: string;
  created: string;
  updated: string;
  expand?: {
    document?: Document;
  };
}

export interface CreateTaskData {
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority | '';
  due_date?: string;
  board_order?: number;
  labels?: string[];
  board: string;
  document?: string;
}

/** Form-shaped task data; the board and its order are supplied by the page. */
export type TaskDraft = Omit<CreateTaskData, 'board' | 'board_order'>;

/** Board ownership is fixed at creation; updates cannot move a task to another board. */
export type UpdateTaskData = Partial<Omit<CreateTaskData, 'board'>>;

const COLLECTION = 'tasks';

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter(Boolean);
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    title: task.title ?? '',
    description: task.description ?? '',
    status: (task.status as TaskStatus) || 'backlog',
    priority: (task.priority as TaskPriority) || '',
    due_date: task.due_date ?? '',
    board_order: typeof task.board_order === 'number' ? task.board_order : 0,
    labels: normalizeLabels(task.labels),
    board: task.board ?? '',
  };
}

function requireAuthor(): string {
  const author = pb.authStore.record?.id;
  if (!author) {
    throw new Error('You must be signed in to manage tasks.');
  }
  return author;
}

export async function listTasks(boardId: string): Promise<Task[]> {
  if (!boardId) {
    return [];
  }

  const records = await pb.collection(COLLECTION).getFullList<Task>({
    filter: pb.filter('board = {:id}', { id: boardId }),
    sort: 'board_order,created',
    expand: 'document',
  });

  return records.map(normalizeTask);
}

export async function getTask(id: string): Promise<Task> {
  const record = await pb.collection(COLLECTION).getOne<Task>(id, { expand: 'document' });
  return normalizeTask(record);
}

export async function createTask(data: CreateTaskData): Promise<Task> {
  const record = await pb.collection(COLLECTION).create<Task>({
    title: data.title.trim() || 'Untitled task',
    description: data.description ?? '',
    status: data.status,
    priority: data.priority || '',
    due_date: data.due_date || '',
    board_order: data.board_order ?? 0,
    labels: normalizeLabels(data.labels),
    board: data.board,
    author: requireAuthor(),
    ...(data.document ? { document: data.document } : {}),
  });

  return normalizeTask(record);
}

export async function updateTask(id: string, data: UpdateTaskData): Promise<Task> {
  const payload: Record<string, unknown> = {};

  if (data.title !== undefined) payload.title = data.title.trim() || 'Untitled task';
  if (data.description !== undefined) payload.description = data.description;
  if (data.status !== undefined) payload.status = data.status;
  if (data.priority !== undefined) payload.priority = data.priority || '';
  if (data.due_date !== undefined) payload.due_date = data.due_date || '';
  if (data.board_order !== undefined) payload.board_order = data.board_order;
  if (data.labels !== undefined) payload.labels = normalizeLabels(data.labels);
  if (data.document !== undefined) payload.document = data.document || '';

  const record = await pb.collection(COLLECTION).update<Task>(id, payload);
  return normalizeTask(record);
}

export async function deleteTask(id: string): Promise<void> {
  await pb.collection(COLLECTION).delete(id);
}

export interface TaskPosition {
  id: string;
  status: TaskStatus;
  board_order: number;
}

/**
 * Persists a whole column's order in one batch. Only tasks whose status or
 * position actually changed are written, and only `status`/`board_order` are
 * sent so a board move can never be smuggled through this path.
 */
export async function persistTaskPositions(
  previous: Task[],
  next: TaskPosition[]
): Promise<void> {
  const previousById = new Map(previous.map((task) => [task.id, task]));
  const writes = next.filter((position) => {
    const before = previousById.get(position.id);
    return !before || before.status !== position.status || before.board_order !== position.board_order;
  });

  await Promise.all(
    writes.map((position) =>
      pb.collection(COLLECTION).update(position.id, {
        status: position.status,
        board_order: position.board_order,
      })
    )
  );
}

/**
 * Board ids that already hold a task imported from a note. The add-to-board
 * picker uses this to keep one note from being imported twice into one board.
 */
export async function listTaskBoardIdsForDocument(documentId: string): Promise<string[]> {
  if (!documentId) {
    return [];
  }

  const records = await pb.collection(COLLECTION).getFullList<Pick<Task, 'board'>>({
    filter: pb.filter('document = {:id}', { id: documentId }),
    fields: 'board',
    // The add-to-board picker also loads task counts; auto-cancellation keys
    // by path, so leave this request out of the SDK's request-key pool.
    requestKey: null,
  });

  return Array.from(new Set(records.map((record) => record.board).filter(Boolean)));
}

export async function createTaskFromDocument(
  document: Document,
  boardId: string,
  status: TaskStatus = 'backlog'
): Promise<Task> {
  const excerpt = stripMarkdown(document.content ?? '').slice(0, 4000);

  return createTask({
    title: document.title || 'Untitled note',
    description: excerpt,
    status,
    board: boardId,
    document: document.id,
    labels: Array.isArray(document.tags) ? document.tags.slice(0, 6) : [],
  });
}

export function subscribeToTasks(
  userId: string,
  onChange: () => void,
  boardId?: string
): () => void {
  let unsubscribe: (() => void) | undefined;

  void pb
    .collection(COLLECTION)
    .subscribe(
      '*',
      (event) => {
        const record = event.record as Task | undefined;
        if (!record || record.author === userId) {
          onChange();
        }
      },
      boardId ? { filter: pb.filter('board = {:id}', { id: boardId }) } : undefined
    )
    .then((unsub) => {
      unsubscribe = unsub;
    })
    .catch(() => {
      // Realtime is an enhancement; polling on focus still keeps the board fresh.
    });

  return () => {
    unsubscribe?.();
  };
}
