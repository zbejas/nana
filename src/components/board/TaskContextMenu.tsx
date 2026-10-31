import { useEffect, useState } from 'react';
import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  FlagIcon,
  InboxArrowDownIcon,
  QueueListIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, UpdateTaskData } from '../../lib/tasks';
import { formatShortDate } from '../../lib/board-preferences';
import {
  Button,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  Sheet,
} from '../ui';
import { cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import {
  PRIORITY_CODES,
  columnDotClass,
  type BoardLabel,
  type QuickField,
} from './board-config';
import {
  TaskPickerBody,
  menuPositionFromRect,
  useIsMobile,
} from './TaskQuickPickers';

interface TaskContextMenuProps {
  open: boolean;
  task: Task | null;
  anchor: DOMRect | null;
  initialSection?: QuickField | null;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  onClose: () => void;
  onUpdate: (task: Task, patch: UpdateTaskData) => Promise<void>;
  onDuplicate: (task: Task) => Promise<void>;
  onDelete: (task: Task) => void;
  onCreateLabel: (name: string) => Promise<BoardLabel | null>;
}

function statusName(task: Task, columns: BoardColumn[]): string {
  const column = columns.find((candidate) => candidate.slug === task.status);
  if (column) return column.name;
  if (task.status === 'planned') return 'Planned';
  if (task.status === 'archived') return 'Archived';
  return task.status;
}

function RootRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-9 w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value && <span className="max-w-[9rem] truncate text-[11px] text-ink-muted">{value}</span>}
      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
    </button>
  );
}

export function TaskContextMenu({
  open,
  task,
  anchor,
  initialSection = null,
  columns,
  members,
  labels,
  onClose,
  onUpdate,
  onDuplicate,
  onDelete,
  onCreateLabel,
}: TaskContextMenuProps) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<QuickField | null>(initialSection);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSection(initialSection);
      setBusy(false);
    }
  }, [open, initialSection, task?.id]);

  if (!open || !task) return null;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onClose();
    } catch {
      // The board shell owns the failure toast and live announcement. Keep the
      // menu usable instead of surfacing an unhandled rejection.
    } finally {
      setBusy(false);
    }
  };

  const picker = section ? (
    <TaskPickerBody
      section={section}
      task={task}
      columns={columns}
      members={members}
      labels={labels}
      onBack={() => setSection(null)}
      onUpdate={(patch) => onUpdate(task, patch)}
      onClose={onClose}
      onCreateLabel={onCreateLabel}
    />
  ) : null;

  const root = (
    <div>
      <div className="border-b border-line px-3 pb-2 pt-1.5">
        <p className="truncate text-[12.5px] font-medium text-ink">{task.title || 'Untitled task'}</p>
        <p className="mt-0.5 text-[10.5px] tabular-nums text-ink-muted">
          {statusName(task, columns)}
          {task.task_number ? ` · #${task.task_number}` : ''}
        </p>
      </div>
      <div className="p-1.5">
        <RootRow
          icon={<QueueListIcon />}
          label="Status"
          value={statusName(task, columns)}
          onClick={() => setSection('status')}
        />
        <RootRow
          icon={<FlagIcon />}
          label="Priority"
          value={task.priority ? PRIORITY_CODES[task.priority] : 'None'}
          onClick={() => setSection('priority')}
        />
        <RootRow
          icon={<UserCircleIcon />}
          label="Assignee"
          value={
            task.assignee
              ? members.find((member) => member.id === task.assignee)?.name || 'Assigned'
              : 'Unassigned'
          }
          onClick={() => setSection('assignee')}
        />
        <RootRow
          icon={<CalendarDaysIcon />}
          label="Dates"
          value={task.due_date ? formatShortDate(task.due_date) : 'None'}
          onClick={() => setSection('due')}
        />
        <RootRow
          icon={<TagIcon />}
          label="Labels"
          value={task.labels.length > 0 ? String(task.labels.length) : 'None'}
          onClick={() => setSection('labels')}
        />
        <MenuSeparator />
        <MenuItem
          icon={<ClipboardDocumentIcon />}
          label="Duplicate task"
          disabled={busy}
          onClick={() => void run(() => onDuplicate(task))}
        />
        <MenuItem
          icon={<QueueListIcon />}
          label="Move to planned"
          disabled={busy || task.status === 'planned'}
          onClick={() => void run(() => onUpdate(task, { status: 'planned' }))}
        />
        <MenuItem
          icon={<ArchiveBoxIcon />}
          label="Archive task"
          disabled={busy || task.status === 'archived'}
          onClick={() => void run(() => onUpdate(task, { status: 'archived' }))}
        />
        <MenuItem
          icon={<InboxArrowDownIcon />}
          label="Move to board"
          disabled={busy}
          onClick={() => {
            const firstOpen = columns.find((column) => !column.is_final) ?? columns[0];
            if (firstOpen) void run(() => onUpdate(task, { status: firstOpen.slug }));
          }}
        />
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon />}
          label="Delete task"
          tone="danger"
          disabled={busy}
          onClick={() => onDelete(task)}
        />
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={section ? 'Change task' : 'Task actions'}
        description={section ? task.title : undefined}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span className={cn('h-1.5 w-1.5 rounded-full', columnDotClass(columns.find((column) => column.slug === task.status)?.color))} />
              {statusName(task, columns)}
            </span>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        {picker ?? root}
      </Sheet>
    );
  }

  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      position={menuPositionFromRect(anchor ?? new DOMRect(16, 16, 0, 0), {
        width: section ? 260 : 240,
        height: section ? 380 : 420,
      })}
      ariaLabel="Task actions"
      className={section ? 'w-[260px]' : 'w-[240px]'}
    >
      {picker ?? root}
    </MenuSurface>
  );
}
