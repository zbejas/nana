import type { TaskPriority, TaskStatus } from '../../lib/tasks';

export interface BoardColumn {
  status: TaskStatus;
  label: string;
  hint: string;
  tone: 'muted' | 'brass' | 'ember' | 'sage';
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { status: 'backlog', label: 'Backlog', hint: 'Someday, unsorted', tone: 'muted' },
  { status: 'next', label: 'Next up', hint: 'Committed, not started', tone: 'brass' },
  { status: 'progress', label: 'In progress', hint: 'Actively moving', tone: 'ember' },
  { status: 'done', label: 'Done', hint: 'Finished work', tone: 'sage' },
];

export const PRIORITIES: Array<{ value: TaskPriority; label: string; tone: 'neutral' | 'brass' | 'ember' | 'danger' }> = [
  { value: 'low', label: 'Low', tone: 'neutral' },
  { value: 'medium', label: 'Medium', tone: 'brass' },
  { value: 'high', label: 'High', tone: 'ember' },
  { value: 'urgent', label: 'Urgent', tone: 'danger' },
];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function columnToneClass(tone: BoardColumn['tone']): string {
  switch (tone) {
    case 'brass':
      return 'bg-brass';
    case 'ember':
      return 'bg-ember';
    case 'sage':
      return 'bg-sage';
    default:
      return 'bg-ink-muted';
  }
}

export function priorityTextClass(priority: TaskPriority | ''): string {
  switch (priority) {
    case 'urgent':
      return 'text-danger';
    case 'high':
      return 'text-ember';
    case 'medium':
      return 'text-brass';
    case 'low':
      return 'text-ink-muted';
    default:
      return 'text-ink-muted';
  }
}
