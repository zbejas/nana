import { useMemo, useState, type MouseEvent } from 'react';
import {
  CalendarDaysIcon,
  ChatBubbleLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  PlusIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, TaskDraft } from '../../lib/tasks';
import {
  formatShortDate,
  formatTaskNumber,
  isTaskOverdue,
  type BoardDisplayPreferences,
} from '../../lib/board-preferences';
import { Avatar, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import {
  PRIORITY_CODES,
  PRIORITY_LABELS,
  columnDotClass,
  defaultLabelColor,
  labelDotClass,
  type BoardLabel,
  type QuickField,
} from './board-config';
import { TaskComposer } from './TaskComposer';

export function taskExtras(task: Task): {
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

export function taskParentId(task: Task): string {
  const value = (task as Task & { parent?: string }).parent;
  return typeof value === 'string' ? value : '';
}

interface TaskListRowProps {
  task: Task;
  columns: BoardColumn[];
  display: BoardDisplayPreferences;
  labels: BoardLabel[];
  members: BoardMember[];
  selected: boolean;
  selectionMode: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onOpen: () => void;
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  onMenu: (anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (field: QuickField, anchor: DOMRect) => void;
  onOpenNote?: (documentId: string) => void;
}

export function TaskListRow({
  task,
  columns,
  display,
  labels,
  members,
  selected,
  selectionMode,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  onOpen,
  onSelect,
  onMenu,
  onQuickPick,
  onOpenNote,
}: TaskListRowProps) {
  const column = columns.find((candidate) => candidate.slug === task.status);
  const assignee = task.expand?.assignee;
  const member =
    members.find((candidate) => candidate.id === task.assignee) ??
    (assignee ? { id: assignee.id, name: assignee.name || 'Member', avatar: assignee.avatar } : null);
  const note = task.expand?.document;
  const overdue = isTaskOverdue(task, () => Boolean(column?.is_final));
  const extras = taskExtras(task);
  const numeric = formatTaskNumber(task);
  const colorMap = new Map(labels.map((label) => [label.name, label.color]));

  const picker = (field: QuickField, element: HTMLElement) => {
    onQuickPick(field, element.getBoundingClientRect());
  };

  return (
    <div
      data-task-id={task.id}
      data-selected={selected || undefined}
      draggable={false}
      className="board-list-row group relative"
      style={depth > 0 ? { paddingLeft: `${14 + depth * 18}px` } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {selectionMode && (
          <button
            type="button"
            aria-label={selected ? 'Deselect task' : 'Select task'}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(event);
            }}
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border',
              selected
                ? 'border-signal bg-signal-bright text-on-signal'
                : 'border-line-strong bg-surface text-transparent',
            )}
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.();
            }}
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            aria-expanded={expanded}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            {expanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-1 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          data-task-open
          onClick={(event) => {
            if (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
              onSelect(event);
            } else {
              onOpen();
            }
          }}
          className="min-w-0 flex-1 py-2 text-left"
          aria-label={`Open ${numeric ? `${numeric} ` : ''}${task.title || 'Untitled task'}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {numeric && <span className="shrink-0 text-[10.5px] tabular-nums text-ink-muted">{numeric}</span>}
            <span
              className={cn(
                'min-w-0 truncate text-[12.5px] font-medium text-ink',
                column?.is_final && 'text-ink-muted line-through decoration-ink-muted/50',
              )}
            >
              {task.title || 'Untitled task'}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-muted md:hidden">
            {task.priority && (
              <span className="tabular-nums" title={PRIORITY_LABELS[task.priority]}>
                {PRIORITY_CODES[task.priority]}
              </span>
            )}
            {display.dates && task.due_date && (
              <span className={cn('inline-flex items-center gap-1 tabular-nums', overdue && 'text-danger')}>
                <CalendarDaysIcon className="h-3 w-3" />
                {formatShortDate(task.due_date)}
              </span>
            )}
            {display.labels && task.labels.slice(0, 2).map((label) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className={cn('h-1.5 w-1.5 rounded-full', labelDotClass(colorMap.get(label) ?? defaultLabelColor(label)))} />
                {label}
              </span>
            ))}
            {display.note && note && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <DocumentTextIcon className="h-3 w-3" />
                <span className="max-w-[9rem] truncate">{note.title || 'Linked note'}</span>
              </span>
            )}
          </span>
        </button>
      </div>

      <div className="hidden items-center md:flex">
        {display.priority && task.priority ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              picker('priority', event.currentTarget);
            }}
            className="rounded-[4px] border border-line bg-surface-sunken px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-secondary hover:border-line-strong hover:text-ink"
            title={`Priority: ${PRIORITY_LABELS[task.priority]}`}
          >
            {PRIORITY_CODES[task.priority]}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </div>

      <div className="hidden min-w-0 items-center gap-1.5 md:flex">
        {display.assignee ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              picker('assignee', event.currentTarget);
            }}
            className="flex min-w-0 items-center gap-1.5 rounded-control px-1 py-0.5 text-left hover:bg-surface-sunken"
            aria-label={member ? `Assigned to ${member.name}` : 'Assign task'}
          >
            {member ? (
              <>
                <Avatar src={member.avatar} name={member.name} size="sm" className="h-5 w-5 text-[9px]" />
                <span className="truncate text-[11px] text-ink-secondary">{member.name}</span>
              </>
            ) : (
              <span className="text-[11px] text-ink-muted">Unassigned</span>
            )}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </div>

      <div className="hidden items-center md:flex">
        {display.dates && task.due_date ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              picker('due', event.currentTarget);
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-control px-1 py-0.5 text-[11px] tabular-nums text-ink-secondary hover:bg-surface-sunken hover:text-ink',
              overdue && 'font-medium text-danger',
            )}
          >
            <CalendarDaysIcon className="h-3 w-3" />
            {formatShortDate(task.due_date)}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </div>

      <div className="hidden min-w-0 items-center gap-1.5 md:flex">
        {display.labels && task.labels.length > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              picker('labels', event.currentTarget);
            }}
            aria-label={`Labels: ${task.labels.join(', ')}`}
            className="flex min-w-0 items-center gap-1.5 rounded-control px-1 py-0.5 hover:bg-surface-sunken"
          >
            {task.labels.slice(0, 2).map((label) => (
              <span key={label} className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-secondary">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', labelDotClass(colorMap.get(label) ?? defaultLabelColor(label)))} />
                <span className="max-w-[5rem] truncate">{label}</span>
              </span>
            ))}
            {task.labels.length > 2 && (
              <span className="text-[10.5px] tabular-nums text-ink-muted">+{task.labels.length - 2}</span>
            )}
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </div>

      <div className="hidden items-center text-[11px] tabular-nums text-ink-muted md:flex">
        {display.subtasks && extras.subtaskTotal > 0 ? (
          <span className="inline-flex items-center gap-1">
            <CheckIcon className="h-3 w-3" />
            {extras.subtaskDone}/{extras.subtaskTotal}
          </span>
        ) : (
          '—'
        )}
      </div>

      <div className="hidden items-center text-[11px] tabular-nums text-ink-muted md:flex">
        {display.comments && extras.commentCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ChatBubbleLeftIcon className="h-3 w-3" />
            {extras.commentCount}
          </span>
        ) : (
          '—'
        )}
      </div>

      <div className="hidden min-w-0 items-center md:flex">
        {display.note && note ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNote?.(note.id);
            }}
            className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
          >
            <DocumentTextIcon className="h-3 w-3 shrink-0" />
            <span className="max-w-[8rem] truncate">{note.title || 'Linked note'}</span>
          </button>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </div>

      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 md:block">
        <button
          type="button"
          aria-label="Task actions"
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event.currentTarget.getBoundingClientRect());
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <EllipsisHorizontalIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface ListViewProps {
  columns: BoardColumn[];
  grouped: Record<string, Task[]>;
  display: BoardDisplayPreferences;
  labels: BoardLabel[];
  members: BoardMember[];
  selection: Set<string>;
  selectionMode: boolean;
  collapsed: Set<string>;
  onToggleGroup: (status: string) => void;
  filtering: boolean;
  canEdit?: boolean;
  composerStatus: string | null;
  onOpenTask: (task: Task) => void;
  onSelectTask: (task: Task, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (task: Task, anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (task: Task, field: QuickField, anchor: DOMRect) => void;
  onOpenNote: (documentId: string) => void;
  onOpenComposer: (status?: string) => void;
  onCancelComposer: () => void;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onClearFilters: () => void;
}

export function ListView({
  columns,
  grouped,
  display,
  labels,
  members,
  selection,
  selectionMode,
  collapsed,
  onToggleGroup,
  filtering,
  canEdit = true,
  composerStatus,
  onOpenTask,
  onSelectTask,
  onOpenMenu,
  onQuickPick,
  onOpenNote,
  onOpenComposer,
  onCancelComposer,
  onCreateTask,
  onClearFilters,
}: ListViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of columns) {
      for (const task of grouped[column.slug] ?? []) {
        const parent = taskParentId(task);
        if (!parent) continue;
        const entry = map.get(parent) ?? [];
        entry.push(task);
        map.set(parent, entry);
      }
    }
    return map;
  }, [columns, grouped]);

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
      <div className="board-list-header px-1">
        <span>Name</span>
        <span>Priority</span>
        <span>Assignee</span>
        <span>Due</span>
        <span>Labels</span>
        <span>Progress</span>
        <span>Comments</span>
        <span>Note</span>
      </div>

      {columns.map((column) => {
        const allTasks = (grouped[column.slug] ?? []).filter((task) => !taskParentId(task));
        const isCollapsed = collapsed.has(column.slug);
        const open = canEdit && composerStatus === column.slug;

        return (
          <section key={column.id || column.slug} aria-labelledby={`list-group-${column.slug}`}>
            <div className="board-group-header">
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => onToggleGroup(column.slug)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken hover:text-ink"
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${column.name}`}
              >
                {isCollapsed ? <ChevronRightIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />}
              </button>
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', columnDotClass(column.color))} aria-hidden="true" />
              <h2 id={`list-group-${column.slug}`} className="text-[12px] font-semibold text-ink">
                {column.name}
              </h2>
              <span className="text-[11px] tabular-nums text-ink-muted">{allTasks.length}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onOpenComposer(column.slug)}
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded-control px-1.5 text-[11.5px] font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add task
                </button>
              )}
            </div>

            {!isCollapsed && (
              <>
                {open && (
                  <div className="px-4 py-2">
                    <TaskComposer
                      status={column.slug}
                      columns={columns}
                      autoFocus
                      onCancel={onCancelComposer}
                      onSubmit={async (draft) => {
                        await onCreateTask(draft);
                        onCancelComposer();
                      }}
                    />
                  </div>
                )}

                {allTasks.length === 0 ? (
                  <div className="flex min-h-[44px] items-center gap-2 border-b border-line px-4 py-2 text-[11.5px] text-ink-muted">
                    {filtering ? (
                      <>
                        <span>No matching tasks in this column.</span>
                        <button type="button" onClick={onClearFilters} className="font-medium text-signal hover:text-signal-strong">
                          Clear filters
                        </button>
                      </>
                    ) : (
                      <>
                        <span>Nothing here yet.</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onOpenComposer(column.slug)}
                            className="font-medium text-signal hover:text-signal-strong"
                          >
                            Add the first task
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  allTasks.map((task) => {
                    const children = childrenByParent.get(task.id) ?? [];
                    const isExpanded = expanded.has(task.id);
                    return (
                      <div key={task.id} className="relative">
                        <TaskListRow
                          task={task}
                          columns={columns}
                          display={display}
                          labels={labels}
                          members={members}
                          selected={selection.has(task.id)}
                          selectionMode={selectionMode}
                          hasChildren={children.length > 0}
                          expanded={isExpanded}
                          onToggleExpand={() => toggleExpanded(task.id)}
                          onOpen={() => onOpenTask(task)}
                          onSelect={(event) => onSelectTask(task, event)}
                          onMenu={(anchor, section) => onOpenMenu(task, anchor, section)}
                          onQuickPick={(field, anchor) => onQuickPick(task, field, anchor)}
                          onOpenNote={onOpenNote}
                        />
                        {isExpanded &&
                          children.map((child) => (
                            <TaskListRow
                              key={child.id}
                              task={child}
                              columns={columns}
                              display={display}
                              labels={labels}
                              members={members}
                              selected={selection.has(child.id)}
                              selectionMode={selectionMode}
                              depth={1}
                              onOpen={() => onOpenTask(child)}
                              onSelect={(event) => onSelectTask(child, event)}
                              onMenu={(anchor, section) => onOpenMenu(child, anchor, section)}
                              onQuickPick={(field, anchor) => onQuickPick(child, field, anchor)}
                              onOpenNote={onOpenNote}
                            />
                          ))}
                      </div>
                    );
                  })
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
