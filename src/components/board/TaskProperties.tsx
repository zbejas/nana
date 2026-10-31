import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  FlagIcon,
  UserCircleIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task, TaskLabel, TaskPriority, TaskRecurrence } from '../../lib/tasks';
import { Avatar, cn } from '../ui';
import {
  AssigneeMenu,
  DateMenu,
  LabelsMenu,
  PriorityMenu,
  RecurrenceMenu,
  StatusMenu,
  TaskPopover,
  type AssigneeOption,
} from './TaskPropertyPickers';
import {
  formatDateLabel,
  formatRecurrenceLabel,
  isDateOverdue,
  labelToneClass,
  priorityLabel,
  statusOption,
} from './task-panel-model';

export interface TaskPropertiesProps {
  task: Task;
  columns: ReadonlyArray<BoardColumn>;
  labels: TaskLabel[];
  members: AssigneeOption[];
  canEdit: boolean;
  isOwner: boolean;
  onStatusChange: (status: string) => void;
  onPriorityChange: (priority: TaskPriority | '') => void;
  onAssigneeChange: (member: AssigneeOption | null) => void;
  onDateChange: (field: 'start_date' | 'due_date', value: string) => void;
  onLabelsChange: (labels: string[]) => void;
  onLabelCreated: (label: TaskLabel) => void;
  onRecurrenceChange: (recurrence: TaskRecurrence | null) => void;
  onOpenDocument: (documentId: string) => void;
}

type PickerKey =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'start'
  | 'due'
  | 'labels'
  | 'recurrence';

function PropertyRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('task-property', className)}>
      <span className="task-property__label">{label}</span>
      {children}
    </div>
  );
}

function PropertyButton({
  children,
  onClick,
  canEdit,
  className,
  label,
  expanded,
  buttonRef,
}: {
  children: ReactNode;
  onClick?: () => void;
  canEdit: boolean;
  className?: string;
  label: string;
  expanded?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      aria-haspopup={canEdit ? 'dialog' : undefined}
      aria-expanded={canEdit ? expanded : undefined}
      aria-disabled={!canEdit || undefined}
      onClick={canEdit ? onClick : undefined}
      className={cn(
        'task-property__value flex min-h-8 w-full min-w-0 items-center gap-2 rounded-control px-1.5 py-1 text-left text-[12.5px] text-ink-secondary transition-colors',
        canEdit && 'hover:bg-surface-sunken hover:text-ink',
        !canEdit && 'cursor-default',
        className
      )}
    >
      {children}
    </button>
  );
}

function muted(value: string): ReactNode {
  return <span className="min-w-0 truncate text-ink-muted">{value}</span>;
}

/**
 * Desktop properties rail that collapses to wrapping chips above the
 * description on mobile. One DOM node serves both layouts via CSS.
 */
export function TaskProperties({
  task,
  columns,
  labels,
  members,
  canEdit,
  isOwner,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDateChange,
  onLabelsChange,
  onLabelCreated,
  onRecurrenceChange,
  onOpenDocument,
}: TaskPropertiesProps) {
  const [picker, setPicker] = useState<PickerKey | null>(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const assigneeRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLButtonElement>(null);
  const labelsRef = useRef<HTMLButtonElement>(null);
  const recurrenceRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPicker(null);
  }, [task.id]);

  const close = () => setPicker(null);
  const status = statusOption(task.status, columns);
  const assignee = task.expand?.assignee;
  const selectedLabels = task.labels;
  const labelDefinitions = new Map(labels.map((label) => [label.name.toLowerCase(), label]));
  const linkedDocument = task.expand?.document;
  const dueOverdue = isDateOverdue(task.due_date) && !status.isFinal;
  const startLabel = task.start_date ? formatDateLabel(task.start_date) : '';
  const dueLabel = task.due_date ? formatDateLabel(task.due_date) : '';

  return (
    <aside className="task-panel__properties" aria-label="Task properties">
      <h3 className="task-properties__title">Properties</h3>

      <PropertyRow label="Status" className="task-property--status">
        <PropertyButton
          label={`Status: ${status.label}`}
          canEdit={canEdit}
          onClick={() => setPicker('status')}
          expanded={picker === 'status'}
          buttonRef={statusRef}
        >
          <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot(status.color, status.isFinal))} aria-hidden="true" />
          <span className="min-w-0 truncate text-ink">{status.label}</span>
        </PropertyButton>
        <TaskPopover
          open={picker === 'status'}
          onClose={close}
          anchorRef={statusRef}
          label="Change status"
        >
          <StatusMenu
            value={task.status}
            columns={columns}
            onSelect={(next) => {
              close();
              onStatusChange(next);
            }}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Priority">
        <PropertyButton
          label={`Priority: ${priorityLabel(task.priority)}`}
          canEdit={canEdit}
          onClick={() => setPicker('priority')}
          expanded={picker === 'priority'}
          buttonRef={priorityRef}
        >
          <FlagIcon className={cn('h-3.5 w-3.5 shrink-0', task.priority ? 'text-ink-muted' : 'text-ink-muted')} />
          {task.priority ? (
            <span className="min-w-0 truncate text-ink">{priorityLabel(task.priority)}</span>
          ) : (
            muted('No priority')
          )}
        </PropertyButton>
        <TaskPopover
          open={picker === 'priority'}
          onClose={close}
          anchorRef={priorityRef}
          label="Change priority"
        >
          <PriorityMenu
            value={task.priority}
            onSelect={(next) => {
              close();
              onPriorityChange(next);
            }}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Assignee">
        <PropertyButton
          label={`Assignee: ${assignee?.name || 'Unassigned'}`}
          canEdit={canEdit}
          onClick={() => setPicker('assignee')}
          expanded={picker === 'assignee'}
          buttonRef={assigneeRef}
        >
          {assignee ? (
            <>
              <Avatar src={assignee.avatar} name={assignee.name} className="h-5 w-5 text-[9px]" />
              <span className="min-w-0 truncate text-ink">{assignee.name || 'Unnamed'}</span>
            </>
          ) : (
            <>
              <UserCircleIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
              {muted('Unassigned')}
            </>
          )}
        </PropertyButton>
        <TaskPopover
          open={picker === 'assignee'}
          onClose={close}
          anchorRef={assigneeRef}
          label="Change assignee"
        >
          <AssigneeMenu
            assignedId={task.assignee ?? ''}
            members={members}
            canSearch={isOwner}
            onSelect={(member) => {
              close();
              onAssigneeChange(member);
            }}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Start">
        <PropertyButton
          label={`Start date: ${startLabel || 'not set'}`}
          canEdit={canEdit}
          onClick={() => setPicker('start')}
          expanded={picker === 'start'}
          buttonRef={startRef}
        >
          <CalendarDaysIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          {startLabel ? <span className="min-w-0 truncate text-ink">{startLabel}</span> : muted('No start date')}
        </PropertyButton>
        <TaskPopover
          open={picker === 'start'}
          onClose={close}
          anchorRef={startRef}
          label="Set start date"
        >
          <DateMenu
            value={task.start_date}
            label="Start date"
            onSelect={(next) => {
              close();
              onDateChange('start_date', next);
            }}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Due">
        <PropertyButton
          label={`Due date: ${dueLabel || 'not set'}`}
          canEdit={canEdit}
          onClick={() => setPicker('due')}
          expanded={picker === 'due'}
          buttonRef={dueRef}
        >
          <CalendarDaysIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          {dueLabel ? (
            <span className={cn('min-w-0 truncate', dueOverdue ? 'font-medium text-danger' : 'text-ink')}>
              {dueLabel}
            </span>
          ) : (
            muted('No due date')
          )}
        </PropertyButton>
        <TaskPopover
          open={picker === 'due'}
          onClose={close}
          anchorRef={dueRef}
          label="Set due date"
        >
          <DateMenu
            value={task.due_date}
            label="Due date"
            onSelect={(next) => {
              close();
              onDateChange('due_date', next);
            }}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Labels" className="task-property--labels">
        <PropertyButton
          label={`Labels: ${selectedLabels.length > 0 ? selectedLabels.join(', ') : 'none'}`}
          canEdit={canEdit}
          onClick={() => setPicker('labels')}
          expanded={picker === 'labels'}
          buttonRef={labelsRef}
        >
          {selectedLabels.length > 0 ? (
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {selectedLabels.map((name) => (
                <span key={name} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      labelToneClass(labelDefinitions.get(name.toLowerCase())?.color)
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate text-ink">{name}</span>
                </span>
              ))}
            </span>
          ) : (
            muted('No labels')
          )}
        </PropertyButton>
        <TaskPopover
          open={picker === 'labels'}
          onClose={close}
          anchorRef={labelsRef}
          label="Change labels"
          width={340}
        >
          <LabelsMenu
            definitions={labels}
            selected={selectedLabels}
            canCreate={isOwner && canEdit}
            onToggle={(name, nextSelected) => {
              const next = nextSelected
                ? [...selectedLabels.filter((label) => label !== name), name]
                : selectedLabels.filter((label) => label !== name);
              onLabelsChange(next);
            }}
            onCreated={onLabelCreated}
          />
        </TaskPopover>
      </PropertyRow>

      <PropertyRow label="Linked note" className="task-property--note">
        {linkedDocument ? (
          <button
            type="button"
            onClick={() => onOpenDocument(linkedDocument.id)}
            className="task-property__value flex min-h-8 w-full min-w-0 items-center gap-2 rounded-control px-1.5 py-1 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            title={`Open ${linkedDocument.title || 'linked note'}`}
          >
            <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="min-w-0 truncate text-ink">{linkedDocument.title || 'Linked note'}</span>
          </button>
        ) : (
          <span className="task-property__value flex min-h-8 w-full items-center gap-2 px-1.5 py-1 text-[12.5px]">
            <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            {muted('No linked note')}
          </span>
        )}
      </PropertyRow>

      <PropertyRow label="Repeat" className="task-property--recurrence">
        <PropertyButton
          label={`Repeat: ${formatRecurrenceLabel(task.recurrence)}`}
          canEdit={canEdit}
          onClick={() => setPicker('recurrence')}
          expanded={picker === 'recurrence'}
          buttonRef={recurrenceRef}
        >
          <ArrowPathIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          {task.recurrence ? (
            <span className="min-w-0 truncate text-ink">{formatRecurrenceLabel(task.recurrence)}</span>
          ) : (
            muted('Does not repeat')
          )}
        </PropertyButton>
        <TaskPopover
          open={picker === 'recurrence'}
          onClose={close}
          anchorRef={recurrenceRef}
          label="Change repeat"
        >
          <RecurrenceMenu
            value={task.recurrence ?? null}
            onSelect={(next) => {
              onRecurrenceChange(next);
              if (!next) close();
            }}
          />
        </TaskPopover>
      </PropertyRow>
    </aside>
  );
}

function statusDot(color: string, final: boolean): string {
  if (color === 'success' || final) return 'bg-success';
  if (color === 'warning') return 'bg-warning';
  if (color === 'signal') return 'bg-signal';
  return 'bg-ink-muted';
}
