import { useState, type MouseEvent } from 'react';
import {
  ArchiveBoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  InboxArrowDownIcon,
  QueueListIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, TaskDraft } from '../../lib/tasks';
import type { BoardDisplayPreferences } from '../../lib/board-preferences';
import { Button, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import type { BoardLabel, QuickField } from './board-config';
import { TaskComposer } from './TaskComposer';
import { TaskListRow } from './ListView';

interface BacklogViewProps {
  columns: BoardColumn[];
  planned: Task[];
  archived: Task[];
  display: BoardDisplayPreferences;
  labels: BoardLabel[];
  members: BoardMember[];
  selection: Set<string>;
  selectionMode: boolean;
  filtering: boolean;
  canEdit?: boolean;
  composerStatus: string | null;
  movingAll: boolean;
  onOpenTask: (task: Task) => void;
  onSelectTask: (task: Task, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (task: Task, anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (task: Task, field: QuickField, anchor: DOMRect) => void;
  onOpenNote: (documentId: string) => void;
  onMoveTask: (task: Task, status: string) => void;
  onMovePlannedToBoard: () => void;
  onOpenComposer: (status?: string) => void;
  onCancelComposer: () => void;
  onCreateTask: (draft: TaskDraft) => Promise<void>;
  onClearFilters: () => void;
}

function BacklogSection({
  id,
  title,
  description,
  icon,
  tasks,
  columns,
  display,
  labels,
  members,
  selection,
  selectionMode,
  filtering,
  canEdit = true,
  onOpenTask,
  onSelectTask,
  onOpenMenu,
  onQuickPick,
  onOpenNote,
  onDropTask,
  emptyCopy,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tasks: Task[];
  columns: BoardColumn[];
  display: BoardDisplayPreferences;
  labels: BoardLabel[];
  members: BoardMember[];
  selection: Set<string>;
  selectionMode: boolean;
  filtering: boolean;
  canEdit?: boolean;
  onOpenTask: (task: Task) => void;
  onSelectTask: (task: Task, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (task: Task, anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (task: Task, field: QuickField, anchor: DOMRect) => void;
  onOpenNote: (documentId: string) => void;
  onDropTask: (taskId: string) => void;
  emptyCopy: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      aria-labelledby={`backlog-${id}`}
      className={cn(
        'overflow-hidden rounded-panel border bg-surface transition-colors',
        over ? 'border-signal/45 bg-signal-soft/20' : 'border-line',
      )}
      onDragOver={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!canEdit) return;
        event.preventDefault();
        setOver(false);
        const taskId = event.dataTransfer.getData('text/nana-task');
        if (taskId) onDropTask(taskId);
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-surface-sunken hover:text-ink"
        >
          {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
        </button>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] border border-line bg-surface-sunken text-ink-muted [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={`backlog-${id}`} className="text-[13px] font-semibold text-ink">
            {title}
          </h2>
          <p className="text-[11px] text-ink-muted">{description}</p>
        </div>
        <span className="text-[11.5px] font-medium tabular-nums text-ink-muted">{tasks.length}</span>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>

      {!collapsed && (
        <>
          <div className="board-list-header hidden px-3 md:grid">
            <span>Name</span>
            <span>Priority</span>
            <span>Assignee</span>
            <span>Due</span>
            <span>Labels</span>
            <span>Progress</span>
            <span>Comments</span>
            <span>Note</span>
          </div>

          {tasks.length === 0 ? (
            <div className="flex min-h-[64px] items-center justify-center px-4 py-5 text-center text-[12px] text-ink-muted">
              {filtering ? 'No matching tasks in this section.' : emptyCopy}
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/nana-task', task.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                className="relative"
                data-backlog-task={task.id}
              >
                <TaskListRow
                  task={task}
                  columns={columns}
                  display={display}
                  labels={labels}
                  members={members}
                  selected={selection.has(task.id)}
                  selectionMode={selectionMode}
                  onOpen={() => onOpenTask(task)}
                  onSelect={(event) => onSelectTask(task, event)}
                  onMenu={(anchor, section) => onOpenMenu(task, anchor, section)}
                  onQuickPick={(field, anchor) => onQuickPick(task, field, anchor)}
                  onOpenNote={onOpenNote}
                />
              </div>
            ))
          )}
          {children}
        </>
      )}
    </section>
  );
}

export function BacklogView({
  columns,
  planned,
  archived,
  display,
  labels,
  members,
  selection,
  selectionMode,
  filtering,
  canEdit = true,
  composerStatus,
  movingAll,
  onOpenTask,
  onSelectTask,
  onOpenMenu,
  onQuickPick,
  onOpenNote,
  onMoveTask,
  onMovePlannedToBoard,
  onOpenComposer,
  onCancelComposer,
  onCreateTask,
  onClearFilters,
}: BacklogViewProps) {
  const firstOpenColumn = columns.find((column) => !column.is_final) ?? columns[0];

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-autohide">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-muted">
        <p>
          Planned and archived work stays off the board. Drag a row between the two sections to move it.
        </p>
        {filtering && (
          <button type="button" onClick={onClearFilters} className="font-medium text-signal hover:text-signal-strong">
            Clear filters
          </button>
        )}
      </div>

      <BacklogSection
        id="planned"
        title="Planned"
        description="Ideas and work that is not on a lane yet."
        icon={<QueueListIcon />}
        tasks={planned}
        columns={columns}
        display={display}
        labels={labels}
        members={members}
        selection={selection}
        selectionMode={selectionMode}
        filtering={filtering}
        canEdit={canEdit}
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        onOpenMenu={onOpenMenu}
        onQuickPick={onQuickPick}
        onOpenNote={onOpenNote}
        onDropTask={(taskId) => {
          const task = [...planned, ...archived].find((candidate) => candidate.id === taskId);
          if (task) onMoveTask(task, 'planned');
        }}
        emptyCopy="Nothing is waiting in Planned."
        action={canEdit ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => onOpenComposer('planned')}
            >
              Add task
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2"
              icon={<InboxArrowDownIcon />}
              disabled={planned.length === 0 || !firstOpenColumn || movingAll}
              loading={movingAll}
              onClick={onMovePlannedToBoard}
            >
              Move all to {firstOpenColumn?.name ?? 'board'}
            </Button>
          </>
        ) : undefined}
      >
        {canEdit && composerStatus === 'planned' && (
          <div className="border-t border-line px-4 py-2">
            <TaskComposer
              status="planned"
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
      </BacklogSection>

      <BacklogSection
        id="archived"
        title="Archived"
        description="Parked work that keeps its details without taking up a lane."
        icon={<ArchiveBoxIcon />}
        tasks={archived}
        columns={columns}
        display={display}
        labels={labels}
        members={members}
        selection={selection}
        selectionMode={selectionMode}
        filtering={filtering}
        canEdit={canEdit}
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        onOpenMenu={onOpenMenu}
        onQuickPick={onQuickPick}
        onOpenNote={onOpenNote}
        onDropTask={(taskId) => {
          const task = [...planned, ...archived].find((candidate) => candidate.id === taskId);
          if (task) onMoveTask(task, 'archived');
        }}
        emptyCopy="Nothing is archived. Archiving a task keeps it out of the board without deleting it."
      />
    </div>
  );
}
