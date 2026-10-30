import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  PlusIcon,
  UserCircleIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, TaskPriority, UpdateTaskData } from '../../lib/tasks';
import {
  addDays,
  formatShortDate,
  parseTaskDate,
  toIsoDay,
} from '../../lib/board-preferences';
import { Avatar, Button, Input, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import {
  PRIORITIES,
  columnDotClass,
  defaultLabelColor,
  labelDotClass,
  type BoardLabel,
  type QuickField,
} from './board-config';

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [breakpoint]);

  return isMobile;
}

export function menuPositionFromRect(
  rect: DOMRect | { left: number; right: number; top: number; bottom: number },
  options: { width?: number; height?: number; gap?: number } = {},
): CSSProperties {
  const width = options.width ?? 240;
  const height = options.height ?? 360;
  const gap = options.gap ?? 6;
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const preferBelow = rect.bottom + height + gap < viewportHeight;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
  const top = preferBelow
    ? Math.max(8, rect.bottom + gap)
    : Math.max(8, rect.top - height - gap);

  return { left, top, width };
}

interface TaskPickerBodyProps {
  section: QuickField;
  task: Task;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  onBack?: () => void;
  onUpdate: (patch: UpdateTaskData) => Promise<void>;
  onClose: () => void;
  onCreateLabel: (name: string) => Promise<BoardLabel | null>;
}

function PickerHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-2.5 pb-2 pt-1.5">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
      )}
      <p className="text-[11.5px] font-semibold text-ink-secondary">{title}</p>
    </div>
  );
}

function OptionButton({
  children,
  active,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40',
        active && 'bg-surface-sunken text-ink',
      )}
    >
      {children}
      {active && <CheckIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-signal" />}
    </button>
  );
}

function statusLabel(status: string, columns: BoardColumn[]): string {
  const column = columns.find((candidate) => candidate.slug === status);
  if (column) return column.name;
  if (status === 'planned') return 'Planned';
  if (status === 'archived') return 'Archived';
  return status;
}

export function TaskPickerBody({
  section,
  task,
  columns,
  members,
  labels,
  onBack,
  onUpdate,
  onClose,
  onCreateLabel,
}: TaskPickerBodyProps) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>(task.labels ?? []);
  const [labelQuery, setLabelQuery] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const [dueValue, setDueValue] = useState(task.due_date ? toIsoDay(parseTaskDate(task.due_date) ?? new Date()) : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedLabels(task.labels ?? []);
    setDueValue(task.due_date ? toIsoDay(parseTaskDate(task.due_date) ?? new Date()) : '');
  }, [task.id, task.labels, task.due_date]);

  const definitionNames = useMemo(() => new Set(labels.map((label) => label.name)), [labels]);
  const orphanLabels = selectedLabels.filter((label) => !definitionNames.has(label));

  const apply = async (patch: UpdateTaskData, close = true) => {
    setBusy(true);
    try {
      await onUpdate(patch);
      if (close) onClose();
    } catch {
      // The board shell already announced the failure; keep the picker open so
      // the user can retry or choose another value.
    } finally {
      setBusy(false);
    }
  };

  const title =
    section === 'status'
      ? 'Status'
      : section === 'priority'
        ? 'Priority'
        : section === 'assignee'
          ? 'Assignee'
          : section === 'due'
            ? 'Dates'
            : 'Labels';

  return (
    <div>
      <PickerHeader title={title} onBack={onBack} />
      <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5 scrollbar-autohide">
        {section === 'status' && (
          <>
            {columns.map((column) => (
              <OptionButton
                key={column.slug}
                active={task.status === column.slug}
                disabled={busy}
                onClick={() => void apply({ status: column.slug })}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', columnDotClass(column.color))} />
                <span className="min-w-0 flex-1 truncate">{column.name}</span>
                {column.is_final && <span className="text-[10.5px] text-ink-muted">Final</span>}
              </OptionButton>
            ))}
            <OptionButton
              active={task.status === 'planned'}
              disabled={busy}
              onClick={() => void apply({ status: 'planned' })}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              Planned
            </OptionButton>
            <OptionButton
              active={task.status === 'archived'}
              disabled={busy}
              onClick={() => void apply({ status: 'archived' })}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              Archived
            </OptionButton>
          </>
        )}

        {section === 'priority' && (
          <>
            <OptionButton
              active={!task.priority}
              disabled={busy}
              onClick={() => void apply({ priority: '' })}
            >
              <span className="h-3.5 w-3.5" />
              No priority
            </OptionButton>
            {PRIORITIES.map((priority) => (
              <OptionButton
                key={priority.value}
                active={task.priority === priority.value}
                disabled={busy}
                onClick={() => void apply({ priority: priority.value as TaskPriority })}
              >
                <span className="h-3.5 w-3.5" />
                {priority.label}
              </OptionButton>
            ))}
          </>
        )}

        {section === 'assignee' && (
          <>
            <OptionButton
              active={!task.assignee}
              disabled={busy}
              onClick={() => void apply({ assignee: '' })}
            >
              <UserCircleIcon className="h-4 w-4 text-ink-muted" />
              Unassigned
            </OptionButton>
            {members.length === 0 && (
              <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-muted">
                No other people yet. Share the board to add someone.
              </p>
            )}
            {members.map((member) => (
              <OptionButton
                key={member.id}
                active={task.assignee === member.id}
                disabled={busy}
                onClick={() => void apply({ assignee: member.id })}
              >
                <Avatar src={member.avatar} name={member.name} size="sm" className="h-5 w-5 text-[9px]" />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
              </OptionButton>
            ))}
          </>
        )}

        {section === 'due' && (
          <div className="space-y-1.5 p-0.5">
            {[
              { label: 'Today', days: 0 },
              { label: 'Tomorrow', days: 1 },
              { label: 'In 3 days', days: 3 },
              { label: 'Next week', days: 7 },
            ].map((option) => (
              <OptionButton
                key={option.label}
                disabled={busy}
                onClick={() => {
                  const nextDue = addDays(new Date(), option.days);
                  const existingStart = parseTaskDate(task.start_date);
                  const start =
                    existingStart && existingStart.getTime() <= nextDue.getTime()
                      ? task.start_date
                      : toIsoDay(nextDue);
                  void apply({
                    due_date: toIsoDay(nextDue),
                    ...(existingStart ? { start_date: start } : { start_date: toIsoDay(nextDue) }),
                  });
                }}
              >
                <CalendarDaysIcon className="h-3.5 w-3.5 text-ink-muted" />
                {option.label}
              </OptionButton>
            ))}
            <OptionButton
              disabled={busy}
              onClick={() => void apply({ start_date: '', due_date: '' })}
            >
              <span className="h-3.5 w-3.5" />
              No dates
            </OptionButton>
            <form
              className="mt-2 flex items-center gap-1.5 border-t border-line pt-2"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const nextDue = parseTaskDate(dueValue);
                const existingStart = parseTaskDate(task.start_date);
                void apply({
                  due_date: dueValue,
                  ...(existingStart
                    ? {
                        start_date:
                          nextDue && existingStart.getTime() > nextDue.getTime()
                            ? dueValue
                            : task.start_date,
                      }
                    : { start_date: dueValue }),
                });
              }}
            >
              <Input
                type="date"
                value={dueValue}
                onChange={(event) => setDueValue(event.target.value)}
                aria-label="Due date"
                className="h-8 px-2 text-[12px]"
              />
              <Button type="submit" size="sm" variant="secondary" className="h-8 shrink-0" disabled={!dueValue || busy}>
                Set
              </Button>
            </form>
            {task.start_date && task.due_date && (
              <p className="px-1 pt-1 text-[10.5px] text-ink-muted">
                {formatShortDate(task.start_date)} → {formatShortDate(task.due_date)}
              </p>
            )}
          </div>
        )}

        {section === 'labels' && (
          <div className="space-y-1">
            {orphanLabels.map((name) => {
              const selected = selectedLabels.includes(name);
              return (
                <OptionButton
                  key={name}
                  active={selected}
                  disabled={busy}
                  onClick={() => {
                    const next = selected
                      ? selectedLabels.filter((label) => label !== name)
                      : [...selectedLabels, name];
                    setSelectedLabels(next);
                    void apply({ labels: next }, false);
                  }}
                >
                  <span className={cn('h-2 w-2 rounded-full', labelDotClass(defaultLabelColor(name)))} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </OptionButton>
              );
            })}
            {labels.map((label) => {
              const selected = selectedLabels.includes(label.name);
              return (
                <OptionButton
                  key={label.id}
                  active={selected}
                  disabled={busy}
                  onClick={() => {
                    const next = selected
                      ? selectedLabels.filter((name) => name !== label.name)
                      : [...selectedLabels, label.name];
                    setSelectedLabels(next);
                    void apply({ labels: next }, false);
                  }}
                >
                  <span className={cn('h-2 w-2 rounded-full', labelDotClass(label.color))} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </OptionButton>
              );
            })}

            <form
              className="flex items-center gap-1.5 border-t border-line px-1 pb-1 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                const name = labelQuery.trim();
                if (!name || labelBusy) return;
                setLabelBusy(true);
                void onCreateLabel(name)
                  .then((created) => {
                    if (!created) return;
                    const next = selectedLabels.includes(created.name)
                      ? selectedLabels
                      : [...selectedLabels, created.name];
                    setSelectedLabels(next);
                    setLabelQuery('');
                    return apply({ labels: next }, false);
                  })
                  .catch(() => {
                    // The label may already exist for another owner, or the
                    // board may not allow owner definitions. The menu stays open.
                  })
                  .finally(() => setLabelBusy(false));
              }}
            >
              <Input
                value={labelQuery}
                onChange={(event) => setLabelQuery(event.target.value)}
                placeholder="New label"
                aria-label="New label name"
                maxLength={40}
                className="h-8 px-2 text-[12px]"
              />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0"
                icon={<PlusIcon />}
                disabled={!labelQuery.trim() || labelBusy}
              >
                Add
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
