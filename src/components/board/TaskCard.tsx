import { CalendarDaysIcon, DocumentTextIcon } from '@heroicons/react/20/solid';
import type { DragEvent, KeyboardEvent } from 'react';
import type { Task } from '../../lib/tasks';
import { plainTextExcerpt } from '../../lib/tasks';
import { cn } from '../ui';
import { PRIORITY_CODES, PRIORITY_LABELS } from './board-config';

interface TaskCardProps {
  task: Task;
  index: number;
  isDragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (index: number) => void;
}

function dueMeta(value: string, done: boolean): { label: string; overdue: boolean } | null {
  if (!value) return null;

  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const overdue = !done && due.getTime() < endOfToday.getTime();

  const label = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(due.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });

  return { label, overdue };
}

export function TaskCard({
  task,
  index,
  isDragging,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: TaskCardProps) {
  const isDone = task.status === 'done';
  const due = dueMeta(task.due_date, isDone);
  const excerpt = plainTextExcerpt(task.description ?? '');
  const linkedTitle = task.expand?.document?.title;
  const hasMeta = Boolean(due) || Boolean(linkedTitle) || task.labels.length > 0 || Boolean(task.priority);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        onDragOver(after ? index + 1 : index);
      }}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open task ${task.title}`}
      className={cn(
        'group w-full border-b border-line px-2 py-2.5 text-left transition-colors duration-150 hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        isDragging && 'opacity-40'
      )}
    >
      <h3
        className={cn(
          'min-w-0 truncate text-[14px] font-medium leading-snug text-ink',
          isDone && 'text-ink-muted line-through'
        )}
      >
        {task.title || 'Untitled task'}
      </h3>

      {excerpt && (
        <p
          className={cn(
            'mt-1 truncate text-[12px] leading-relaxed text-ink-muted',
            isDone && 'text-ink-muted/80'
          )}
        >
          {excerpt}
        </p>
      )}

      {hasMeta && (
        <div className="mt-1.5 flex min-w-0 items-center gap-x-2.5 gap-y-1 overflow-hidden font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
          {task.priority && (
            <span className="shrink-0 tabular-nums" title={PRIORITY_LABELS[task.priority]}>
              {PRIORITY_CODES[task.priority]}
            </span>
          )}
          {due && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1',
                due.overdue && 'font-medium text-danger'
              )}
            >
              <CalendarDaysIcon className="h-3 w-3" aria-hidden="true" />
              {due.label}
            </span>
          )}
          {linkedTitle && (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={`From note: ${linkedTitle}`}
            >
              <DocumentTextIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="max-w-[8rem] truncate normal-case tracking-normal">{linkedTitle}</span>
            </span>
          )}
          {task.labels.slice(0, 2).map((label) => (
            <span key={label} className="max-w-[6rem] shrink-0 truncate normal-case tracking-normal">
              {label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
