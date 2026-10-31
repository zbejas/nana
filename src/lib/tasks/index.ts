import type { RecordModel } from '../record-model';
import { pb } from '../pocketbase';
import type { BoardColumn } from '../boards';
import type { Document } from '../documents';
import { stripMarkdown } from './text';

export { stripMarkdown, plainTextExcerpt } from './text';

/** A real column slug, or one of the virtual backlog statuses. */
export type TaskStatus = string;
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Statuses that never have a `board_columns` row. */
export const VIRTUAL_STATUSES = ['planned', 'archived'] as const;
export type VirtualTaskStatus = (typeof VIRTUAL_STATUSES)[number];

export function isVirtualStatus(status: unknown): status is VirtualTaskStatus {
  return typeof status === 'string' && (VIRTUAL_STATUSES as readonly string[]).includes(status);
}

/**
 * A readable label for any status. Column definitions win over the virtual
 * labels; unknown slugs fall back to a sentence-cased key so a missing column
 * never renders as a raw identifier.
 */
export function statusLabel(
  status: string,
  columns: ReadonlyArray<Pick<BoardColumn, 'slug' | 'name'>> = []
): string {
  const column = columns.find((candidate) => candidate.slug === status);
  if (column?.name) {
    return column.name;
  }
  if (status === 'planned') return 'Planned';
  if (status === 'archived') return 'Archived';

  const words = (status ?? '').replace(/[-_]+/g, ' ').trim();
  if (!words) return 'No status';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TaskRecurrence {
  frequency: RecurrenceFrequency;
  interval: number;
  /** ISO weekday numbers (1 = Monday … 7 = Sunday) for weekly rules. */
  weekdays?: number[];
  timeZone?: string;
}

export interface TaskUser extends RecordModel {
  name?: string;
  email?: string;
  avatar?: string;
}

export interface Task extends RecordModel {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority | '';
  due_date: string;
  start_date: string;
  completed_at: string;
  board_order: number;
  labels: string[];
  board: string;
  document?: string;
  assignee?: string;
  recurrence?: TaskRecurrence | null;
  task_number?: number;
  created: string;
  updated: string;
  expand?: {
    document?: Document;
    assignee?: TaskUser;
  };
}

export interface CreateTaskData {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority | '';
  due_date?: string;
  start_date?: string;
  board_order?: number;
  labels?: string[];
  board: string;
  document?: string;
  assignee?: string;
  recurrence?: TaskRecurrence | null;
}

/** Form-shaped task data; the board and its order are supplied by the page. */
export type TaskDraft = Omit<CreateTaskData, 'board' | 'board_order'>;

/** Board ownership is fixed at creation; updates cannot move a task to another board. */
export type UpdateTaskData = Partial<Omit<CreateTaskData, 'board'>>;

export type TaskRelationType = 'subtask' | 'blocks' | 'related';

export const TASK_RELATION_TYPES: TaskRelationType[] = ['subtask', 'blocks', 'related'];

/**
 * A directed edge between two tasks. For `subtask`, `source` is the parent and
 * `target` is the child.
 */
export interface TaskRelation extends RecordModel {
  source: string;
  target: string;
  type: TaskRelationType;
  created: string;
  updated: string;
  expand?: {
    source?: Task;
    target?: Task;
  };
}

export interface CreateTaskRelationData {
  source: string;
  target: string;
  type: TaskRelationType;
}

export type TaskActivityType =
  | 'created'
  | 'title_changed'
  | 'status_changed'
  | 'priority_changed'
  | 'due_date_changed'
  | 'start_date_changed'
  | 'assignee_changed'
  | 'document_changed'
  | 'labels_changed'
  | 'description_changed'
  | 'recurrence_changed'
  | 'comment'
  | string;

export interface TaskActivity extends RecordModel {
  task: string;
  board: string;
  actor?: string;
  actor_type?: 'user' | 'ai' | 'system';
  actor_label?: string;
  type: TaskActivityType;
  data: Record<string, unknown>;
  created: string;
  expand?: {
    actor?: TaskUser;
  };
}

/** An owner-defined label. Tasks store label names; this collection owns colours. */
export interface TaskLabel extends RecordModel {
  author: string;
  name: string;
  color: string;
  created: string;
  updated: string;
}

export interface TaskComment extends RecordModel {
  targetType?: string;
  targetId?: string;
  task?: string;
  body: string;
  author: TaskUser;
  created: string;
  updated: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface TaskCommentsResult {
  items: TaskComment[];
  permission: string;
  canComment: boolean;
}

const COLLECTION = 'tasks';
const RELATIONS_COLLECTION = 'task_relations';
const ACTIVITY_COLLECTION = 'task_activity';
const LABELS_COLLECTION = 'labels';
const SHARING_COMMENTS_PATH = '/sharing/comments';

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter(Boolean);
}

function normalizeStatus(value: unknown): TaskStatus {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRecurrence(value: unknown): TaskRecurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<TaskRecurrence>;
  if (
    candidate.frequency !== 'daily'
    && candidate.frequency !== 'weekly'
    && candidate.frequency !== 'monthly'
    && candidate.frequency !== 'yearly'
  ) {
    return null;
  }

  const recurrence: TaskRecurrence = {
    frequency: candidate.frequency,
    interval:
      typeof candidate.interval === 'number' && Number.isFinite(candidate.interval)
        ? Math.max(1, Math.trunc(candidate.interval))
        : 1,
  };
  if (Array.isArray(candidate.weekdays)) {
    recurrence.weekdays = candidate.weekdays
      .filter((day): day is number => typeof day === 'number' && Number.isInteger(day))
      .map((day) => Math.min(7, Math.max(1, day)));
  }
  if (typeof candidate.timeZone === 'string' && candidate.timeZone.trim()) {
    recurrence.timeZone = candidate.timeZone.trim();
  }
  return recurrence;
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    title: task.title ?? '',
    description: task.description ?? '',
    status: normalizeStatus(task.status) || 'planned',
    priority: (task.priority as TaskPriority) || '',
    due_date: task.due_date ?? '',
    start_date: task.start_date ?? '',
    completed_at: task.completed_at ?? '',
    board_order: typeof task.board_order === 'number' ? task.board_order : 0,
    labels: normalizeLabels(task.labels),
    board: task.board ?? '',
    assignee: task.assignee ?? '',
    recurrence: normalizeRecurrence(task.recurrence),
    task_number:
      typeof task.task_number === 'number' && task.task_number > 0
        ? task.task_number
        : undefined,
  };
}

function requireStatus(status: TaskStatus | undefined, fallback?: TaskStatus): TaskStatus {
  const value = normalizeStatus(status) || fallback || '';
  if (!value) {
    throw new Error('Choose a column first.');
  }
  return value;
}

export async function listTasks(boardId: string): Promise<Task[]> {
  if (!boardId) {
    return [];
  }

  const records = await pb.collection(COLLECTION).getFullList<Task>({
    filter: pb.filter('board = {:id}', { id: boardId }),
    sort: 'board_order,created',
    expand: 'assignee,document',
  });

  return records.map(normalizeTask);
}

export async function getTask(id: string): Promise<Task> {
  const record = await pb.collection(COLLECTION).getOne<Task>(id, {
    expand: 'assignee,document',
  });
  return normalizeTask(record);
}

export async function createTask(data: CreateTaskData): Promise<Task> {
  const status = requireStatus(data.status, 'planned');
  const record = await pb.collection(COLLECTION).create<Task>({
    title: data.title.trim() || 'Untitled task',
    description: data.description ?? '',
    status,
    priority: data.priority || '',
    due_date: data.due_date || '',
    start_date: data.start_date || '',
    board_order: data.board_order ?? 0,
    labels: normalizeLabels(data.labels),
    board: data.board,
    ...(data.document ? { document: data.document } : {}),
    ...(data.assignee ? { assignee: data.assignee } : {}),
    ...(data.recurrence ? { recurrence: normalizeRecurrence(data.recurrence) } : {}),
  });

  return normalizeTask(record);
}

export async function updateTask(id: string, data: UpdateTaskData): Promise<Task> {
  const payload: Record<string, unknown> = {};

  if (data.title !== undefined) payload.title = data.title.trim() || 'Untitled task';
  if (data.description !== undefined) payload.description = data.description;
  if (data.status !== undefined) payload.status = requireStatus(data.status);
  if (data.priority !== undefined) payload.priority = data.priority || '';
  if (data.due_date !== undefined) payload.due_date = data.due_date || '';
  if (data.start_date !== undefined) payload.start_date = data.start_date || '';
  if (data.board_order !== undefined) payload.board_order = data.board_order;
  if (data.labels !== undefined) payload.labels = normalizeLabels(data.labels);
  if (data.document !== undefined) payload.document = data.document || '';
  if (data.assignee !== undefined) payload.assignee = data.assignee || '';
  if (data.recurrence !== undefined) {
    const recurrence = normalizeRecurrence(data.recurrence);
    payload.recurrence = recurrence ?? null;
  }

  const record = await pb.collection(COLLECTION).update<Task>(id, payload);
  return normalizeTask(record);
}

export async function deleteTask(id: string): Promise<void> {
  await pb.collection(COLLECTION).delete(id);
}

/**
 * Copy a task into a board. The title gets a `(copy)` suffix, labels and
 * scheduling fields are copied, and completion/number are intentionally left
 * out. The copy lands in the virtual `planned` backlog so it can never inherit
 * a final column's completion, and the server assigns the next board number.
 */
export async function duplicateTask(task: Task, boardId: string): Promise<Task> {
  const title = `${(task.title || 'Untitled task').trim()} (copy)`;
  return createTask({
    title,
    description: task.description,
    status: 'planned',
    priority: task.priority,
    due_date: task.due_date,
    start_date: task.start_date,
    board_order: 0,
    labels: task.labels,
    board: boardId,
    document: task.document,
    assignee: task.assignee,
    recurrence: task.recurrence ?? null,
  });
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

// ── Relations and activity ──────────────────────────────────────────

/** Every edge touching a task, in either direction. */
export async function listTaskRelations(taskId: string): Promise<TaskRelation[]> {
  if (!taskId) {
    return [];
  }

  const records = await pb.collection(RELATIONS_COLLECTION).getFullList<TaskRelation>({
    filter: pb.filter('source = {:id} || target = {:id}', { id: taskId }),
    sort: 'created',
    expand: 'source,target',
    requestKey: null,
  });

  return records;
}

export async function createTaskRelation(
  data: CreateTaskRelationData
): Promise<TaskRelation> {
  if (!data.source || !data.target) {
    throw new Error('Choose two tasks to link.');
  }
  if (data.source === data.target) {
    throw new Error('A task cannot relate to itself.');
  }
  if (!TASK_RELATION_TYPES.includes(data.type)) {
    throw new Error('Choose a relation type.');
  }

  // The browser facade keeps `task_relations` read-only; writes go through the
  // typed workspace route, which applies the same access and privacy checks as
  // the rest of `/api/v1`.
  const dto = await pb.send<{
    id: string;
    sourceTaskId: string;
    targetTaskId: string;
    type: TaskRelationType;
    created: string;
    updated: string;
  }>(`/tasks/${encodeURIComponent(data.source)}/relations`, {
    method: 'POST',
    body: { targetTaskId: data.target, type: data.type },
  });

  return {
    id: dto.id,
    source: dto.sourceTaskId,
    target: dto.targetTaskId,
    type: dto.type,
    created: dto.created,
    updated: dto.updated,
  };
}

export async function deleteTaskRelation(id: string): Promise<void> {
  await pb.send(`/task-relations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Task activity, newest first. The server appends rows; nothing here writes. */
export async function listTaskActivity(taskId: string): Promise<TaskActivity[]> {
  if (!taskId) {
    return [];
  }

  const records = await pb.collection(ACTIVITY_COLLECTION).getFullList<TaskActivity>({
    filter: pb.filter('task = {:id}', { id: taskId }),
    sort: '-created',
    expand: 'actor',
    requestKey: null,
  });

  return records;
}

// ── Labels ──────────────────────────────────────────────────────────

function normalizeLabel(record: TaskLabel): TaskLabel {
  return {
    ...record,
    author: record.author ?? '',
    name: (record.name ?? '').trim(),
    color: (record.color ?? '').trim() || 'ash',
    created: record.created ?? '',
    updated: record.updated ?? '',
  };
}

/** The signed-in owner's label definitions. Grantees see task names only. */
export async function listLabels(): Promise<TaskLabel[]> {
  const records = await pb.collection(LABELS_COLLECTION).getFullList<TaskLabel>({
    sort: 'name',
    requestKey: null,
  });

  return records.map(normalizeLabel);
}

/** Create an owner label. The facade injects the owner as `author`. */
export async function createLabel(name: string, color = 'ash'): Promise<TaskLabel> {
  const cleanName = name.trim().slice(0, 40);
  if (!cleanName) {
    throw new Error('Give the label a name.');
  }

  const record = await pb.collection(LABELS_COLLECTION).create<TaskLabel>({
    name: cleanName,
    color: color.trim() || 'ash',
  });

  return normalizeLabel(record);
}

// ── Comments ────────────────────────────────────────────────────────

/**
 * Comments use the sharing route rather than the record facade: the comments
 * collection is internal, and the route checks target access and moderation.
 * Task targets depend on the sharing backend accepting `targetType: "task"`.
 */
async function sharingCommentsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const search = new URLSearchParams(options.query ?? {});
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return pb.send<T>(`${SHARING_COMMENTS_PATH}${path}${suffix}`, {
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

export async function listTaskComments(taskId: string): Promise<TaskCommentsResult> {
  if (!taskId) {
    return { items: [], permission: '', canComment: false };
  }

  return sharingCommentsRequest<TaskCommentsResult>('', {
    query: { targetType: 'task', targetId: taskId },
  });
}

export async function createTaskComment(taskId: string, body: string): Promise<TaskComment> {
  const text = body.trim();
  if (!text) {
    throw new Error('Write a comment first.');
  }

  return sharingCommentsRequest<TaskComment>('', {
    method: 'POST',
    body: { targetType: 'task', targetId: taskId, body: text },
  });
}

export async function updateTaskComment(id: string, body: string): Promise<TaskComment> {
  const text = body.trim();
  if (!text) {
    throw new Error('Write a comment first.');
  }

  return sharingCommentsRequest<TaskComment>(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { body: text },
  });
}

export async function deleteTaskComment(id: string): Promise<void> {
  await sharingCommentsRequest<{ success?: boolean }>(`/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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
  status: TaskStatus = 'planned'
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
  _userId: string,
  onChange: () => void,
  boardId?: string
): () => void {
  let unsubscribe: (() => void) | undefined;

  void pb
    .collection(COLLECTION)
    .subscribe(
      '*',
      () => {
        // Realtime rules already scope tasks to boards owned by the caller.
        onChange();
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
