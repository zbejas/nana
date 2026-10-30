import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowTopRightOnSquareIcon, CheckIcon, PlusIcon } from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import {
  createTask,
  createTaskRelation,
  deleteTask,
  statusLabel,
  updateTask,
  type Task,
  type TaskRelation,
} from '../../lib/tasks';
import { Avatar, IconButton, Input, cn } from '../ui';
import { TaskSection } from './TaskSection';
import {
  firstOpenStatus,
  isFinalStatus,
  statusDotClass,
  subtaskEntries,
  subtaskStatusTarget,
} from './task-panel-model';

interface TaskSubtasksProps {
  task: Task;
  columns: ReadonlyArray<BoardColumn>;
  relations: ReadonlyArray<TaskRelation>;
  boardTasks: ReadonlyArray<Task>;
  canEdit: boolean;
  isSubtask: boolean;
  onOpenTask: (taskId: string) => void;
  onBoardTaskPatched: (task: Task) => void;
  onBoardTaskAdded: (task: Task) => void;
  onRelationAdded: (relation: TaskRelation) => void;
  onChanged: (task?: Task) => void;
}

function nextOrder(tasks: ReadonlyArray<Task>, status: string): number {
  return tasks
    .filter((task) => task.status === status)
    .reduce((max, task) => Math.max(max, task.board_order ?? 0), -1) + 1;
}

export function TaskSubtasks({
  task,
  columns,
  relations,
  boardTasks,
  canEdit,
  isSubtask,
  onOpenTask,
  onBoardTaskPatched,
  onBoardTaskAdded,
  onRelationAdded,
  onChanged,
}: TaskSubtasksProps) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () => subtaskEntries(relations, task.id, boardTasks),
    [relations, task.id, boardTasks]
  );

  const handleAdd = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;

    setBusy(true);
    setError(null);
    const status = firstOpenStatus(columns);
    let created: Task | null = null;

    try {
      created = await createTask({
        title: clean,
        board: task.board,
        status,
        board_order: nextOrder(boardTasks, status),
      });

      const relation = await createTaskRelation({
        source: task.id,
        target: created.id,
        type: 'subtask',
      });

      onBoardTaskAdded(created);
      onRelationAdded(relation);
      onChanged(created);
      setTitle('');
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } catch (addError) {
      if (created) {
        try {
          await deleteTask(created.id);
        } catch {
          // The orphan is still visible on the board; the error below is the
          // useful part. A later refresh reconciles it.
        }
      }
      setError(addError instanceof Error ? addError.message : 'Could not add the subtask.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (child: Task, checked: boolean) => {
    if (!canEdit || rowBusy) return;

    const target = subtaskStatusTarget(checked, columns, task.status);
    if (!target) {
      setError('This board has no final column yet. Add one in board settings first.');
      return;
    }

    const previous = child;
    const optimistic: Task = {
      ...child,
      status: target,
      board_order: nextOrder(boardTasks, target),
    };

    setRowBusy(child.id);
    setError(null);
    onBoardTaskPatched(optimistic);

    try {
      const updated = await updateTask(child.id, {
        status: target,
        board_order: optimistic.board_order,
      });
      onBoardTaskPatched(updated);
      onChanged(updated);
    } catch (toggleError) {
      onBoardTaskPatched(previous);
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the subtask.');
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <TaskSection title="Subtasks" count={entries.length} id="task-subtasks">
      {entries.length === 0 ? (
        <p className="px-0.5 py-1 text-[12.5px] leading-relaxed text-ink-muted">
          {isSubtask
            ? 'No subtasks on this step.'
            : 'No subtasks yet. Break this task into smaller steps.'}
        </p>
      ) : (
        <ul className="task-subtasks__list">
          {entries.map((child) => {
            const done = isFinalStatus(child.status, columns);
            const assignee = child.expand?.assignee;
            return (
              <li key={child.id} className="task-subtask">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={`${done ? 'Reopen' : 'Complete'} ${child.title}`}
                  disabled={!canEdit || rowBusy === child.id}
                  onClick={() => void handleToggle(child, !done)}
                  className={cn('task-subtask__hit', !canEdit && 'cursor-default')}
                >
                  <span
                    className={cn(
                      'task-subtask__check',
                      done ? 'border-success bg-success text-on-signal' : 'border-line-strong bg-surface',
                      !canEdit && 'opacity-70'
                    )}
                    aria-hidden="true"
                  >
                    {done && <CheckIcon className="h-3 w-3" />}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenTask(child.id)}
                  className={cn(
                    'task-subtask__title min-w-0 flex-1 truncate text-left text-[12.5px] text-ink transition-colors hover:text-signal',
                    done && 'text-ink-muted line-through decoration-ink-muted/50'
                  )}
                >
                  {child.title || 'Untitled task'}
                </button>

                {assignee && (
                  <span title={assignee.name} className="shrink-0">
                    <Avatar src={assignee.avatar} name={assignee.name} className="h-5 w-5 text-[9px]" />
                  </span>
                )}

                <span
                  className="flex shrink-0 items-center gap-1.5"
                  title={statusLabel(child.status, columns)}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(child.status, columns))} aria-hidden="true" />
                </span>

                <IconButton
                  label={`Open ${child.title || 'subtask'}`}
                  size="sm"
                  className="task-subtask__open"
                  onClick={() => onOpenTask(child.id)}
                >
                  <ArrowTopRightOnSquareIcon />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}

      {isSubtask && (
        <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-ink-muted">
          This task is a subtask. Nana keeps subtasks one level deep.
        </p>
      )}

      {canEdit && !isSubtask && (
        <form onSubmit={(event) => void handleAdd(event)} className="mt-2 flex items-center gap-1.5">
          <Input
            ref={inputRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Add a subtask…"
            aria-label="New subtask title"
            className="h-9 text-[12.5px]"
            autoComplete="off"
            disabled={busy}
          />
          <IconButton
            label="Add subtask"
            size="md"
            className="task-subtask__add h-9 w-9"
            onClick={() => void handleAdd()}
            disabled={busy || !title.trim()}
          >
            <PlusIcon />
          </IconButton>
        </form>
      )}
    </TaskSection>
  );
}
