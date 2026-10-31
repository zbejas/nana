import { useEffect, useId, useRef, useState } from 'react';
import { AdjustmentsHorizontalIcon, ChevronDownIcon, PlusIcon } from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { TaskDraft, TaskPriority } from '../../lib/tasks';
import { toIsoDay } from '../../lib/board-preferences';
import { Button, Field, Input, Select, Textarea, cn } from '../ui';
import { PRIORITIES } from './board-config';

interface TaskComposerProps {
  status: string;
  columns: BoardColumn[];
  autoFocus?: boolean;
  onCancel: () => void;
  onSubmit: (draft: TaskDraft) => Promise<void>;
}

/**
 * Lane composer: title first, with an optional details drawer. It sits at the
 * top of a lane so the primary action never scrolls out of view.
 */
export function TaskComposer({
  status,
  columns,
  autoFocus = true,
  onCancel,
  onSubmit,
}: TaskComposerProps) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const [taskStatus, setTaskStatus] = useState(status);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTaskStatus(status);
  }, [status]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const submit = async () => {
    if (!title.trim() || saving) {
      setError('Give the task a title first.');
      titleRef.current?.focus();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description,
        status: taskStatus,
        priority,
        due_date: dueDate ? toIsoDay(new Date(`${dueDate}T00:00:00`)) : '',
        labels: labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not add the task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          if (detailsOpen) setDetailsOpen(false);
          else onCancel();
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
      aria-label="New task"
      data-lane-composer={status}
      className="mb-2 rounded-[7px] border border-line-strong bg-surface p-2.5 shadow-none"
    >
      <Input
        ref={titleRef}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error && event.target.value.trim()) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !detailsOpen) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="What needs to happen?"
        aria-label="Task title"
        autoComplete="off"
        invalid={Boolean(error)}
        className="h-9 px-2.5 text-[13px]"
      />

      {detailsOpen && (
        <div className="mt-2.5 space-y-2.5">
          <Textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Context, acceptance criteria, links…"
            aria-label="Task details"
            className="min-h-16 px-2.5 py-2 text-[12px]"
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Column" htmlFor={`${id}-status`}>
              <Select
                id={`${id}-status`}
                value={taskStatus}
                onChange={(event) => setTaskStatus(event.target.value)}
                className="h-8 px-2 text-[12px]"
              >
                {columns.map((column) => (
                  <option key={column.slug} value={column.slug}>
                    {column.name}
                  </option>
                ))}
                <option value="planned">Planned</option>
              </Select>
            </Field>
            <Field label="Priority" htmlFor={`${id}-priority`}>
              <Select
                id={`${id}-priority`}
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
                className="h-8 px-2 text-[12px]"
              >
                <option value="">None</option>
                {PRIORITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due" htmlFor={`${id}-due`} optional>
              <Input
                id={`${id}-due`}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-8 px-2 text-[12px]"
              />
            </Field>
            <Field label="Labels" htmlFor={`${id}-labels`} optional>
              <Input
                id={`${id}-labels`}
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="research, writing"
                className="h-8 px-2 text-[12px]"
              />
            </Field>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          className="inline-flex h-8 items-center gap-1.5 rounded-control px-1.5 text-[11.5px] font-medium text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
        >
          <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {detailsOpen ? 'Hide details' : 'Add details'}
          <ChevronDownIcon
            className={cn('h-3 w-3 transition-transform', detailsOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 px-2"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="h-8 px-2.5"
          icon={<PlusIcon />}
          loading={saving}
        >
          Add task
        </Button>
      </div>
    </form>
  );
}
