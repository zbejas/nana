import { useMemo, useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import type { BoardColumn } from '../../lib/boards';
import type { Task } from '../../lib/tasks';
import {
  addDays,
  enumerateDays,
  formatMonthTitle,
  formatShortDate,
  monthGridDays,
  parseTaskDate,
  sameLocalDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  taskDateRange,
  taskOccursOn,
  toIsoDay,
} from '../../lib/board-preferences';
import { Button, IconButton, MenuItem, MenuSurface, SidePanel, cn } from '../ui';
import { useIsMobile } from './TaskQuickPickers';
import { columnDotClass } from './board-config';

interface CalendarViewProps {
  tasks: Task[];
  columns: BoardColumn[];
  onOpenTask: (task: Task) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

export function CalendarView({ tasks, columns, onOpenTask }: CalendarViewProps) {
  const isMobile = useIsMobile();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const today = startOfDay(new Date());
  const finalSlugs = new Set(columns.filter((column) => column.is_final).map((column) => column.slug));
  const days = useMemo(
    () => monthGridDays(visibleMonth.getFullYear(), visibleMonth.getMonth()),
    [visibleMonth],
  );
  const [more, setMore] = useState<{ anchor: DOMRect; tasks: Task[]; day: Date } | null>(null);

  const unscheduled = useMemo(
    () => tasks.filter((task) => !parseTaskDate(task.due_date) && !parseTaskDate(task.start_date)),
    [tasks],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const day of days) {
      map.set(
        toIsoDay(day),
        tasks.filter((task) => taskOccursOn(task, day)),
      );
    }
    return map;
  }, [days, tasks]);

  const agenda = useMemo(() => {
    const groups: Array<{ day: Date; tasks: Task[] }> = [];
    const month = visibleMonth.getMonth();
    const year = visibleMonth.getFullYear();
    for (const task of tasks) {
      const range = taskDateRange(task);
      if (!range) continue;
      const day = range.end;
      if (day.getFullYear() !== year || day.getMonth() !== month) continue;
      const key = toIsoDay(day);
      let group = groups.find((entry) => toIsoDay(entry.day) === key);
      if (!group) {
        group = { day, tasks: [] };
        groups.push(group);
      }
      group.tasks.push(task);
    }
    return groups.sort((a, b) => a.day.getTime() - b.day.getTime());
  }, [tasks, visibleMonth]);

  const lanes = isMobile ? 2 : 3;
  const monthLabel = formatMonthTitle(visibleMonth);

  const moveMonth = (delta: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  return (
    <div className="board-calendar min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous month"
            size="sm"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            label="Next month"
            size="sm"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={() => moveMonth(1)}
          >
            <ChevronRightIcon />
          </IconButton>
          <Button
            variant="secondary"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => setVisibleMonth(startOfMonth(new Date()))}
          >
            Today
          </Button>
        </div>
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">{monthLabel}</h2>
        <span className="text-[11.5px] tabular-nums text-ink-muted">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} in view
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="hidden h-8 md:inline-flex lg:hidden"
            onClick={() => setUnscheduledOpen(true)}
          >
            Unscheduled {unscheduled.length}
          </Button>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
            Today
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 flex-1">
          <div className="board-calendar-grid">
            {WEEKDAYS.map((label) => (
              <div key={label} className="board-calendar-weekday">
                {label}
              </div>
            ))}

            {days.map((day) => {
              const dayTasks = byDay.get(toIsoDay(day)) ?? [];
              const visible = dayTasks.slice(0, lanes);
              const moreTasks = dayTasks.slice(lanes);
              const isToday = sameLocalDay(day, today);
              const outside = day.getMonth() !== visibleMonth.getMonth();
              return (
                <div
                  key={toIsoDay(day)}
                  className="board-calendar-cell"
                  data-outside={outside || undefined}
                  data-today={isToday || undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className="board-calendar-day" data-today={isToday || undefined}>
                      {day.getDate()}
                    </span>
                    {dayTasks.length > lanes && (
                      <span className="text-[9.5px] tabular-nums text-ink-muted">{dayTasks.length}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    {visible.map((task) => {
                      const range = taskDateRange(task);
                      const isStart = !range || sameLocalDay(day, range.start) || day.getDay() === 1;
                      const isEnd = !range || sameLocalDay(day, range.end) || day.getDay() === 0;
                      const column = columns.find((candidate) => candidate.slug === task.status);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onOpenTask(task)}
                          data-start={isStart || undefined}
                          data-end={isEnd || undefined}
                          data-final={finalSlugs.has(task.status) || undefined}
                          title={`${task.title || 'Untitled task'} · ${column?.name ?? task.status}`}
                          className="board-calendar-entry"
                        >
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', columnDotClass(column?.color))}
                            aria-hidden="true"
                          />
                          <span className="truncate">{task.title || 'Untitled task'}</span>
                        </button>
                      );
                    })}
                    {moreTasks.length > 0 && (
                      <button
                        type="button"
                        className="board-calendar-more"
                        onClick={(event) =>
                          setMore({
                            anchor: event.currentTarget.getBoundingClientRect(),
                            tasks: moreTasks,
                            day,
                          })
                        }
                      >
                        +{moreTasks.length} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 md:hidden">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[12.5px] font-semibold text-ink">Agenda</h3>
                <p className="text-[10.5px] text-ink-muted">This week</p>
              </div>
              <button
                type="button"
                onClick={() => setUnscheduledOpen(true)}
                className="inline-flex h-11 items-center rounded-control border border-line bg-surface px-3 text-[11.5px] font-medium text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                Unscheduled {unscheduled.length}
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 rounded-control border border-line bg-surface-sunken p-1">
              {enumerateDays(startOfWeek(today, 1), 7).map((date) => {
                const active = sameLocalDay(date, today);
                return (
                  <div
                    key={toIsoDay(date)}
                    className={cn(
                      'flex h-11 flex-col items-center justify-center rounded-[4px] text-[10.5px] text-ink-muted',
                      active && 'bg-signal-bright font-medium text-on-signal',
                    )}
                  >
                    <span>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                    <span className="tabular-nums">{date.getDate()}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 space-y-2">
              {agenda.length === 0 ? (
                <p className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-[12px] text-ink-muted">
                  Nothing scheduled this month.
                </p>
              ) : (
                agenda.map((group) => (
                  <section
                    key={toIsoDay(group.day)}
                    className="rounded-panel border border-line bg-surface p-3"
                  >
                    <h4 className="text-[11.5px] font-semibold text-ink-secondary">
                      {group.day.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </h4>
                    <div className="mt-2 space-y-1">
                      {group.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onOpenTask(task)}
                          className="flex min-h-9 w-full items-center gap-2 rounded-control px-1.5 text-left text-[12px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                        >
                          <CalendarDaysIcon className="h-3.5 w-3.5 text-ink-muted" />
                          <span className="truncate">{task.title || 'Untitled task'}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}
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
      </div>

      <MenuSurface
        open={more !== null}
        onClose={() => setMore(null)}
        ariaLabel="More tasks for this day"
        position={
          more
            ? {
                left: Math.min(more.anchor.left, Math.max(8, window.innerWidth - 256)),
                top: Math.min(more.anchor.bottom + 4, window.innerHeight - 280),
              }
            : { left: 0, top: 0 }
        }
        className="w-[15rem]"
      >
        {more && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">
              {more.day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {more.tasks.length} more
            </p>
            {more.tasks.map((task) => (
              <MenuItem
                key={task.id}
                label={task.title || 'Untitled task'}
                hint={formatShortDate(task.due_date)}
                onClick={() => {
                  setMore(null);
                  onOpenTask(task);
                }}
              />
            ))}
          </div>
        )}
      </MenuSurface>

      <SidePanel
        open={unscheduledOpen}
        onClose={() => setUnscheduledOpen(false)}
        title="Unscheduled tasks"
        description="Add a due date from the task panel to place a task on the calendar."
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

/** Exposed for tests: the day key used by the calendar grid. */
export function calendarDayKey(date: Date): string {
  return toIsoDay(date);
}

/** Exposed for tests: the month label the header renders. */
export function calendarMonthLabel(date: Date): string {
  return formatMonthTitle(date);
}

/** Exposed for tests: the agenda month membership rule. */
export function agendaDayInMonth(value: string | Date, month: Date): boolean {
  const date = value instanceof Date ? value : parseTaskDate(value);
  return Boolean(date && monthKey(date) === monthKey(month));
}
