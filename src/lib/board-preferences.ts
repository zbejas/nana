import type { BoardColumn } from './boards';
import type { Task } from './tasks';

/**
 * Per-board board UI preferences and the pure rules behind every view.
 *
 * The board, list, backlog, calendar, and Gantt surfaces all consume the same
 * filtered and sorted task set. Keeping those predicates here means the views
 * cannot drift apart, and the storage format is versioned per board.
 */

export const BOARD_PREFERENCE_VERSION = 'nana.board.v1.';

export const BOARD_VIEWS = ['board', 'list', 'backlog', 'calendar', 'gantt'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

export const BOARD_SORTS = ['manual', 'priority', 'due', 'created', 'updated', 'title'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

export const FILTER_SUBJECTS = ['status', 'priority', 'assignee', 'due', 'labels'] as const;
export type FilterSubject = (typeof FILTER_SUBJECTS)[number];
export type LabelMatchMode = 'any' | 'all';

export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export interface BoardFilterState {
  status: string[];
  priority: string[];
  assignee: string[];
  due: DueFilter[];
  labels: string[];
  labelMode: LabelMatchMode;
  /** One negation toggle per subject. */
  negate: Record<FilterSubject, boolean>;
}

export interface BoardDisplayPreferences {
  priority: boolean;
  dates: boolean;
  labels: boolean;
  subtasks: boolean;
  comments: boolean;
  note: boolean;
  assignee: boolean;
}

export interface BoardPreferences {
  view: BoardView;
  sort: BoardSort;
  sortDirection: SortDirection;
  filters: BoardFilterState;
  display: BoardDisplayPreferences;
  /** Column slugs whose List view groups start collapsed. */
  collapsedListGroups: string[];
  onboardingDismissed: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_FILTERS: BoardFilterState = {
  status: [],
  priority: [],
  assignee: [],
  due: [],
  labels: [],
  labelMode: 'any',
  negate: {
    status: false,
    priority: false,
    assignee: false,
    due: false,
    labels: false,
  },
};

export const DEFAULT_DISPLAY: BoardDisplayPreferences = {
  priority: true,
  dates: true,
  labels: true,
  subtasks: true,
  comments: true,
  note: true,
  assignee: true,
};

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  view: 'board',
  sort: 'manual',
  sortDirection: 'asc',
  filters: DEFAULT_FILTERS,
  display: DEFAULT_DISPLAY,
  collapsedListGroups: [],
  onboardingDismissed: false,
};

export const PRIORITY_SORT_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  '': 4,
};

export function isBoardView(value: unknown): value is BoardView {
  return typeof value === 'string' && (BOARD_VIEWS as readonly string[]).includes(value);
}

export function isBoardSort(value: unknown): value is BoardSort {
  return typeof value === 'string' && (BOARD_SORTS as readonly string[]).includes(value);
}

export function isDueFilter(value: unknown): value is DueFilter {
  return typeof value === 'string' && (DUE_FILTERS as readonly string[]).includes(value);
}

export function boardPreferenceKey(boardId: string): string {
  return `${BOARD_PREFERENCE_VERSION}${boardId}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)))
    : [];
}

export function sanitizeBoardPreferences(value: unknown): BoardPreferences {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawFilters =
    raw.filters && typeof raw.filters === 'object' ? (raw.filters as Record<string, unknown>) : {};
  const rawNegate =
    rawFilters.negate && typeof rawFilters.negate === 'object'
      ? (rawFilters.negate as Record<string, unknown>)
      : {};
  const rawDisplay =
    raw.display && typeof raw.display === 'object' ? (raw.display as Record<string, unknown>) : {};

  return {
    view: isBoardView(raw.view) ? raw.view : DEFAULT_BOARD_PREFERENCES.view,
    sort: isBoardSort(raw.sort) ? raw.sort : DEFAULT_BOARD_PREFERENCES.sort,
    sortDirection: raw.sortDirection === 'desc' ? 'desc' : 'asc',
    filters: {
      status: stringArray(rawFilters.status),
      priority: stringArray(rawFilters.priority),
      assignee: stringArray(rawFilters.assignee),
      due: Array.isArray(rawFilters.due)
        ? Array.from(new Set(rawFilters.due.filter(isDueFilter)))
        : [],
      labels: stringArray(rawFilters.labels),
      labelMode: rawFilters.labelMode === 'all' ? 'all' : 'any',
      negate: {
        status: rawNegate.status === true,
        priority: rawNegate.priority === true,
        assignee: rawNegate.assignee === true,
        due: rawNegate.due === true,
        labels: rawNegate.labels === true,
      },
    },
    display: {
      priority: rawDisplay.priority !== false,
      dates: rawDisplay.dates !== false,
      labels: rawDisplay.labels !== false,
      subtasks: rawDisplay.subtasks !== false,
      comments: rawDisplay.comments !== false,
      note: rawDisplay.note !== false,
      assignee: rawDisplay.assignee !== false,
    },
    collapsedListGroups: stringArray(raw.collapsedListGroups),
    onboardingDismissed: raw.onboardingDismissed === true,
  };
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadBoardPreferences(
  boardId: string,
  storage: StorageLike | null = browserStorage(),
): BoardPreferences {
  if (!boardId || !storage) return DEFAULT_BOARD_PREFERENCES;

  try {
    const raw = storage.getItem(boardPreferenceKey(boardId));
    if (!raw) return DEFAULT_BOARD_PREFERENCES;
    return sanitizeBoardPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_BOARD_PREFERENCES;
  }
}

export function saveBoardPreferences(
  boardId: string,
  preferences: BoardPreferences,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!boardId || !storage) return;

  try {
    storage.setItem(boardPreferenceKey(boardId), JSON.stringify(preferences));
  } catch {
    // Storage can be full, disabled, or private mode. Preferences are an
    // enhancement; never fail a board interaction because of them.
  }
}

// ── Task numbers ────────────────────────────────────────────────────

/** `#12` for a numbered task; an empty string when the board has no number. */
export function formatTaskNumber(taskOrNumber: Pick<Task, 'task_number'> | number | null | undefined): string {
  const value =
    typeof taskOrNumber === 'number' ? taskOrNumber : taskOrNumber?.task_number;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `#${Math.trunc(value)}`
    : '';
}

// ── Dates ───────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(value: Date, weekStartsOn: 0 | 1 = 1): Date {
  const day = startOfDay(value);
  const offset = (day.getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Parse a PocketBase date or a plain `YYYY-MM-DD` as a local calendar day. */
export function parseTaskDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    return Number.isNaN(local.getTime()) ? null : local;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDay(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromIsoDay(value: string): Date | null {
  return parseTaskDate(value);
}

export function daysBetween(start: Date, end: Date): number {
  const a = startOfDay(start).getTime();
  const b = startOfDay(end).getTime();
  return Math.round((b - a) / DAY_MS);
}

export function formatShortDate(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = value instanceof Date ? value : parseTaskDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatLongDate(value: Date): string {
  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatMonthTitle(value: Date): string {
  return value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function formatDayNumber(value: Date): string {
  return String(value.getDate());
}

export function isWeekend(value: Date): boolean {
  const day = value.getDay();
  return day === 0 || day === 6;
}

/** Start and end of a task's calendar span. A missing start uses the due date. */
export function taskDateRange(task: Pick<Task, 'start_date' | 'due_date'>): {
  start: Date;
  end: Date;
} | null {
  const start = parseTaskDate(task.start_date);
  const due = parseTaskDate(task.due_date);
  if (!start && !due) return null;
  const first = start ?? due!;
  const last = due ?? start!;
  return first.getTime() <= last.getTime()
    ? { start: startOfDay(first), end: startOfDay(last) }
    : { start: startOfDay(last), end: startOfDay(first) };
}

export function taskOccursOn(
  task: Pick<Task, 'start_date' | 'due_date'>,
  day: Date,
): boolean {
  const range = taskDateRange(task);
  if (!range) return false;
  const target = startOfDay(day).getTime();
  return target >= range.start.getTime() && target <= range.end.getTime();
}

/** The 42-cell Monday-first month grid used by the calendar. */
export function monthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = startOfWeek(first, 1);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

/** Days from `start`, inclusive. */
export function enumerateDays(start: Date, count: number): Date[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(start, index));
}

export const GANTT_DAYS = 91;
export const GANTT_LOOKBACK_DAYS = 14;

/** A 91-day window with two weeks of context before today. */
export function ganttWindow(today: Date = new Date()): { start: Date; days: Date[] } {
  const start = addDays(startOfDay(today), -GANTT_LOOKBACK_DAYS);
  return { start, days: enumerateDays(start, GANTT_DAYS) };
}

export interface DateBar {
  startIndex: number;
  endIndex: number;
  /** The bar is clipped on the left by the window. */
  clippedStart: boolean;
  /** The bar is clipped on the right by the window. */
  clippedEnd: boolean;
}

export function dateBarForTask(
  task: Pick<Task, 'start_date' | 'due_date'>,
  windowStart: Date,
  dayCount: number = GANTT_DAYS,
): DateBar | null {
  const range = taskDateRange(task);
  if (!range || dayCount <= 0) return null;

  const startOffset = daysBetween(windowStart, range.start);
  const endOffset = daysBetween(windowStart, range.end);
  if (endOffset < 0 || startOffset > dayCount - 1) return null;

  return {
    startIndex: Math.max(0, startOffset),
    endIndex: Math.min(dayCount - 1, endOffset),
    clippedStart: startOffset < 0,
    clippedEnd: endOffset > dayCount - 1,
  };
}

/**
 * Move a task's dates by a whole number of days. Date-only values are written
 * back as `YYYY-MM-DD`, which PocketBase accepts and the card formatter reads
 * without a timezone shift. Missing dates stay missing unless the task has at
 * least one date to anchor the move.
 */
export function shiftTaskDates(
  task: Pick<Task, 'start_date' | 'due_date'>,
  days: number,
): { start_date: string; due_date: string } {
  const rawStart = task.start_date || '';
  const rawDue = task.due_date || '';
  const start = parseTaskDate(rawStart);
  const due = parseTaskDate(rawDue);
  return {
    start_date: start ? toIsoDay(addDays(start, days)) : rawStart,
    due_date: due ? toIsoDay(addDays(due, days)) : rawDue,
  };
}

/** Resize only the due (end) date, keeping the start fixed. */
export function resizeTaskDue(
  task: Pick<Task, 'start_date' | 'due_date'>,
  days: number,
): { start_date: string; due_date: string } {
  const due = parseTaskDate(task.due_date) ?? parseTaskDate(task.start_date);
  const start = parseTaskDate(task.start_date) ?? due;
  const movedDue = due ? addDays(due, days) : null;
  if (!movedDue) return { start_date: task.start_date || '', due_date: task.due_date || '' };
  const safeDue = start && movedDue.getTime() < start.getTime() ? start : movedDue;
  return {
    start_date: start ? toIsoDay(start) : task.start_date || '',
    due_date: toIsoDay(safeDue),
  };
}

/** Resize only the start date, clamped so it cannot pass the due date. */
export function resizeTaskStart(
  task: Pick<Task, 'start_date' | 'due_date'>,
  days: number,
): { start_date: string; due_date: string } {
  const start = parseTaskDate(task.start_date) ?? parseTaskDate(task.due_date);
  const due = parseTaskDate(task.due_date) ?? start;
  const movedStart = start ? addDays(start, days) : null;
  if (!movedStart) return { start_date: task.start_date || '', due_date: task.due_date || '' };
  const safeStart = due && movedStart.getTime() > due.getTime() ? due : movedStart;
  return {
    start_date: toIsoDay(safeStart),
    due_date: due ? toIsoDay(due) : task.due_date || '',
  };
}

// ── Due buckets and filtering ───────────────────────────────────────

export function isTaskOverdue(
  task: Pick<Task, 'due_date' | 'status'>,
  isFinal: (status: string) => boolean,
  now: Date = new Date(),
): boolean {
  if (isFinal(task.status)) return false;
  const due = parseTaskDate(task.due_date);
  if (!due) return false;
  return due.getTime() < startOfDay(now).getTime();
}

export function dueFilterMatches(
  task: Pick<Task, 'due_date'>,
  filter: DueFilter,
  now: Date = new Date(),
): boolean {
  const due = parseTaskDate(task.due_date);
  if (filter === 'none') return !due;
  if (!due) return false;

  const today = startOfDay(now);
  if (filter === 'overdue') return due.getTime() < today.getTime();
  if (filter === 'today') return sameLocalDay(due, today);

  const weekEnd = addDays(startOfWeek(today, 1), 6);
  return due.getTime() >= today.getTime() && due.getTime() <= weekEnd.getTime();
}

function matchesNegated(matched: boolean, negated: boolean): boolean {
  return negated ? !matched : matched;
}

export function filterTasks(
  tasks: Task[],
  filters: BoardFilterState,
  now: Date = new Date(),
): Task[] {
  return tasks.filter((task) => {
    if (filters.status.length > 0) {
      const matched = filters.status.includes(task.status);
      if (!matchesNegated(matched, filters.negate.status)) return false;
    }

    if (filters.priority.length > 0) {
      const bucket = task.priority || '';
      const matched = filters.priority.some((value) =>
        value === 'none' || value === 'no-priority' ? bucket === '' : bucket === value,
      );
      if (!matchesNegated(matched, filters.negate.priority)) return false;
    }

    if (filters.assignee.length > 0) {
      const bucket = task.assignee || '';
      const matched = filters.assignee.some((value) =>
        value === 'unassigned' ? bucket === '' : bucket === value,
      );
      if (!matchesNegated(matched, filters.negate.assignee)) return false;
    }

    if (filters.due.length > 0) {
      const matched = filters.due.some((value) => dueFilterMatches(task, value, now));
      if (!matchesNegated(matched, filters.negate.due)) return false;
    }

    if (filters.labels.length > 0) {
      const labels = task.labels ?? [];
      const matched =
        filters.labelMode === 'all'
          ? filters.labels.every((label) => labels.includes(label))
          : filters.labels.some((label) => labels.includes(label));
      if (!matchesNegated(matched, filters.negate.labels)) return false;
    }

    return true;
  });
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const term = query.trim().toLowerCase();
  if (!term) return tasks;

  const numberTerm = term.replace(/^#/, '');
  const wantsNumber = /^\d+$/.test(numberTerm);

  return tasks.filter((task) => {
    const haystack = `${task.title} ${task.description} ${(task.labels ?? []).join(' ')}`.toLowerCase();
    if (haystack.includes(term)) return true;
    if (wantsNumber && task.task_number === Number(numberTerm)) return true;
    if (haystack.includes(numberTerm) && term.startsWith('#')) return true;
    return false;
  });
}

export function hasActiveFilters(filters: BoardFilterState, query = ''): boolean {
  return (
    query.trim().length > 0 ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.assignee.length > 0 ||
    filters.due.length > 0 ||
    filters.labels.length > 0
  );
}

export function activeFilterCount(filters: BoardFilterState): number {
  return (
    filters.status.length +
    filters.priority.length +
    filters.assignee.length +
    filters.due.length +
    filters.labels.length
  );
}

export interface FilterChip {
  subject: FilterSubject;
  value: string;
  label: string;
  negated: boolean;
}

function priorityLabel(value: string): string {
  if (value === 'none' || value === 'no-priority') return 'No priority';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dueLabel(value: DueFilter): string {
  switch (value) {
    case 'overdue':
      return 'Overdue';
    case 'today':
      return 'Due today';
    case 'week':
      return 'Due this week';
    case 'none':
      return 'No due date';
  }
}

export function filterChips(
  filters: BoardFilterState,
  columns: Array<Pick<BoardColumn, 'slug' | 'name'>> = [],
): FilterChip[] {
  const labelForStatus = (value: string) => {
    const column = columns.find((candidate) => candidate.slug === value);
    if (column?.name) return column.name;
    if (value === 'planned') return 'Planned';
    if (value === 'archived') return 'Archived';
    return value;
  };

  const chips: FilterChip[] = [];
  for (const value of filters.status) {
    chips.push({
      subject: 'status',
      value,
      label: labelForStatus(value),
      negated: filters.negate.status,
    });
  }
  for (const value of filters.priority) {
    chips.push({
      subject: 'priority',
      value,
      label: priorityLabel(value),
      negated: filters.negate.priority,
    });
  }
  for (const value of filters.assignee) {
    chips.push({
      subject: 'assignee',
      value,
      label: value === 'unassigned' ? 'Unassigned' : value,
      negated: filters.negate.assignee,
    });
  }
  for (const value of filters.due) {
    chips.push({
      subject: 'due',
      value,
      label: dueLabel(value),
      negated: filters.negate.due,
    });
  }
  for (const value of filters.labels) {
    chips.push({
      subject: 'labels',
      value,
      label: value,
      negated: filters.negate.labels,
    });
  }
  return chips;
}

export function removeFilterValue(
  filters: BoardFilterState,
  subject: FilterSubject,
  value: string,
): BoardFilterState {
  if (subject === 'due') {
    return {
      ...filters,
      due: filters.due.filter((entry) => entry !== value),
    };
  }

  const current = filters[subject];
  if (!Array.isArray(current)) return filters;
  return {
    ...filters,
    [subject]: current.filter((entry) => entry !== value),
  };
}

// ── Sorting ─────────────────────────────────────────────────────────

export function compareTasks(
  a: Task,
  b: Task,
  sort: BoardSort,
  direction: SortDirection = 'asc',
): number {
  const flip = direction === 'desc' ? -1 : 1;
  let result = 0;

  if (sort === 'priority') {
    result = (PRIORITY_SORT_ORDER[a.priority || ''] ?? 4) - (PRIORITY_SORT_ORDER[b.priority || ''] ?? 4);
  } else if (sort === 'due') {
    const aDue = parseTaskDate(a.due_date);
    const bDue = parseTaskDate(b.due_date);
    if (!aDue && !bDue) result = 0;
    else if (!aDue) return 1;
    else if (!bDue) return -1;
    else result = aDue.getTime() - bDue.getTime();
  } else if (sort === 'created') {
    result = (a.created || '').localeCompare(b.created || '');
  } else if (sort === 'updated') {
    result = (a.updated || '').localeCompare(b.updated || '');
  } else if (sort === 'title') {
    result = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
  }

  if (result === 0) {
    result = a.board_order - b.board_order || (a.created || '').localeCompare(b.created || '');
  }

  return result * flip;
}

export function sortTasks(
  tasks: Task[],
  sort: BoardSort,
  direction: SortDirection = 'asc',
): Task[] {
  if (sort === 'manual') {
    return [...tasks].sort(
      (a, b) => a.board_order - b.board_order || (a.created || '').localeCompare(b.created || ''),
    );
  }
  return [...tasks].sort((a, b) => compareTasks(a, b, sort, direction));
}

export interface FilterOptions {
  columns: Array<Pick<BoardColumn, 'slug' | 'name' | 'is_final'>>;
  members: Array<{ id: string; name?: string | null }>;
  labels: Array<{ name: string }>;
}

/**
 * A board can only reorder by drag when the task order is the stored manual
 * order and no filter/search hides neighbours.
 */
export function canDragTasks(
  preferences: Pick<BoardPreferences, 'sort' | 'filters'>,
  query: string,
): boolean {
  return preferences.sort === 'manual' && !hasActiveFilters(preferences.filters, query);
}

export function taskGroupLabel(status: string, columns: Array<Pick<BoardColumn, 'slug' | 'name'>>): string {
  const column = columns.find((candidate) => candidate.slug === status);
  if (column?.name) return column.name;
  if (status === 'planned') return 'Planned';
  if (status === 'archived') return 'Archived';
  return status;
}
