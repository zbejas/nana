import { useEffect, useRef, useState } from 'react';
import { ArrowTopRightOnSquareIcon, TrashIcon } from '@heroicons/react/20/solid';
import type { CreateTaskData, Task, TaskPriority, TaskStatus, UpdateTaskData } from '../../lib/tasks';
import { Button, ConfirmDialog, Dialog, Field, Input, Select, Textarea } from '../ui';
import { BOARD_COLUMNS, PRIORITIES } from './board-config';

interface TaskDialogProps {
  open: boolean;
  task: Task | null;
  defaultStatus: TaskStatus;
  onClose: () => void;
  onSubmit: (data: CreateTaskData | UpdateTaskData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenDocument: (documentId: string) => void;
}

function toDateInput(value: string | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function TaskDialog({
  open,
  task,
  defaultStatus,
  onClose,
  onSubmit,
  onDelete,
  onOpenDocument,
}: TaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setStatus(task?.status ?? defaultStatus);
    setPriority(task?.priority ?? '');
    setDueDate(toDateInput(task?.due_date));
    setLabels((task?.labels ?? []).join(', '));
    setError(null);
    setIsSaving(false);
    setShowDelete(false);
  }, [open, task, defaultStatus]);

  const handleSubmit = async () => {
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
        status,
        priority,
        due_date: dueDate ? `${dueDate} 00:00:00.000Z` : '',
        labels: labels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      } as CreateTaskData);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save the task.');
    } finally {
      setIsSaving(false);
    }
  };

  const documentId = task?.document;
  const documentTitle = task?.expand?.document?.title;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        eyebrow={task ? 'Task' : 'New task'}
        title={task ? 'Edit task' : 'Add to the board'}
        description={task ? undefined : 'Tasks are separate from notes. Link one to a note when the work came from your writing.'}
        size="md"
        initialFocusRef={titleRef}
        footer={
          <>
            {task && (
              <Button
                variant="ghost"
                className="mr-auto text-danger hover:bg-danger-soft hover:text-danger"
                icon={<TrashIcon />}
                onClick={() => setShowDelete(true)}
                disabled={isSaving}
              >
                Delete
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleSubmit()} loading={isSaving}>
              {task ? 'Save task' : 'Create task'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="Title" htmlFor="task-title" error={error}>
            <Input
              id="task-title"
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to happen?"
              invalid={Boolean(error)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </Field>

          <Field label="Notes" htmlFor="task-description" hint="Markdown is supported." optional>
            <Textarea
              id="task-description"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Context, acceptance criteria, links…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Column" htmlFor="task-status">
              <Select id="task-status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
                {BOARD_COLUMNS.map((column) => (
                  <option key={column.status} value={column.status}>
                    {column.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Priority" htmlFor="task-priority">
              <Select
                id="task-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
              >
                <option value="">No priority</option>
                {PRIORITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Due date" htmlFor="task-due" optional>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>

            <Field label="Labels" htmlFor="task-labels" hint="Comma separated." optional>
              <Input
                id="task-labels"
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="research, writing"
              />
            </Field>
          </div>

          {documentId && (
            <button
              type="button"
              onClick={() => onOpenDocument(documentId)}
              className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-sunken/60 px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="eyebrow block">From note</span>
                <span className="mt-1 block truncate text-sm text-ink">
                  {documentTitle || 'Open the linked note'}
                </span>
              </span>
              <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-ink-muted" />
            </button>
          )}
        </div>
      </Dialog>

      {task && (
        <ConfirmDialog
          open={showDelete}
          title="Delete this task?"
          description="The task is removed from the board. The note it came from stays untouched."
          confirmLabel="Delete task"
          tone="danger"
          onConfirm={() => {
            void onDelete(task.id).then(() => {
              setShowDelete(false);
              onClose();
            });
          }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </>
  );
}
