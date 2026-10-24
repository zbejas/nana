import type { TaskPriority, TaskStatus } from '../../lib/tasks';

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
