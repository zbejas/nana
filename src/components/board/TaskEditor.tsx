import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  AdjustmentsHorizontalIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';
import type { Task, TaskDraft, TaskPriority, TaskStatus } from '../../lib/tasks';
import { Button, cn, ConfirmDialog, Field, Input, Select, Textarea } from '../ui';
import { BOARD_COLUMNS, PRIORITIES } from './board-config';

interface TaskEditorProps {
  mode: 'create' | 'edit';
  task?: Task | null;
  status?: TaskStatus;
  autoFocus?: boolean;
  /** Keep the composer open and clear it after a create, for fast entry. */
  keepOpenOnSubmit?: boolean;
  /** `panel` drops the card chrome when the editor sits inside a SidePanel. */
  surface?: 'card' | 'panel';
  onCancel: () => void;
  onSubmit: (data: TaskDraft) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onOpenDocument?: (documentId: string) => void;
}

function toDateInput(value: string | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function initialStatus(mode: 'create' | 'edit', task: Task | null | undefined, status?: TaskStatus): TaskStatus {
  if (mode === 'edit' && task) return task.status;
  return status ?? 'backlog';
}

/**
 * The whole task form, inline. Create mode is a compact composer at the end of
 * a lane; edit mode replaces the card it edits. No centred dialog, no scrim.
 */
export function TaskEditor({
  mode,
  task = null,
  status,
  autoFocus = false,
  keepOpenOnSubmit = true,
  surface = 'card',
  onCancel,
  onSubmit,
  onDelete,
  onOpenDocument,
}: TaskEditorProps) {
  const id = useId();
  const isEdit = mode === 'edit' && Boolean(task);
  const [title, setTitle] = useState(isEdit ? task?.title ?? '' : '');
  const [description, setDescription] = useState(isEdit ? task?.description ?? '' : '');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(
    initialStatus(mode, task, status)
  );
  const [priority, setPriority] = useState<TaskPriority | ''>(
    isEdit ? task?.priority ?? '' : ''
  );
  const [dueDate, setDueDate] = useState(isEdit ? toDateInput(task?.due_date) : '');
  const [labels, setLabels] = useState(isEdit ? (task?.labels ?? []).join(', ') : '');
  const [detailsOpen, setDetailsOpen] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(isEdit ? task?.title ?? '' : '');
    setDescription(isEdit ? task?.description ?? '' : '');
    setTaskStatus(initialStatus(mode, task, status));
    setPriority(isEdit ? task?.priority ?? '' : '');
    setDueDate(isEdit ? toDateInput(task?.due_date) : '');
    setLabels(isEdit ? (task?.labels ?? []).join(', ') : '');
    setDetailsOpen(isEdit);
    setError(null);
    setIsSaving(false);
    setShowDelete(false);
    setIsDeleting(false);
  }, [isEdit, task?.id, status, mode]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, isEdit]);

  const clearComposer = () => {
    setTitle('');
    setDescription('');
    setPriority('');
    setDueDate('');
    setLabels('');
    setDetailsOpen(false);
    setError(null);
    window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  };

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();

    if (!title.trim()) {
      setError('Give the task a title first.');
      titleRef.current?.focus();
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        title: title.trim(),
        description,
        status: taskStatus,
        priority,
        due_date: dueDate ? `${dueDate} 00:00:00.000Z` : '',
        labels: labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      });

      if (isEdit) {
        onCancel();
      } else if (keepOpenOnSubmit) {
        clearComposer();
      } else {
        onCancel();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save the task.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // The delete confirmation is portalled but still bubbles through this
    // React tree; Escape belongs to the alert dialog while it is open.
    if (showDelete) return;

    if (event.key === 'Escape' && !isSaving) {
      event.preventDefault();
      if (!isEdit && detailsOpen) {
        setDetailsOpen(false);
        return;
      }
      onCancel();
      return;
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const linkedDocument = isEdit ? task?.expand?.document : undefined;
  const documentId = linkedDocument?.id;

  const handleDelete = async () => {
    if (!task || !onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(task.id);
      setShowDelete(false);
      onCancel();
    } catch (deleteError) {
      setShowDelete(false);
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the task.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <form
        onSubmit={(event) => void handleSubmit(event)}
        onKeyDown={handleKeyDown}
        aria-label={isEdit ? `Edit ${task?.title || 'task'}` : 'New task'}
        className={cn(
          isEdit
            ? surface === 'panel'
              ? 'space-y-3'
              : 'rounded-[7px] border border-signal/50 bg-surface p-3.5 ring-4 ring-signal/5'
            : 'animate-slideDown rounded-[8px] border border-line-strong bg-surface p-3',
          !isEdit && detailsOpen && 'max-h-[calc(100dvh-24rem)] overflow-y-auto scrollbar-autohide'
        )}
      >
        <div className="space-y-2.5">
          <Input
            ref={titleRef}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error && event.target.value.trim()) setError(null);
            }}
            placeholder={isEdit ? 'Task title' : 'What needs to happen?'}
            aria-label="Task title"
            data-autofocus={autoFocus || undefined}
            invalid={Boolean(error)}
            className="h-9 text-[13.5px]"
            autoComplete="off"
          />

          {detailsOpen && (
            <div className="animate-slideDown space-y-3">
              <Field label="Notes" htmlFor={`${id}-notes`} hint="Markdown is supported." optional>
                <Textarea
                  id={`${id}-notes`}
                  rows={4}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Context, acceptance criteria, links…"
                  className="min-h-[5.5rem] text-[12.5px]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Column" htmlFor={`${id}-status`}>
                  <Select
                    id={`${id}-status`}
                    value={taskStatus}
                    onChange={(event) => setTaskStatus(event.target.value as TaskStatus)}
                    className="h-9 text-[12.5px]"
                  >
                    {BOARD_COLUMNS.map((column) => (
                      <option key={column.status} value={column.status}>
                        {column.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Priority" htmlFor={`${id}-priority`}>
                  <Select
                    id={`${id}-priority`}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
                    className="h-9 text-[12.5px]"
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
                    className="h-9 px-2.5 text-[12.5px]"
                  />
                </Field>

                <Field label="Labels" htmlFor={`${id}-labels`} optional>
                  <Input
                    id={`${id}-labels`}
                    value={labels}
                    onChange={(event) => setLabels(event.target.value)}
                    placeholder="research, writing"
                    className="h-9 text-[12.5px]"
                  />
                </Field>
              </div>

              {documentId && (
                <button
                  type="button"
                  onClick={() => onOpenDocument?.(documentId)}
                  className="flex w-full items-center gap-2.5 rounded-control border border-line bg-surface-sunken px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10.5px] font-medium text-ink-muted">From note</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink">
                      {linkedDocument?.title || 'Open the linked note'}
                    </span>
                  </span>
                  <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="text-[11.5px] leading-relaxed text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {isEdit && onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto h-7 px-2 text-danger hover:bg-danger-soft hover:text-danger"
                icon={<TrashIcon />}
                onClick={() => setShowDelete(true)}
                disabled={isSaving || isDeleting}
              >
                Delete
              </Button>
            )}

            {!isEdit && (
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                className="inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-[11.5px] font-medium text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
              >
                <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {detailsOpen ? 'Hide details' : 'Add details'}
                <ChevronDownIcon
                  className={`h-3 w-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 ${isEdit ? '' : 'ml-auto'}`}
              onClick={onCancel}
              disabled={isSaving || isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="h-7 px-2.5"
              icon={isEdit ? undefined : <PlusIcon />}
              loading={isSaving}
              disabled={isDeleting}
            >
              {isEdit ? 'Save task' : 'Add task'}
            </Button>
          </div>
        </div>
      </form>

      {isEdit && task && (
        <ConfirmDialog
          open={showDelete}
          title="Delete this task?"
          description="The task is removed from the board. The note it came from stays untouched."
          confirmLabel="Delete task"
          tone="danger"
          busy={isDeleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            if (!isDeleting) setShowDelete(false);
          }}
        />
      )}
    </>
  );
}
