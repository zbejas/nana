import { useState, type CSSProperties } from 'react';
import {
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  FlagIcon,
  InboxArrowDownIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, TaskPriority } from '../../lib/tasks';
import { addDays, toIsoDay } from '../../lib/board-preferences';
import { Button, IconButton, MenuSurface, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import { PRIORITIES, columnDotClass, labelDotClass, type BoardLabel } from './board-config';

type BulkField = 'status' | 'priority' | 'assignee' | 'labels' | 'due';

interface BoardBulkBarProps {
  selectedTasks: Task[];
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  busy: boolean;
  onClear: () => void;
  onStatus: (status: string) => void;
  onPriority: (priority: TaskPriority | '') => void;
  onAssignee: (assignee: string) => void;
  onToggleLabel: (label: string) => void;
  onDue: (patch: { start_date?: string; due_date: string }) => void;
  onPlanned: () => void;
  onBoard: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

function menuAbove(anchor: DOMRect, width = 240): CSSProperties {
  const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - width - 8));
  return {
    left,
    bottom: Math.max(8, window.innerHeight - anchor.top + 8),
    width,
  };
}

export function BoardBulkBar({
  selectedTasks,
  columns,
  members,
  labels,
  busy,
  onClear,
  onStatus,
  onPriority,
  onAssignee,
  onToggleLabel,
  onDue,
  onPlanned,
  onBoard,
  onArchive,
  onRestore,
  onDelete,
}: BoardBulkBarProps) {
  const [field, setField] = useState<BulkField | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const count = selectedTasks.length;
  if (count === 0) return null;

  const anyArchived = selectedTasks.some((task) => task.status === 'archived');
  const anyActive = selectedTasks.some((task) => task.status !== 'archived');
  const firstOpen = columns.find((column) => !column.is_final) ?? columns[0];
  const commonLabels = labels.filter((label) =>
    selectedTasks.every((task) => task.labels.includes(label.name)),
  );

  const toggle = (next: BulkField, element: HTMLElement) => {
    setAnchor(element.getBoundingClientRect());
    setField((current) => (current === next ? null : next));
  };

  const item = (
    active: boolean,
    label: string,
    icon: React.ReactNode,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void,
    disabled = false,
  ) => (
    <Button
      key={label}
      variant="ghost"
      size="sm"
      className={cn('h-9 shrink-0 px-2', active && 'bg-surface-sunken text-ink')}
      icon={icon}
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
    >
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <>
      <div className="board-bulk-bar" role="region" aria-label="Bulk task actions">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-signal-soft px-2 py-1 text-[11.5px] font-semibold text-signal">
          <CheckCircleIcon className="h-3.5 w-3.5" />
          {count} selected
        </span>

        {item(
          field === 'status',
          'Status',
          <CheckCircleIcon />,
          (event) => toggle('status', event.currentTarget),
        )}
        {item(
          field === 'priority',
          'Priority',
          <FlagIcon />,
          (event) => toggle('priority', event.currentTarget),
        )}
        {item(
          field === 'assignee',
          'Assignee',
          <UserCircleIcon />,
          (event) => toggle('assignee', event.currentTarget),
        )}
        {item(
          field === 'labels',
          'Labels',
          <TagIcon />,
          (event) => toggle('labels', event.currentTarget),
        )}
        {item(
          field === 'due',
          'Due',
          <CalendarDaysIcon />,
          (event) => toggle('due', event.currentTarget),
        )}

        {item(
          false,
          'Backlog',
          <InboxArrowDownIcon />,
          onPlanned,
          anyArchived && !anyActive,
        )}
        {item(
          false,
          firstOpen ? `Move to ${firstOpen.name}` : 'Move to board',
          <CheckCircleIcon />,
          onBoard,
          !firstOpen,
        )}
        {anyArchived &&
          item(false, 'Restore', <ArrowUturnLeftIcon />, onRestore)}
        {anyActive &&
          item(false, 'Archive', <ArchiveBoxIcon />, onArchive)}
        {item(false, 'Delete', <TrashIcon />, onDelete)}

        <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />
        <IconButton label="Clear selection" size="md" className="h-9 w-9 shrink-0" onClick={onClear}>
          <XMarkIcon />
        </IconButton>
      </div>

      <MenuSurface
        open={field !== null}
        onClose={() => setField(null)}
        position={menuAbove(anchor ?? new DOMRect(16, 16, 0, 0), 250)}
        ariaLabel="Bulk edit"
        className="w-[250px]"
      >
        {field === 'status' && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">Move to status</p>
            {columns.map((column) => (
              <button
                key={column.slug}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  onStatus(column.slug);
                  setField(null);
                }}
                className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', columnDotClass(column.color))} />
                <span className="flex-1 truncate">{column.name}</span>
                {column.is_final && <span className="text-[10.5px] text-ink-muted">Final</span>}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                onStatus('planned');
                setField(null);
              }}
              className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              Planned
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                onStatus('archived');
                setField(null);
              }}
              className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" />
              Archived
            </button>
          </div>
        )}

        {field === 'priority' && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">Set priority</p>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                onPriority('');
                setField(null);
              }}
              className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              No priority
            </button>
            {PRIORITIES.map((priority) => (
              <button
                key={priority.value}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  onPriority(priority.value);
                  setField(null);
                }}
                className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                {priority.label}
              </button>
            ))}
          </div>
        )}

        {field === 'assignee' && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">Assign selected</p>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                onAssignee('');
                setField(null);
              }}
              className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              Unassigned
            </button>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  onAssignee(member.id);
                  setField(null);
                }}
                className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                {member.name}
              </button>
            ))}
          </div>
        )}

        {field === 'labels' && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">Add or remove label</p>
            {labels.length === 0 && (
              <p className="px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
                Add a label to a task first to reuse it here.
              </p>
            )}
            {labels.map((label) => {
              const active = commonLabels.some((entry) => entry.name === label.name);
              return (
                <button
                  key={label.id || label.name}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => onToggleLabel(label.name)}
                  className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', labelDotClass(label.color))} />
                  <span className="flex-1 truncate">{label.name}</span>
                  {active && <span className="text-[10.5px] text-ink-muted">All</span>}
                </button>
              );
            })}
          </div>
        )}

        {field === 'due' && (
          <div>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-ink-muted">Set due date</p>
            {[
              { label: 'Today', days: 0 },
              { label: 'Tomorrow', days: 1 },
              { label: 'Next week', days: 7 },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  const due = toIsoDay(addDays(new Date(), option.days));
                  onDue({ start_date: due, due_date: due });
                  setField(null);
                }}
                className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
              >
                <CalendarDaysIcon className="h-3.5 w-3.5 text-ink-muted" />
                {option.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                onDue({ start_date: '', due_date: '' });
                setField(null);
              }}
              className="flex min-h-9 w-full items-center px-3 py-1.5 text-left text-[12.5px] text-ink-secondary hover:bg-surface-sunken hover:text-ink"
            >
              Clear dates
            </button>
          </div>
        )}
      </MenuSurface>
    </>
  );
}
