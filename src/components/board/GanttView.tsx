import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDaysIcon,
  QueueListIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task } from '../../lib/tasks';
import {
  addDays,
  dateBarForTask,
  formatShortDate,
  ganttWindow,
  isWeekend,
  parseTaskDate,
  resizeTaskDue,
  resizeTaskStart,
  sameLocalDay,
  shiftTaskDates,
  startOfDay,
  toIsoDay,
} from '../../lib/board-preferences';
import { Button, SidePanel, cn } from '../ui';
import { useIsMobile } from './TaskQuickPickers';
import { columnDotClass } from './board-config';

interface GanttViewProps {
  tasks: Task[];
  columns: BoardColumn[];
  onOpenTask: (task: Task) => void;
  onUpdateDates: (task: Task, patch: { start_date: string; due_date: string }) => Promise<void>;
  canEdit?: boolean;
}

type DragMode = 'move' | 'start' | 'end';

interface DragState {
  task: Task;
  mode: DragMode;
  startX: number;
  startY: number;
  deltaDays: number;
  moved: boolean;
  preview: { start_date: string; due_date: string };
}

export function GanttView({ tasks, columns, onOpenTask, onUpdateDates, canEdit = true }: GanttViewProps) {
  const isMobile = useIsMobile();
  const dayWidth = isMobile ? 28 : 24;
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [railVisible, setRailVisible] = useState(!isMobile);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [labelPosition, setLabelPosition] = useState({ x: 0, y: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!isMobile) {
      setRailVisible(true);
    } else {
      setRailVisible(false);
    }
  }, [isMobile]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(startOfDay(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const { start, days } = useMemo(() => ganttWindow(today), [today]);
  const totalWidth = days.length * dayWidth;
  const finalSlugs = new Set(columns.filter((column) => column.is_final).map((column) => column.slug));

  const bars = useMemo(
    () =>
      tasks
        .map((task) => ({ task, bar: dateBarForTask(task, start, days.length) }))
        .filter((entry): entry is { task: Task; bar: NonNullable<typeof entry.bar> } => Boolean(entry.bar))
        .sort(
          (a, b) =>
            a.bar.startIndex - b.bar.startIndex ||
            (a.task.title || '').localeCompare(b.task.title || ''),
        ),
    [days.length, start, tasks],
  );

  const unscheduled = useMemo(
    () => tasks.filter((task) => !parseTaskDate(task.start_date) && !parseTaskDate(task.due_date)),
    [tasks],
  );

  const monthGroups = useMemo(() => {
    const groups: Array<{ label: string; count: number; key: string }> = [];
    for (const day of days) {
      const key = `${day.getFullYear()}-${day.getMonth()}`;
      const last = groups.at(-1);
      if (last?.key === key) {
        last.count += 1;
      } else {
        groups.push({
          key,
          count: 1,
          label: day.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
        });
      }
    }
    return groups;
  }, [days]);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    if (!drag) return;

    const handleMove = (event: PointerEvent) => {
      event.preventDefault();
      const current = dragRef.current;
      if (!current) return;
      const delta = Math.round((event.clientX - current.startX) / dayWidth);
      let preview = current.preview;
      if (current.mode === 'move') preview = shiftTaskDates(current.task, delta);
      else if (current.mode === 'start') preview = resizeTaskStart(current.task, delta);
      else preview = resizeTaskDue(current.task, delta);

      setLabelPosition({ x: event.clientX, y: event.clientY });
      setDrag((value) =>
        value
          ? {
              ...value,
              deltaDays: delta,
              moved:
                value.moved ||
                Math.abs(event.clientX - value.startX) > 3 ||
                Math.abs(event.clientY - value.startY) > 3,
              preview,
            }
          : value,
      );
    };

    const handleUp = () => {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      if (!current.moved) {
        onOpenTask(current.task);
        return;
      }
      if (current.deltaDays === 0) return;
      setBusyId(current.task.id);
      void onUpdateDates(current.task, current.preview)
        .catch(() => {
          // The board shell already announced the failure and reloads.
        })
        .finally(() => setBusyId(null));
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrag(null);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
  }, [dayWidth, drag, onOpenTask, onUpdateDates]);

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    task: Task,
    mode: DragMode,
    preview: { start_date: string; due_date: string },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) {
      onOpenTask(task);
      return;
    }
    setLabelPosition({ x: event.clientX, y: event.clientY });
    setDrag({
      task,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      deltaDays: 0,
      moved: false,
      preview,
    });
  };

  const handleBarKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    task: Task,
  ) => {
    if (!canEdit || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const next = event.shiftKey
      ? resizeTaskDue(task, delta)
      : shiftTaskDates(task, delta);
    void onUpdateDates(task, next).catch(() => {
      // The board shell already announced the failure and reloads.
    });
  };

  const todayIndex = days.findIndex((day) => sameLocalDay(day, today));

  return (
    <div className="board-gantt min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-11 md:h-8 md:hidden"
            icon={<QueueListIcon />}
            aria-pressed={railVisible}
            onClick={() => setRailVisible((value) => !value)}
          >
            Tasks
          </Button>
          <span className="text-[11.5px] tabular-nums text-ink-muted">
            {formatShortDate(start)} – {formatShortDate(addDays(start, days.length - 1))} · 91 days
          </span>
          <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-ink-muted md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
            Today
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="h-11 md:h-8 lg:hidden"
            icon={<CalendarDaysIcon />}
            onClick={() => setUnscheduledOpen(true)}
          >
            Unscheduled {unscheduled.length}
          </Button>
        </div>

        <div className="board-gantt scrollbar-autohide">
          <div className="board-gantt-scroll">
            <div style={{ minWidth: totalWidth + (railVisible ? 280 : 0) }}>
              <div className="board-gantt-header">
                {railVisible && <div className="board-gantt-rail-head">Task</div>}
                <div className="board-gantt-timeline-head" style={{ width: totalWidth }}>
                  <div className="flex h-6">
                    {monthGroups.map((group) => (
                      <div
                        key={group.key}
                        className="border-b border-r border-line px-1.5 text-[10.5px] font-semibold leading-6 text-ink-secondary"
                        style={{ width: group.count * dayWidth }}
                      >
                        {group.label}
                      </div>
                    ))}
                  </div>
                  <div className="flex h-6">
                    {days.map((day) => (
                      <div
                        key={toIsoDay(day)}
                        className={cn(
                          'flex flex-col items-center justify-center border-r border-line text-[9px] leading-none text-ink-muted',
                          isWeekend(day) && 'bg-surface-sunken/60',
                          sameLocalDay(day, today) && 'bg-signal-soft font-semibold text-signal',
                        )}
                        style={{ width: dayWidth }}
                      >
                        <span>{day.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                        <span className="mt-0.5 tabular-nums">{day.getDate()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="board-gantt-body">
                {bars.length === 0 ? (
                  <div className="flex min-h-40 items-center justify-center px-6 text-center text-[12px] text-ink-muted">
                    No scheduled tasks in this range. Add a start or due date to one.
                  </div>
                ) : (
                  bars.map(({ task, bar }) => {
                    const column = columns.find((candidate) => candidate.slug === task.status);
                    const previewBar =
                      drag?.task.id === task.id
                        ? dateBarForTask(
                            { start_date: drag.preview.start_date, due_date: drag.preview.due_date },
                            start,
                            days.length,
                          )
                        : null;
                    const shown = previewBar ?? bar;
                    const single = shown.startIndex === shown.endIndex;
                    const left = single
                      ? shown.startIndex * dayWidth + 7
                      : shown.startIndex * dayWidth;
                    const width = single
                      ? Math.max(10, dayWidth - 14)
                      : Math.max(dayWidth, (shown.endIndex - shown.startIndex + 1) * dayWidth);
                    const final = finalSlugs.has(task.status);

                    return (
                      <div key={task.id} className="board-gantt-row" data-gantt-row={task.id}>
                        {railVisible && (
                          <div className="board-gantt-rail">
                            <span
                              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', columnDotClass(column?.color))}
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              onClick={() => onOpenTask(task)}
                              className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-ink-secondary hover:text-ink"
                              title={task.title || 'Untitled task'}
                            >
                              {task.title || 'Untitled task'}
                            </button>
                            <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
                              {formatShortDate(task.due_date)}
                            </span>
                          </div>
                        )}
                        <div
                          className="board-gantt-track"
                          style={{ width: totalWidth }}
                        >
                          {days.map((day, index) =>
                            isWeekend(day) ? (
                              <div
                                key={`weekend-${index}`}
                                className="board-gantt-weekend"
                                style={{ left: index * dayWidth, width: dayWidth }}
                                aria-hidden="true"
                              />
                            ) : null,
                          )}
                          {todayIndex >= 0 && (
                            <div
                              className="board-gantt-today"
                              style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
                              aria-hidden="true"
                            />
                          )}
                          <button
                            type="button"
                            draggable={false}
                            aria-label={`${task.title || 'Untitled task'}, ${formatShortDate(task.start_date || task.due_date)} to ${formatShortDate(task.due_date || task.start_date)}. Arrow keys move, Shift plus arrow resizes.`}
                            onPointerDown={(event) =>
                              beginDrag(event, task, 'move', {
                                start_date: task.start_date,
                                due_date: task.due_date,
                              })
                            }
                            onKeyDown={(event) => handleBarKey(event, task)}
                            data-final={final || undefined}
                            data-single={single || undefined}
                            className={cn(
                              'board-gantt-bar',
                              busyId === task.id && 'opacity-60',
                              shown.clippedStart && 'rounded-l-none',
                              shown.clippedEnd && 'rounded-r-none',
                            )}
                            style={{ left, width }}
                            title={`${task.title || 'Untitled task'} · ${formatShortDate(task.start_date || task.due_date)} → ${formatShortDate(task.due_date || task.start_date)}`}
                          >
                            {!single && (
                              <span className="pointer-events-none relative z-[1] block truncate">
                                {task.title || 'Untitled task'}
                              </span>
                            )}
                            {canEdit && (
                              <>
                                <span
                                  className="board-gantt-handle"
                                  data-side="start"
                                  onPointerDown={(event) =>
                                    beginDrag(event, task, 'start', {
                                      start_date: task.start_date,
                                      due_date: task.due_date,
                                    })
                                  }
                                />
                                <span
                                  className="board-gantt-handle"
                                  data-side="end"
                                  onPointerDown={(event) =>
                                    beginDrag(event, task, 'end', {
                                      start_date: task.start_date,
                                      due_date: task.due_date,
                                    })
                                  }
                                />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="hidden w-64 shrink-0 flex-col rounded-panel border border-line bg-surface lg:flex">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <h3 className="text-[12.5px] font-semibold text-ink">Unscheduled</h3>
          <span className="text-[11px] tabular-nums text-ink-muted">{unscheduled.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 scrollbar-autohide">
          {unscheduled.length === 0 ? (
            <p className="px-2 py-5 text-center text-[11.5px] leading-relaxed text-ink-muted">
              Every task has a date.
            </p>
          ) : (
            unscheduled.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                className="flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden="true" />
                <span className="truncate">{task.title || 'Untitled task'}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {drag && (
        <div
          className="board-gantt-date-label"
          style={{ left: labelPosition.x, top: labelPosition.y }}
        >
          {formatShortDate(drag.preview.start_date || drag.preview.due_date)} →{' '}
          {formatShortDate(drag.preview.due_date || drag.preview.start_date)}
        </div>
      )}

      <SidePanel
        open={unscheduledOpen}
        onClose={() => setUnscheduledOpen(false)}
        title="Unscheduled tasks"
        description="Add a start or due date to place a task on the timeline."
        width="md"
      >
        <div className="space-y-1">
          {unscheduled.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-ink-muted">Every task has a date.</p>
          ) : (
            unscheduled.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  setUnscheduledOpen(false);
                  onOpenTask(task);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-control border border-transparent px-2 py-2 text-left text-[12.5px] text-ink-secondary hover:border-line hover:bg-surface-sunken hover:text-ink"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden="true" />
                <span className="truncate">{task.title || 'Untitled task'}</span>
              </button>
            ))
          )}
        </div>
      </SidePanel>
    </div>
  );
}
