import { CalendarDaysIcon, DocumentTextIcon } from '@heroicons/react/20/solid';
import type { DragEvent, KeyboardEvent } from 'react';
import type { Task } from '../../lib/tasks';
import { plainTextExcerpt } from '../../lib/tasks';
import { cn } from '../ui';
import { priorityTextClass, PRIORITY_LABELS } from './board-config';

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
  const due = dueMeta(task.due_date, task.status === 'done');
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
        'group relative cursor-grab overflow-hidden rounded-[10px] border border-line bg-surface px-3 py-2.5 text-left shadow-[0_1px_0_0_rgb(255_236_210/0.03)_inset] transition-all duration-150 hover:border-line-strong hover:bg-surface-raised active:cursor-grabbing',
        isDragging && 'opacity-35',
        task.status === 'done' && 'bg-surface/60'
      )}
    >
      {task.priority && (
        <span
          className={cn(
            'absolute bottom-2.5 left-0 top-2.5 w-[2px] rounded-full',
            task.status === 'done' ? 'bg-line-strong' : '',
            task.status !== 'done' && task.priority === 'urgent' && 'bg-danger',
            task.status !== 'done' && task.priority === 'high' && 'bg-ember',
            task.status !== 'done' && task.priority === 'medium' && 'bg-brass',
            task.status !== 'done' && task.priority === 'low' && 'bg-ink-muted/60'
          )}
          aria-hidden="true"
        />
      )}

      <div className="flex items-start gap-2">
        <h3
          className={cn(
            'min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink',
            task.status === 'done' && 'text-ink-secondary'
          )}
        >
          {task.title || 'Untitled task'}
        </h3>
      </div>

      {excerpt && (
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-muted">{excerpt}</p>
      )}

      {hasMeta && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px]">
          {task.priority && (
            <span
              className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.08em]',
                task.status === 'done' ? 'text-ink-muted' : priorityTextClass(task.priority)
              )}
            >
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}
          {due && (
            <span className={cn('inline-flex items-center gap-1', due.overdue ? 'font-medium text-danger' : 'text-ink-muted')}>
              <CalendarDaysIcon className="h-3 w-3" aria-hidden="true" />
              {due.label}
            </span>
          )}
          {linkedTitle && (
            <span className="inline-flex min-w-0 items-center gap-1 text-ink-muted" title={`From note: ${linkedTitle}`}>
              <DocumentTextIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="max-w-[9rem] truncate">{linkedTitle}</span>
            </span>
          )}
          {task.labels.slice(0, 2).map((label) => (
            <span key={label} className="rounded border border-line px-1.5 py-px text-[10px] leading-4 text-ink-muted">
              {label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
