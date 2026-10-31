import type { TaskPriority, TaskStatus } from '../../lib/tasks';

/**
 * Legacy four-column fallback.
 *
 * New boards use `board_columns`; this list remains for the public reader when
 * a cached share predates workflow columns and for the fallback composer.
 */
export interface BoardColumn {
  status: TaskStatus;
  index: string;
  label: string;
  hint: string;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { status: 'backlog', index: '01', label: 'Backlog', hint: 'Someday, unsorted' },
  { status: 'next', index: '02', label: 'Next up', hint: 'Committed, not started' },
  { status: 'progress', index: '03', label: 'In progress', hint: 'Actively moving' },
  { status: 'done', index: '04', label: 'Done', hint: 'Finished work' },
];

export const PRIORITIES: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** Ledger shorthand: urgent is P0, low is P3. */
export const PRIORITY_CODES: Record<TaskPriority, string> = {
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
};

export type ColumnColor = 'muted' | 'ink' | 'signal' | 'warning' | 'success' | 'danger';

/** The palette a `board_columns.color` value can use. */
export const COLUMN_COLORS: Array<{ value: ColumnColor; label: string }> = [
  { value: 'muted', label: 'Ash' },
  { value: 'ink', label: 'Ink' },
  { value: 'signal', label: 'Ember' },
  { value: 'warning', label: 'Amber' },
  { value: 'success', label: 'Moss' },
  { value: 'danger', label: 'Clay' },
];

export function normalizeColumnColor(value: string | null | undefined): ColumnColor {
  return COLUMN_COLORS.some((color) => color.value === value)
    ? (value as ColumnColor)
    : 'muted';
}

export function columnDotClass(value: string | null | undefined): string {
  switch (normalizeColumnColor(value)) {
    case 'ink':
      return 'bg-ink';
    case 'signal':
      return 'bg-signal';
    case 'warning':
      return 'bg-warning';
    case 'success':
      return 'bg-success';
    case 'danger':
      return 'bg-danger';
    default:
      return 'bg-ink-muted';
  }
}

/** Workflow icons understood by the column editor and lane header. */
export const COLUMN_ICONS = [
  'dot',
  'inbox',
  'queue',
  'bolt',
  'check',
  'flag',
  'pause',
  'play',
  'review',
  'archive',
] as const;

export type ColumnIcon = (typeof COLUMN_ICONS)[number];

export const COLUMN_ICON_LABELS: Record<ColumnIcon, string> = {
  dot: 'Dot',
  inbox: 'Inbox',
  queue: 'Queue',
  bolt: 'Bolt',
  check: 'Check',
  flag: 'Flag',
  pause: 'Pause',
  play: 'Play',
  review: 'Review',
  archive: 'Archive',
};

export function normalizeColumnIcon(value: string | null | undefined): ColumnIcon {
  return COLUMN_ICONS.includes(value as ColumnIcon) ? (value as ColumnIcon) : 'dot';
}

/** A property that can be changed straight from a card or row. */
export type QuickField = 'status' | 'priority' | 'assignee' | 'due' | 'labels';

export type LabelColor = 'ash' | 'slate' | 'graphite' | 'ink' | 'amber' | 'moss' | 'clay';

/** Spec label palette. Ember is deliberately not a label colour. */
export const LABEL_COLORS: Array<{ value: LabelColor; label: string }> = [
  { value: 'ash', label: 'Ash' },
  { value: 'slate', label: 'Slate' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'ink', label: 'Ink' },
  { value: 'amber', label: 'Amber' },
  { value: 'moss', label: 'Moss' },
  { value: 'clay', label: 'Clay' },
];

export interface BoardLabel {
  id: string;
  name: string;
  color: string;
}

export function normalizeLabelColor(value: string | null | undefined): LabelColor {
  return LABEL_COLORS.some((color) => color.value === value)
    ? (value as LabelColor)
    : 'ash';
}

export function labelDotClass(value: string | null | undefined): string {
  switch (normalizeLabelColor(value)) {
    case 'slate':
      return 'bg-ink-secondary';
    case 'graphite':
      return 'bg-surface-raised border border-line-strong';
    case 'ink':
      return 'bg-ink';
    case 'amber':
      return 'bg-warning';
    case 'moss':
      return 'bg-success';
    case 'clay':
      return 'bg-signal';
    default:
      return 'bg-ink-muted';
  }
}

/** Stable colour for a task label when the owner has not defined one yet. */
export function defaultLabelColor(name: string): LabelColor {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length]!.value;
}

export function labelColorMap(labels: BoardLabel[]): Map<string, string> {
  return new Map(labels.map((label) => [label.name, label.color]));
}
