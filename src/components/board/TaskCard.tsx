import { useRef, type DragEvent, type MouseEvent, type TouchEvent } from 'react';
import {
  CalendarDaysIcon,
  ChatBubbleLeftIcon,
  CheckIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
} from '@heroicons/react/20/solid';
import type { Task } from '../../lib/tasks';
import {
  formatShortDate,
  formatTaskNumber,
  isTaskOverdue,
  parseTaskDate,
  type BoardDisplayPreferences,
} from '../../lib/board-preferences';
import { Avatar, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import {
  PRIORITY_CODES,
  PRIORITY_LABELS,
  defaultLabelColor,
  labelColorMap,
  labelDotClass,
  type BoardLabel,
  type QuickField,
} from './board-config';

interface TaskCardProps {
  task: Task;
  index: number;
  isDone: boolean;
  selected: boolean;
  selectionMode: boolean;
  draggable: boolean;
  isDragging: boolean;
  display: BoardDisplayPreferences;
  labels?: BoardLabel[];
  members?: BoardMember[];
  onOpen: () => void;
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  onMenu: (anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (field: QuickField, anchor: DOMRect) => void;
  onOpenNote?: (documentId: string) => void;
  onLongPress?: (anchor: DOMRect) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (index: number) => void;
}

function taskExtras(task: Task): {
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
} {
  const extras = task as Task & {
    subtask_count?: number;
    subtask_done_count?: number;
    comment_count?: number;
  };
  return {
    subtaskTotal:
      typeof extras.subtask_count === 'number' && extras.subtask_count > 0
        ? extras.subtask_count
        : 0,
    subtaskDone:
      typeof extras.subtask_done_count === 'number' ? extras.subtask_done_count : 0,
    commentCount:
      typeof extras.comment_count === 'number' && extras.comment_count > 0
        ? extras.comment_count
        : 0,
  };
}

export function TaskCard({
  task,
  index,
  isDone,
  selected,
  selectionMode,
  draggable,
  isDragging,
  display,
  labels = [],
  members = [],
  onOpen,
  onSelect,
  onMenu,
  onQuickPick,
  onOpenNote,
  onLongPress,
  onDragStart,
  onDragEnd,
  onDragOver,
}: TaskCardProps) {
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const number = formatTaskNumber(task);
  const due = parseTaskDate(task.due_date);
  const start = parseTaskDate(task.start_date);
  const overdue = isTaskOverdue(task, () => isDone);
  const assignee = task.expand?.assignee;
  const member =
    members.find((candidate) => candidate.id === task.assignee) ??
    (assignee
      ? { id: assignee.id, name: assignee.name || 'Member', avatar: assignee.avatar }
      : null);
  const linkedNote = task.expand?.document;
  const extras = taskExtras(task);
  const colorMap = labelColorMap(labels);
  const visibleLabels = display.labels ? task.labels.slice(0, 2) : [];
  const extraLabelCount = display.labels ? Math.max(0, task.labels.length - 2) : 0;
  const hasMeta =
    (display.priority && Boolean(task.priority)) ||
    (display.dates && Boolean(start || due)) ||
    visibleLabels.length > 0 ||
    (display.subtasks && extras.subtaskTotal > 0) ||
    (display.comments && extras.commentCount > 0) ||
    (display.note && Boolean(linkedNote)) ||
    (display.assignee && Boolean(member));

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || !onLongPress) return;
    const touch = event.touches.item(0);
    if (!touch) return;
    touchOrigin.current = { x: touch.clientX, y: touch.clientY };
    longPressTriggered.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      const origin = touchOrigin.current;
      if (!origin) return;
      longPressTriggered.current = true;
      onLongPress(
        new DOMRect(origin.x, origin.y, 0, 0),
      );
    }, 480);
  };

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    const origin = touchOrigin.current;
    const touch = event.touches.item(0);
    if (!origin || !touch) return;
    if (Math.abs(touch.clientX - origin.x) > 10 || Math.abs(touch.clientY - origin.y) > 10) {
      clearLongPress();
    }
  };

  const handleTouchEnd = () => {
    clearLongPress();
    touchOrigin.current = null;
  };

  const handleOpenClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      onSelect(event);
      return;
    }
    onOpen();
  };

  const pick = (field: QuickField, element: HTMLElement) => {
    onQuickPick(field, element.getBoundingClientRect());
  };

  return (
    <article
      data-task-id={task.id}
      data-selected={selected || undefined}
      data-dragging={isDragging || undefined}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/nana-task', task.id);
        onDragStart(event);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        onDragOver(after ? index + 1 : index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(new DOMRect(event.clientX, event.clientY, 0, 0));
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className={cn('board-card', draggable ? 'cursor-grab' : 'cursor-default')}
    >
      <button
        type="button"
        data-task-open
        onClick={handleOpenClick}
        aria-label={`Open ${number ? `${number} ` : ''}${task.title || 'Untitled task'}`}
        className="board-card-open"
      />

      <div className="board-card-content px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10.5px] font-medium tabular-nums text-ink-muted">
              {selectionMode && (
                <span
                  className={cn(
                    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                    selected
                      ? 'border-signal bg-signal-bright text-on-signal'
                      : 'border-line-strong bg-surface',
                  )}
                  aria-hidden="true"
                >
                  {selected && <CheckIcon className="h-3 w-3" />}
                </span>
              )}
              {number && <span className="shrink-0">{number}</span>}
              {task.status === 'archived' && <span className="shrink-0">Archived</span>}
              {task.status === 'planned' && <span className="shrink-0">Planned</span>}
            </div>

            <h3
              className={cn(
                'mt-1 line-clamp-2 break-words text-[13px] font-medium leading-[1.35] tracking-[-0.005em] text-ink',
                isDone && 'text-ink-muted line-through decoration-ink-muted/50',
              )}
            >
              {task.title || 'Untitled task'}
            </h3>
          </div>

          <button
            type="button"
            aria-label="Task actions"
            onClick={(event) => {
              event.stopPropagation();
              onMenu(event.currentTarget.getBoundingClientRect());
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:h-7 md:w-7"
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
        </div>

        {hasMeta && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-ink-muted">
            {display.priority && task.priority && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  pick('priority', event.currentTarget);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={`Priority: ${PRIORITY_LABELS[task.priority]}`}
                className="inline-flex h-5 shrink-0 items-center rounded-[4px] border border-line bg-surface-sunken px-1.5 font-medium tabular-nums text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
              >
                {PRIORITY_CODES[task.priority]}
              </button>
            )}

            {display.dates && (start || due) && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  pick('due', event.currentTarget);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={start && due ? `Starts ${formatShortDate(start)} · due ${formatShortDate(due)}` : 'Change dates'}
                className={cn(
                  'inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-0.5 tabular-nums transition-colors hover:text-ink',
                  overdue && 'font-medium text-danger',
                )}
              >
                <CalendarDaysIcon className="h-3 w-3" aria-hidden="true" />
                {start && due ? (
                  <span>
                    {formatShortDate(start)}–{formatShortDate(due)}
                  </span>
                ) : (
                  <span>{formatShortDate(due ?? start)}</span>
                )}
              </button>
            )}

            {display.labels && task.labels.length > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  pick('labels', event.currentTarget);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={`Labels: ${task.labels.join(', ')}`}
                className="flex min-w-0 items-center gap-1.5 rounded-[4px] transition-colors hover:text-ink"
              >
                {visibleLabels.map((label) => (
                  <span key={label} className="inline-flex min-w-0 items-center gap-1">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        labelDotClass(colorMap.get(label) ?? defaultLabelColor(label)),
                      )}
                      aria-hidden="true"
                    />
                    <span className="max-w-[5.5rem] truncate">{label}</span>
                  </span>
                ))}
                {extraLabelCount > 0 && <span className="shrink-0 tabular-nums">+{extraLabelCount}</span>}
              </button>
            )}

            {display.subtasks && extras.subtaskTotal > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title="Subtasks complete">
                <CheckIcon className="h-3 w-3" aria-hidden="true" />
                {extras.subtaskDone}/{extras.subtaskTotal}
              </span>
            )}

            {display.comments && extras.commentCount > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 tabular-nums" title="Comments">
                <ChatBubbleLeftIcon className="h-3 w-3" aria-hidden="true" />
                {extras.commentCount}
              </span>
            )}

            {display.note && linkedNote && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenNote?.(linkedNote.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={`From note: ${linkedNote.title || 'Untitled'}`}
                className="inline-flex min-w-0 items-center gap-1 rounded-[4px] transition-colors hover:text-ink"
              >
                <DocumentTextIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="max-w-[7rem] truncate">{linkedNote.title || 'Linked note'}</span>
              </button>
            )}

            {display.assignee && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  pick('assignee', event.currentTarget);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={member ? `Assigned to ${member.name}` : 'Assign task'}
                className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {member ? (
                  <Avatar src={member.avatar} name={member.name} size="sm" className="h-5 w-5 text-[9px]" />
                ) : (
                  <PlusIcon className="h-3 w-3" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
