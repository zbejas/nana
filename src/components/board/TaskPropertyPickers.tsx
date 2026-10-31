import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  UserCircleIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import {
  createLabel as createLabelRecord,
  type TaskLabel,
  type TaskPriority,
  type TaskRecurrence,
} from '../../lib/tasks';
import { searchShareUsers } from '../../lib/sharing';
import { Avatar, Button, IconButton, Input, cn } from '../ui';
import { PRIORITY_CODES, PRIORITY_LABELS } from './board-config';
import {
  LABEL_COLOR_OPTIONS,
  buildMonthGrid,
  dateInputFor,
  dateInputValue,
  formatDateLabel,
  labelToneClass,
  recurrenceUnit,
  taskStatusOptions,
  todayDateInput,
  tomorrowDateInput,
  type TaskStatusOption,
} from './task-panel-model';

export interface AssigneeOption {
  id: string;
  name: string;
  avatar?: string;
}

interface TaskPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
}

/**
 * A compact, fixed popover anchored to a property control. It lives outside the
 * panel's scroll container so it never stretches the inspector, and it owns
 * Escape/outside-close and focus restoration for its own layer.
 */
export function TaskPopover({
  open,
  onClose,
  anchorRef,
  label,
  children,
  align = 'start',
  width = 320,
  className,
}: TaskPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const previousFocus = document.activeElement as HTMLElement | null;

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const nextWidth = Math.max(240, Math.min(width, window.innerWidth - 24));
      let left = align === 'end' ? rect.right - nextWidth : rect.left;
      left = Math.max(12, Math.min(left, window.innerWidth - nextWidth - 12));
      const openUp = rect.bottom + 320 > window.innerHeight && rect.top > 320;
      setPosition(
        openUp
          ? { left, width: nextWidth, bottom: window.innerHeight - rect.top + 6 }
          : { left, width: nextWidth, top: rect.bottom + 6 }
      );
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    const frame = window.requestAnimationFrame(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>('input,button:not([disabled])');
      target?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, anchorRef, align, width]);

  if (!open || !position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      data-panel-popover
      role="dialog"
      aria-label={label}
      className={cn(
        'task-popover fixed z-[1100] overflow-y-auto overscroll-contain rounded-panel border border-line bg-surface-raised p-2 shadow-float outline-none',
        className
      )}
      style={{
        left: position.left,
        width: position.width,
        ...(position.top === undefined ? { bottom: position.bottom } : { top: position.top }),
        maxHeight: 'min(30rem, calc(100dvh - 24px))',
        animation: 'task-popover-in 140ms cubic-bezier(0.22, 1, 0.36, 1) both',
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function PopoverLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">{children}</p>;
}

export function PopoverEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-4 text-center text-[12px] leading-relaxed text-ink-muted">{children}</p>
  );
}

export function PopoverAction({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors disabled:pointer-events-none disabled:opacity-45',
        danger
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
        '[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function ChoiceRow({
  selected,
  onClick,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex min-h-9 w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors',
        selected
          ? 'bg-signal-soft text-ink'
          : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
      )}
    >
      {children}
      {selected && <CheckIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-signal" />}
    </button>
  );
}

export function StatusMenu({
  value,
  columns,
  onSelect,
}: {
  value: string;
  columns: ReadonlyArray<BoardColumn>;
  onSelect: (status: string) => void;
}) {
  const options = taskStatusOptions(columns);
  let dividerShown = false;

  return (
    <div role="menu" aria-label="Status">
      {options.map((option) => {
        const virtual = option.value === 'planned' || option.value === 'archived';
        const showDivider = virtual && !dividerShown;
        if (showDivider) dividerShown = true;
        return (
          <div key={option.value}>
            {showDivider && <div className="my-1 border-t border-line" role="separator" />}
            <ChoiceRow selected={option.value === value} onClick={() => onSelect(option.value)}>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', statusOptionDot(option))} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.isFinal && <span className="text-[10.5px] text-ink-muted">Final</span>}
            </ChoiceRow>
          </div>
        );
      })}
    </div>
  );
}

function statusOptionDot(option: TaskStatusOption): string {
  return option.color === 'success'
    ? 'bg-success'
    : option.color === 'warning'
      ? 'bg-warning'
      : option.color === 'signal'
        ? 'bg-signal'
        : 'bg-ink-muted';
}

export function PriorityMenu({
  value,
  onSelect,
}: {
  value: TaskPriority | '';
  onSelect: (priority: TaskPriority | '') => void;
}) {
  return (
    <div role="menu" aria-label="Priority">
      <ChoiceRow selected={value === ''} onClick={() => onSelect('')}>
        <span className="h-2 w-2 shrink-0 rounded-full border border-line-strong" aria-hidden="true" />
        <span className="min-w-0 flex-1">No priority</span>
      </ChoiceRow>
      <div className="my-1 border-t border-line" role="separator" />
      {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((priority) => (
        <ChoiceRow key={priority} selected={value === priority} onClick={() => onSelect(priority)}>
          <span className="w-5 shrink-0 text-[10.5px] font-semibold tabular-nums text-ink-muted">
            {PRIORITY_CODES[priority]}
          </span>
          <span className="min-w-0 flex-1">{PRIORITY_LABELS[priority]}</span>
        </ChoiceRow>
      ))}
    </div>
  );
}

export function AssigneeMenu({
  assignedId,
  members,
  canSearch,
  onSelect,
}: {
  assignedId: string;
  members: AssigneeOption[];
  canSearch: boolean;
  onSelect: (member: AssigneeOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssigneeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (!canSearch) return;
    const needle = query.trim();
    if (!needle) {
      sequence.current += 1;
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    const current = ++sequence.current;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void searchShareUsers(needle)
        .then((response) => {
          if (current !== sequence.current) return;
          setResults(response.items.map(toAssigneeOption));
        })
        .catch((searchError) => {
          if (current !== sequence.current) return;
          setError(searchError instanceof Error ? searchError.message : 'Could not search people.');
        })
        .finally(() => {
          if (current === sequence.current) setSearching(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, canSearch]);

  const merged = new Map<string, AssigneeOption>();
  for (const member of [...members, ...results]) merged.set(member.id, member);

  return (
    <div>
      <div className="px-1 pb-1.5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          icon={<MagnifyingGlassIcon />}
          placeholder={canSearch ? 'Search people…' : 'Search unavailable'}
          aria-label="Search people"
          className="h-9 text-[12.5px]"
          disabled={!canSearch}
          data-autofocus
        />
      </div>

      <div role="menu" aria-label="Assignee">
        <ChoiceRow selected={!assignedId} onClick={() => onSelect(null)}>
          <UserCircleIcon className="h-4 w-4 shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1">Unassigned</span>
        </ChoiceRow>

        {Array.from(merged.values()).map((member) => (
          <ChoiceRow
            key={member.id}
            selected={assignedId === member.id}
            onClick={() => onSelect(member)}
          >
            <Avatar src={member.avatar} name={member.name} className="h-6 w-6 text-[10px]" />
            <span className="min-w-0 flex-1 truncate">{member.name || 'Unnamed'}</span>
          </ChoiceRow>
        ))}

        {searching && <p className="px-2 py-2 text-[11.5px] text-ink-muted">Searching…</p>}
        {error && <p className="px-2 py-2 text-[11.5px] text-danger">{error}</p>}
        {!canSearch && (
          <p className="px-2 py-2 text-[11px] leading-relaxed text-ink-muted">
            Only the board owner can list everyone with access.
          </p>
        )}
        {canSearch && query.trim() && !searching && results.length === 0 && !error && (
          <PopoverEmpty>No people found.</PopoverEmpty>
        )}
      </div>
    </div>
  );
}

function toAssigneeOption(user: AssigneeOption & { email?: string }): AssigneeOption {
  return {
    id: user.id,
    name: user.name || user.email || '',
    avatar: user.avatar || '',
  };
}

/** Compact Monday-first month popover with Today/Tomorrow/Clear shortcuts. */
export function DateMenu({
  value,
  label,
  onSelect,
}: {
  value: string;
  label: string;
  onSelect: (value: string) => void;
}) {
  const selected = dateInputValue(value);
  const [month, setMonth] = useState(() => {
    const date = selected ? new Date(`${selected}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1, 12);
  });
  const grid = buildMonthGrid(month);
  const today = todayDateInput();
  const tomorrow = tomorrowDateInput();

  useEffect(() => {
    const date = selected ? new Date(`${selected}T12:00:00`) : new Date();
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  }, [selected]);

  const moveMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1, 12));
  };

  return (
    <div>
      <div className="flex items-center gap-1 px-1 pb-2">
        <button
          type="button"
          onClick={() => onSelect(today)}
          className="task-popover__quick h-8 rounded-control px-2 text-[12px] font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onSelect(tomorrow)}
          className="task-popover__quick h-8 rounded-control px-2 text-[12px] font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink"
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => onSelect('')}
          disabled={!selected}
          className="task-popover__quick ml-auto h-8 rounded-control px-2 text-[12px] font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="text-[12.5px] font-semibold text-ink">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous month" size="sm" onClick={() => moveMonth(-1)}>
            <ChevronLeftIcon />
          </IconButton>
          <IconButton label="Next month" size="sm" onClick={() => moveMonth(1)}>
            <ChevronRightIcon />
          </IconButton>
        </div>
      </div>

      <div className="task-date-grid grid grid-cols-7 gap-0.5 px-0.5" aria-label={label}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => (
          <span
            key={`${weekday}-${index}`}
            className="flex h-7 items-center justify-center text-[10.5px] font-semibold text-ink-muted"
          >
            {weekday}
          </span>
        ))}
        {grid.map((date) => {
          const key = dateInputFor(date);
          const inMonth = date.getMonth() === month.getMonth();
          const isSelected = key === selected;
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-label={date.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              aria-pressed={isSelected}
              className={cn(
                'relative flex h-8 items-center justify-center rounded-[6px] text-[11.5px] tabular-nums transition-colors',
                isSelected
                  ? 'bg-signal-bright font-semibold text-on-signal'
                  : inMonth
                    ? 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
                    : 'text-ink-muted/60 hover:bg-surface-sunken/60 hover:text-ink',
                isToday && !isSelected && 'font-semibold text-ink'
              )}
            >
              {date.getDate()}
              {isToday && !isSelected && (
                <span className="absolute bottom-1 h-0.5 w-0.5 rounded-full bg-signal" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      <p className="px-2 pt-2 text-[10.5px] text-ink-muted">
        {selected ? `Saves ${formatDateLabel(selected)} immediately.` : 'No date set.'}
      </p>
    </div>
  );
}

export function LabelDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', labelToneClass(color), className)}
      aria-hidden="true"
    />
  );
}

export function LabelsMenu({
  definitions,
  selected,
  canCreate,
  onToggle,
  onCreated,
}: {
  definitions: TaskLabel[];
  selected: string[];
  canCreate: boolean;
  onToggle: (name: string, nextSelected: boolean) => void;
  onCreated: (label: TaskLabel) => void;
}) {
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('ash');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byName = new Map(definitions.map((label) => [label.name.toLowerCase(), label]));
  for (const name of selected) {
    if (!byName.has(name.toLowerCase())) {
      byName.set(name.toLowerCase(), {
        id: `selected-${name}`,
        collectionName: 'labels',
        author: '',
        name,
        color: 'ash',
        created: '',
        updated: '',
      });
    }
  }

  const needle = query.trim().toLowerCase();
  const options = Array.from(byName.values()).filter((label) =>
    needle ? label.name.toLowerCase().includes(needle) : true
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createLabelRecord(name, newColor);
      onCreated(created);
      onToggle(created.name, true);
      setNewName('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the label.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="px-1 pb-1.5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          icon={<MagnifyingGlassIcon />}
          placeholder="Find a label…"
          aria-label="Search labels"
          className="h-9 text-[12.5px]"
          data-autofocus
        />
      </div>

      <div role="menu" aria-label="Labels">
        {options.length === 0 && <PopoverEmpty>No labels yet.</PopoverEmpty>}
        {options.map((label) => {
          const checked = selected.includes(label.name);
          return (
            <button
              key={label.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => onToggle(label.name, !checked)}
              className={cn(
                'flex min-h-9 w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-[12.5px] transition-colors',
                checked
                  ? 'bg-signal-soft text-ink'
                  : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                  checked ? 'border-signal bg-signal-bright text-on-signal' : 'border-line-strong'
                )}
                aria-hidden="true"
              >
                {checked && <CheckIcon className="h-3 w-3" />}
              </span>
              <LabelDot color={label.color} />
              <span className="min-w-0 flex-1 truncate">{label.name}</span>
            </button>
          );
        })}
      </div>

      {canCreate && (
        <>
          <div className="my-1.5 border-t border-line" role="separator" />
          <PopoverLabel>Create a label</PopoverLabel>
          <div className="space-y-2 px-1 pb-1">
            <Input
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="Label name"
              aria-label="New label name"
              maxLength={40}
              className="h-9 text-[12.5px]"
            />
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Label colour">
              {LABEL_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setNewColor(option.value)}
                  aria-label={option.label}
                  aria-pressed={newColor === option.value}
                  title={option.label}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                    newColor === option.value ? 'border-line-strong bg-surface' : 'border-transparent hover:bg-surface-sunken'
                  )}
                >
                  <LabelDot color={option.value} className="h-3 w-3" />
                </button>
              ))}
              <Button
                size="sm"
                variant="primary"
                className="ml-auto h-8"
                onClick={() => void handleCreate()}
                loading={creating}
                disabled={!newName.trim()}
              >
                Create
              </Button>
            </div>
            {error && <p className="text-[11px] leading-relaxed text-danger">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

const FREQUENCIES: Array<{ value: TaskRecurrence['frequency']; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function RecurrenceMenu({
  value,
  onSelect,
}: {
  value: TaskRecurrence | null;
  onSelect: (recurrence: TaskRecurrence | null) => void;
}) {
  const interval = Math.max(1, Math.trunc(value?.interval ?? 1));

  return (
    <div>
      <div role="menu" aria-label="Repeat">
        <ChoiceRow selected={!value} onClick={() => onSelect(null)}>
          <CalendarDaysIcon className="h-4 w-4 shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1">Does not repeat</span>
        </ChoiceRow>
      </div>
      <div className="my-1 border-t border-line" role="separator" />
      <div role="menu" aria-label="Repeat frequency">
        {FREQUENCIES.map((frequency) => (
          <ChoiceRow
            key={frequency.value}
            selected={value?.frequency === frequency.value}
            onClick={() =>
              onSelect({
                ...(value ?? {}),
                frequency: frequency.value,
                interval,
              })
            }
          >
            <span className="min-w-0 flex-1">{frequency.label}</span>
          </ChoiceRow>
        ))}
      </div>

      {value && (
        <div className="mt-2 flex items-center gap-2 rounded-control border border-line bg-surface-sunken px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[11.5px] text-ink-secondary">Every</span>
          <IconButton
            label="Decrease interval"
            size="sm"
            disabled={interval <= 1}
            onClick={() =>
              onSelect({ ...value, interval: Math.max(1, interval - 1) })
            }
          >
            <MinusIcon />
          </IconButton>
          <span className="w-7 text-center text-[12.5px] font-semibold tabular-nums text-ink">
            {interval}
          </span>
          <IconButton
            label="Increase interval"
            size="sm"
            disabled={interval >= 99}
            onClick={() => onSelect({ ...value, interval: Math.min(99, interval + 1) })}
          >
            <PlusIcon />
          </IconButton>
          <span className="text-[11.5px] text-ink-muted">
            {recurrenceUnit(value.frequency)}
            {interval === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </div>
  );
}
