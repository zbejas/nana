import type { BoardColumn } from '../../lib/boards';
import type {
  CreateTaskRelationData,
  Task,
  TaskActivity,
  TaskPriority,
  TaskRecurrence,
  TaskRelation,
  TaskStatus,
} from '../../lib/tasks';
import { statusLabel } from '../../lib/tasks';
import { PRIORITY_LABELS } from './board-config';

export type TaskStatusColor = 'muted' | 'warning' | 'signal' | 'success' | 'danger' | string;

export interface TaskStatusOption {
  value: TaskStatus;
  label: string;
  isFinal: boolean;
  color: TaskStatusColor;
}

const STATUS_COLOR_CLASS: Record<string, string> = {
  muted: 'bg-ink-muted',
  warning: 'bg-warning',
  signal: 'bg-signal',
  success: 'bg-success',
  danger: 'bg-danger',
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Every selectable task status: real workflow columns, then the two virtual ones. */
export function taskStatusOptions(columns: ReadonlyArray<BoardColumn>): TaskStatusOption[] {
  const real = columns.map((column) => ({
    value: column.slug,
    label: column.name || statusLabel(column.slug, columns),
    isFinal: column.is_final === true,
    color: column.color || (column.is_final ? 'success' : 'muted'),
  }));

  return [
    ...real,
    { value: 'planned', label: 'Planned', isFinal: false, color: 'muted' },
    { value: 'archived', label: 'Archived', isFinal: false, color: 'muted' },
  ];
}

export function statusOption(
  status: TaskStatus,
  columns: ReadonlyArray<BoardColumn>
): TaskStatusOption {
  return (
    taskStatusOptions(columns).find((option) => option.value === status) ?? {
      value: status,
      label: statusLabel(status, columns),
      isFinal: false,
      color: 'muted',
    }
  );
}

export function isFinalStatus(status: TaskStatus, columns: ReadonlyArray<BoardColumn>): boolean {
  return columns.some((column) => column.slug === status && column.is_final === true);
}

/** The status dot is the lane's only permanent colour. */
export function statusDotClass(status: TaskStatus, columns: ReadonlyArray<BoardColumn>): string {
  if (status === 'planned' || status === 'archived') return 'bg-ink-muted';

  const column = columns.find((candidate) => candidate.slug === status);
  if (!column) return 'bg-ink-muted';
  if (column.color && STATUS_COLOR_CLASS[column.color]) return STATUS_COLOR_CLASS[column.color]!;
  return column.is_final ? 'bg-success' : 'bg-ink-muted';
}

export function firstOpenStatus(columns: ReadonlyArray<BoardColumn>): TaskStatus {
  return columns.find((column) => !column.is_final)?.slug ?? 'planned';
}

export function firstFinalStatus(columns: ReadonlyArray<BoardColumn>): TaskStatus | null {
  return columns.find((column) => column.is_final)?.slug ?? null;
}

/**
 * Subtasks complete into the first final column. Unchecking returns them to the
 * first open column, unless the parent is still in the planned backlog.
 */
export function subtaskStatusTarget(
  checked: boolean,
  columns: ReadonlyArray<BoardColumn>,
  parentStatus: TaskStatus
): TaskStatus | null {
  if (checked) return firstFinalStatus(columns);
  if (parentStatus === 'planned') return 'planned';
  return firstOpenStatus(columns);
}

export function formatTaskNumber(value: number | undefined | null): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `#${value}` : '';
}

export function normalizeTaskTitle(value: string): string {
  return value.trim() || 'Untitled task';
}

export function priorityLabel(priority: TaskPriority | '' | undefined): string {
  return priority ? PRIORITY_LABELS[priority] ?? priority : 'No priority';
}

// ── Dates ───────────────────────────────────────────────────────────

/** `YYYY-MM-DD` from a PocketBase date string. */
export function dateInputValue(value: string | null | undefined): string {
  const match = DATE_ONLY.exec(value ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseDateInput(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateInputFor(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateInput(now = new Date()): string {
  return dateInputFor(now);
}

export function tomorrowDateInput(now = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return dateInputFor(next);
}

/** PocketBase date fields expect a timestamp; Nana stores date-only values at UTC midnight. */
export function dateStorageValue(value: string | null | undefined): string {
  const date = dateInputValue(value ?? '');
  return date ? `${date} 00:00:00.000Z` : '';
}

export function formatDateLabel(value: string | null | undefined, now = new Date()): string {
  const date = parseDateInput(dateInputValue(value ?? ''));
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function isDateOverdue(value: string | null | undefined, now = new Date()): boolean {
  const date = dateInputValue(value ?? '');
  return Boolean(date && date < todayDateInput(now));
}

/** Monday-first six-week grid for the compact date popover. */
export function buildMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const weekday = first.getDay() === 0 ? 7 : first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - (weekday - 1));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

// ── Relations ───────────────────────────────────────────────────────

export type RelationPickerType = 'blocks' | 'blocked-by' | 'related';

export interface RelationEntry {
  relation: TaskRelation;
  task: Task | undefined;
}

export interface TaskRelationGroups {
  blocks: RelationEntry[];
  blockedBy: RelationEntry[];
  related: RelationEntry[];
}

/**
 * Split edges into the three inspector groups. Subtask edges belong to the
 * subtask section, not the relation groups.
 */
export function relationGroups(
  relations: ReadonlyArray<TaskRelation>,
  taskId: string,
  boardTasks: ReadonlyArray<Task> = []
): TaskRelationGroups {
  const groups: TaskRelationGroups = { blocks: [], blockedBy: [], related: [] };
  const byId = new Map(boardTasks.map((task) => [task.id, task]));
  const resolve = (id: string, expanded?: Task) => byId.get(id) ?? expanded;

  for (const relation of relations) {
    if (relation.type === 'subtask') continue;

    if (relation.type === 'blocks') {
      if (relation.source === taskId) {
        groups.blocks.push({
          relation,
          task: resolve(relation.target, relation.expand?.target),
        });
      } else if (relation.target === taskId) {
        groups.blockedBy.push({
          relation,
          task: resolve(relation.source, relation.expand?.source),
        });
      }
      continue;
    }

    if (relation.type === 'related') {
      if (relation.source === taskId) {
        groups.related.push({
          relation,
          task: resolve(relation.target, relation.expand?.target),
        });
      } else if (relation.target === taskId) {
        groups.related.push({
          relation,
          task: resolve(relation.source, relation.expand?.source),
        });
      }
    }
  }

  return groups;
}

export function relationPickerLabel(type: RelationPickerType): string {
  if (type === 'blocked-by') return 'Blocked by';
  if (type === 'blocks') return 'Blocks';
  return 'Related';
}

/** Directed edge payload for the picker's three relationship directions. */
export function relationPayload(
  type: RelationPickerType,
  taskId: string,
  targetId: string
): CreateTaskRelationData {
  if (type === 'blocked-by') {
    return { source: targetId, target: taskId, type: 'blocks' };
  }
  return {
    source: taskId,
    target: targetId,
    type: type === 'related' ? 'related' : 'blocks',
  };
}

export function subtaskEntries(
  relations: ReadonlyArray<TaskRelation>,
  taskId: string,
  boardTasks: ReadonlyArray<Task>
): Task[] {
  const byId = new Map(boardTasks.map((task) => [task.id, task]));
  return relations
    .filter((relation) => relation.type === 'subtask' && relation.source === taskId)
    .map((relation) => byId.get(relation.target) ?? relation.expand?.target)
    .filter((task): task is Task => Boolean(task && task.id !== taskId));
}

/** A task that is the target of a subtask edge is itself a subtask. */
export function isSubtaskTask(
  relations: ReadonlyArray<TaskRelation>,
  taskId: string
): boolean {
  return relations.some((relation) => relation.type === 'subtask' && relation.target === taskId);
}

// ── Recurrence ──────────────────────────────────────────────────────

const RECURRENCE_LABEL: Record<TaskRecurrence['frequency'], string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const RECURRENCE_UNIT: Record<TaskRecurrence['frequency'], string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

export function formatRecurrenceLabel(recurrence: TaskRecurrence | null | undefined): string {
  if (!recurrence) return 'Does not repeat';
  const interval = Math.max(1, Math.trunc(recurrence.interval || 1));
  if (interval === 1) return RECURRENCE_LABEL[recurrence.frequency];
  const unit = RECURRENCE_UNIT[recurrence.frequency];
  return `Every ${interval} ${unit}${interval === 1 ? '' : 's'}`;
}

/** Singular unit used by the interval stepper. */
export function recurrenceUnit(frequency: TaskRecurrence['frequency']): string {
  return RECURRENCE_UNIT[frequency];
}

// ── Labels ──────────────────────────────────────────────────────────

export const LABEL_COLOR_OPTIONS = [
  { value: 'ash', label: 'Ash' },
  { value: 'slate', label: 'Slate' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'ink', label: 'Ink' },
  { value: 'amber', label: 'Amber' },
  { value: 'moss', label: 'Moss' },
  { value: 'clay', label: 'Clay' },
] as const;

const LABEL_TONE_CLASS: Record<string, string> = {
  ash: 'task-label-dot--ash',
  slate: 'task-label-dot--slate',
  graphite: 'task-label-dot--graphite',
  ink: 'task-label-dot--ink',
  amber: 'task-label-dot--amber',
  moss: 'task-label-dot--moss',
  clay: 'task-label-dot--clay',
  // Seeded legacy colours map onto the Graphite palette rather than inventing
  // new accent families.
  stone: 'task-label-dot--ash',
  lavender: 'task-label-dot--slate',
  sage: 'task-label-dot--moss',
  forest: 'task-label-dot--moss',
  terracotta: 'task-label-dot--clay',
  rose: 'task-label-dot--clay',
  crimson: 'task-label-dot--clay',
  ocean: 'task-label-dot--slate',
  sky: 'task-label-dot--slate',
  lagoon: 'task-label-dot--moss',
  orchid: 'task-label-dot--slate',
};

export function labelToneClass(color: string | undefined): string {
  return LABEL_TONE_CLASS[(color ?? '').toLowerCase()] ?? 'task-label-dot--ash';
}

// ── Activity ────────────────────────────────────────────────────────

export interface ActivityActor {
  name: string;
  isAi: boolean;
  isSystem: boolean;
  avatar?: string;
}

export function activityActor(activity: TaskActivity): ActivityActor {
  const label = (activity.actor_label ?? '').trim();
  if (activity.actor_type === 'ai' || label === 'Nana') {
    return { name: 'Nana', isAi: true, isSystem: false };
  }
  if (activity.actor_type === 'system' || !label) {
    return { name: label || 'System', isAi: false, isSystem: true };
  }
  return {
    name: activity.expand?.actor?.name || label || 'Someone',
    isAi: false,
    isSystem: false,
    avatar: activity.expand?.actor?.avatar,
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function activitySentence(
  activity: TaskActivity,
  columns: ReadonlyArray<BoardColumn>
): string {
  const data = activity.data ?? {};
  const to = stringValue(data.to);
  const from = stringValue(data.from);

  switch (activity.type) {
    case 'created':
      return 'created this task';
    case 'title_changed':
      return 'renamed this task';
    case 'status_changed':
      return to ? `moved this to ${statusLabel(to, columns)}` : 'changed the status';
    case 'priority_changed':
      return to ? `set priority to ${priorityLabel(to as TaskPriority)}` : 'cleared the priority';
    case 'due_date_changed':
      return to
        ? `set the due date to ${formatDateLabel(to)}`
        : 'cleared the due date';
    case 'start_date_changed':
      return from || to
        ? to
          ? `set the start date to ${formatDateLabel(to)}`
          : 'cleared the start date'
        : 'changed the start date';
    case 'assignee_changed':
      return to ? 'changed the assignee' : 'unassigned this task';
    case 'document_changed':
      return to ? 'linked a note' : 'removed the linked note';
    case 'labels_changed':
      return 'updated the labels';
    case 'description_changed':
      return 'updated the description';
    case 'recurrence_changed':
      return to ? 'changed the repeat rule' : 'stopped repeating this task';
    case 'comment':
      return 'commented';
    default:
      return activity.type.replace(/_/g, ' ') || 'updated this task';
  }
}

// ── Permissions ─────────────────────────────────────────────────────

export const COMMENT_VIEW_ONLY_COPY =
  'You have view access. Ask the owner for comment access.';

/**
 * A false hint or a false server answer hides the composer. Otherwise the prop
 * or server permission wins, with `canEdit` as the pre-load fallback.
 */
export function canUseCommentComposer(
  propCanComment: boolean | undefined,
  serverCanComment: boolean | undefined,
  canEdit: boolean
): boolean {
  if (propCanComment === false) return false;
  if (serverCanComment === false) return false;
  if (propCanComment === true) return true;
  if (serverCanComment === true) return true;
  return canEdit;
}

// ── Property summaries ──────────────────────────────────────────────

export type PropertyTone = 'default' | 'muted' | 'warning' | 'danger' | 'success';

export interface TaskPropertySummary {
  key: 'status' | 'priority' | 'assignee' | 'start' | 'due' | 'labels' | 'note' | 'recurrence';
  label: string;
  value: string;
  tone: PropertyTone;
}

/** A non-interactive summary used by tests and compact surfaces. */
export function taskPropertySummary(
  task: Task,
  columns: ReadonlyArray<BoardColumn>
): TaskPropertySummary[] {
  const done = isFinalStatus(task.status, columns);
  const due = formatDateLabel(task.due_date);
  const assignee = task.expand?.assignee?.name || '';

  return [
    {
      key: 'status',
      label: 'Status',
      value: statusLabel(task.status, columns),
      tone: done ? 'success' : 'default',
    },
    { key: 'priority', label: 'Priority', value: priorityLabel(task.priority), tone: 'default' },
    { key: 'assignee', label: 'Assignee', value: assignee || 'Unassigned', tone: 'muted' },
    {
      key: 'start',
      label: 'Start',
      value: formatDateLabel(task.start_date) || 'No start date',
      tone: 'muted',
    },
    {
      key: 'due',
      label: 'Due',
      value: due || 'No due date',
      tone: isDateOverdue(task.due_date) && !done ? 'danger' : 'muted',
    },
    {
      key: 'labels',
      label: 'Labels',
      value: task.labels.length > 0 ? task.labels.join(', ') : 'No labels',
      tone: task.labels.length > 0 ? 'default' : 'muted',
    },
    {
      key: 'note',
      label: 'Linked note',
      value: task.expand?.document?.title || 'No linked note',
      tone: task.expand?.document ? 'default' : 'muted',
    },
    {
      key: 'recurrence',
      label: 'Repeat',
      value: formatRecurrenceLabel(task.recurrence),
      tone: task.recurrence ? 'default' : 'muted',
    },
  ];
}
