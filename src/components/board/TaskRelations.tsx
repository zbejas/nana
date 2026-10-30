import { useMemo, useRef, useState } from 'react';
import {
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import {
  createTaskRelation,
  deleteTaskRelation,
  type Task,
  type TaskRelation,
} from '../../lib/tasks';
import { useToasts } from '../../state/hooks';
import {
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  SegmentedControl,
  cn,
} from '../ui';
import { TaskSection } from './TaskSection';
import { TaskPopover } from './TaskPropertyPickers';
import {
  formatTaskNumber,
  isFinalStatus,
  relationGroups,
  relationPayload,
  relationPickerLabel,
  statusDotClass,
  type RelationEntry,
  type RelationPickerType,
} from './task-panel-model';

interface TaskRelationsProps {
  task: Task;
  columns: ReadonlyArray<BoardColumn>;
  relations: ReadonlyArray<TaskRelation>;
  boardTasks: ReadonlyArray<Task>;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onRelationAdded: (relation: TaskRelation) => void;
  onRelationRemoved: (relationId: string) => void;
  onChanged: (task?: Task) => void;
}

const RELATION_TYPES: Array<{ value: RelationPickerType; label: string }> = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked-by', label: 'Blocked by' },
  { value: 'related', label: 'Related' },
];

function relationTargetIds(
  relations: ReadonlyArray<TaskRelation>,
  taskId: string,
  type: RelationPickerType
): Set<string> {
  const ids = new Set<string>();
  for (const relation of relations) {
    if (type === 'blocks' && relation.type === 'blocks' && relation.source === taskId) {
      ids.add(relation.target);
    } else if (type === 'blocked-by' && relation.type === 'blocks' && relation.target === taskId) {
      ids.add(relation.source);
    } else if (type === 'related' && relation.type === 'related') {
      if (relation.source === taskId) ids.add(relation.target);
      if (relation.target === taskId) ids.add(relation.source);
    }
  }
  return ids;
}

function RelationRows({
  entries,
  columns,
  canEdit,
  onOpenTask,
  onRemove,
}: {
  entries: RelationEntry[];
  columns: ReadonlyArray<BoardColumn>;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onRemove: (entry: RelationEntry) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <ul className="task-relations__list">
      {entries.map((entry) => {
        const target = entry.task;
        const done = target ? isFinalStatus(target.status, columns) : false;
        return (
          <li key={entry.relation.id} className="task-relation">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                target ? statusDotClass(target.status, columns) : 'bg-ink-muted'
              )}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => target && onOpenTask(target.id)}
              disabled={!target}
              className={cn(
                'min-w-0 flex-1 truncate text-left text-[12.5px] text-ink transition-colors hover:text-signal disabled:cursor-default disabled:text-ink-muted',
                done && 'text-ink-muted line-through decoration-ink-muted/50'
              )}
            >
              {target?.title || 'Task unavailable'}
            </button>
            {target && (
              <IconButton
                label={`Open ${target.title || 'related task'}`}
                size="sm"
                className="task-relation__open"
                onClick={() => onOpenTask(target.id)}
              >
                <ArrowTopRightOnSquareIcon />
              </IconButton>
            )}
            {canEdit && (
              <IconButton
                label="Remove relation"
                size="sm"
                className="task-relation__remove text-ink-muted hover:text-danger"
                onClick={() => onRemove(entry)}
              >
                <XMarkIcon />
              </IconButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TaskRelations({
  task,
  columns,
  relations,
  boardTasks,
  canEdit,
  onOpenTask,
  onRelationAdded,
  onRelationRemoved,
  onChanged,
}: TaskRelationsProps) {
  const { showToast } = useToasts();
  const addRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [type, setType] = useState<RelationPickerType>('blocks');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RelationEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const groups = useMemo(
    () => relationGroups(relations, task.id, boardTasks),
    [relations, task.id, boardTasks]
  );
  const existingTargets = useMemo(
    () => relationTargetIds(relations, task.id, type),
    [relations, task.id, type]
  );

  const needle = query.trim().toLowerCase();
  const candidates = boardTasks
    .filter((candidate) => candidate.id !== task.id)
    .filter((candidate) => !existingTargets.has(candidate.id))
    .filter((candidate) => {
      if (!needle) return true;
      return (
        candidate.title.toLowerCase().includes(needle) ||
        formatTaskNumber(candidate.task_number).toLowerCase().includes(needle)
      );
    })
    .slice(0, 40);

  const handlePick = async (candidate: Task) => {
    if (!canEdit || busyId) return;
    if (candidate.id === task.id) {
      setError('A task cannot relate to itself.');
      return;
    }

    setBusyId(candidate.id);
    setError(null);
    try {
      const relation = await createTaskRelation(relationPayload(type, task.id, candidate.id));
      onRelationAdded(relation);
      onChanged();
      showToast(`${relationPickerLabel(type)} relation added.`, 'success');
      setPickerOpen(false);
      setQuery('');
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Could not add the relation.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setDeleteBusy(true);
    try {
      await deleteTaskRelation(removing.relation.id);
      onRelationRemoved(removing.relation.id);
      onChanged();
      showToast('Relation removed.', 'info');
      setRemoving(null);
    } catch (removeError) {
      showToast(
        removeError instanceof Error ? removeError.message : 'Could not remove the relation.',
        'error'
      );
      setRemoving(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const total = groups.blocks.length + groups.blockedBy.length + groups.related.length;
  const groupList: Array<{ key: keyof typeof groups; label: string; entries: RelationEntry[] }> = [
    { key: 'blocks', label: 'Blocks', entries: groups.blocks },
    { key: 'blockedBy', label: 'Blocked by', entries: groups.blockedBy },
    { key: 'related', label: 'Related', entries: groups.related },
  ];

  return (
    <TaskSection
      title="Relations"
      count={total}
      id="task-relations"
      action={
        canEdit ? (
          <Button
            ref={addRef}
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-ink-muted"
            icon={<PlusIcon />}
            onClick={() => setPickerOpen((open) => !open)}
          >
            Add relation
          </Button>
        ) : undefined
      }
    >
      {total === 0 ? (
        <p className="px-0.5 py-1 text-[12.5px] leading-relaxed text-ink-muted">
          No links yet. Blockers and related tasks appear here.
        </p>
      ) : (
        <div className="task-relations">
          {groupList.map((group) =>
            group.entries.length > 0 ? (
              <div key={group.key} className="task-relations__group">
                <h4 className="task-relations__group-title">
                  {group.label}{' '}
                  <span className="ml-0.5 font-normal tabular-nums text-ink-muted">
                    {group.entries.length}
                  </span>
                </h4>
                <RelationRows
                  entries={group.entries}
                  columns={columns}
                  canEdit={canEdit}
                  onOpenTask={onOpenTask}
                  onRemove={setRemoving}
                />
              </div>
            ) : null
          )}
        </div>
      )}

      <TaskPopover
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchorRef={addRef}
        label="Add relation"
        width={340}
        align="end"
      >
        <div className="space-y-2 px-1 pb-2">
          <SegmentedControl
            value={type}
            onChange={(next) => setType(next)}
            label="Relation type"
            options={RELATION_TYPES}
            size="sm"
            className="w-full"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            icon={<MagnifyingGlassIcon />}
            placeholder="Find a task on this board…"
            aria-label="Find a task"
            className="h-9 text-[12.5px]"
            data-autofocus
          />
        </div>

        {error && (
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-danger" role="alert">
            {error}
          </p>
        )}

        <div role="menu" aria-label="Tasks">
          {candidates.length === 0 ? (
            <p className="px-2 py-4 text-center text-[12px] leading-relaxed text-ink-muted">
              {boardTasks.length <= 1
                ? 'No other tasks on this board yet.'
                : 'No matching tasks. Everything is already linked.'}
            </p>
          ) : (
            candidates.map((candidate) => {
              const done = isFinalStatus(candidate.status, columns);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitem"
                  disabled={busyId === candidate.id}
                  onClick={() => void handlePick(candidate)}
                  className="flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12.5px] text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
                >
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDotClass(candidate.status, columns))}
                    aria-hidden="true"
                  />
                  {candidate.task_number && (
                    <span className="shrink-0 text-[10.5px] tabular-nums text-ink-muted">
                      {formatTaskNumber(candidate.task_number)}
                    </span>
                  )}
                  <span className={cn('min-w-0 flex-1 truncate', done && 'text-ink-muted line-through')}>
                    {candidate.title || 'Untitled task'}
                  </span>
                  {busyId === candidate.id && <span className="text-[10.5px] text-ink-muted">Adding…</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-1 flex items-center gap-1.5 border-t border-line px-2 pt-2 text-[10.5px] text-ink-muted">
          <LinkIcon className="h-3 w-3" />
          Relations save immediately.
        </div>
      </TaskPopover>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this relation?"
        description={
          removing?.task
            ? `The ${relationPickerLabel(
                removing.relation.type === 'blocks' && removing.relation.target === task.id
                  ? 'blocked-by'
                  : removing.relation.type === 'related'
                    ? 'related'
                    : 'blocks'
              ).toLowerCase()} link to “${removing.task.title || 'this task'}” is removed. Both tasks stay on the board.`
            : 'The link is removed. Both tasks stay on the board.'
        }
        confirmLabel="Remove relation"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleRemove()}
        onCancel={() => {
          if (!deleteBusy) setRemoving(null);
        }}
      />
    </TaskSection>
  );
}
