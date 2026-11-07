import { useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentIcon,
  PaperClipIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';
import { describeAttachment } from '../../lib/attachments';
import { getTaskAttachmentUrl, updateTaskAttachments, type Task } from '../../lib/tasks';
import { IconButton, Spinner, cn } from '../ui';
import { LazyAttachmentViewer } from '../modals/LazyAttachmentViewer';
import { useToasts } from '../../state/hooks';
import { TaskSection } from './TaskSection';
import './task-attachments.css';

const ACCEPTED_TYPES = 'image/*,application/pdf,text/plain,text/markdown';
const MAX_FILES = 20;

interface TaskAttachmentsProps {
  task: Task;
  canEdit: boolean;
  onUpdated: (task: Task) => void;
}

export function TaskAttachments({ task, canEdit, onUpdated }: TaskAttachmentsProps) {
  const { showToast } = useToasts();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; filename: string } | null>(null);

  const attachments = task.attachments ?? [];
  const remaining = Math.max(0, MAX_FILES - attachments.length);

  const upload = async (files: File[]) => {
    if (!canEdit || busy || files.length === 0) return;
    if (files.length > remaining) {
      showToast(
        remaining === 0
          ? 'This task already has the maximum of 20 attachments.'
          : `Add up to ${remaining} more attachment${remaining === 1 ? '' : 's'}.`,
        'error'
      );
      return;
    }

    setBusy(true);
    try {
      const updated = await updateTaskAttachments(task.id, {
        keep: attachments,
        add: files,
      });
      onUpdated(updated);
      showToast(
        `${files.length} attachment${files.length === 1 ? '' : 's'} added`,
        'success'
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not upload the attachment.',
        'error'
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (filename: string) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      const updated = await updateTaskAttachments(task.id, {
        keep: attachments.filter((entry) => entry !== filename),
      });
      onUpdated(updated);
      showToast('Attachment removed', 'info');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not remove the attachment.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  const open = (filename: string) => {
    const info = describeAttachment(filename);
    if (info.kind === 'image' || info.kind === 'pdf' || info.kind === 'text') {
      setViewer({ url: getTaskAttachmentUrl(task, filename), filename: info.name });
      return;
    }
    const url = getTaskAttachmentUrl(task, filename);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = info.name;
    anchor.rel = 'noopener';
    anchor.click();
  };

  return (
    <TaskSection title="Attachments" id="task-attachments">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void upload(files);
        }}
      />

      {attachments.length === 0 && !canEdit ? (
        <p className="px-0.5 py-1 text-[12.5px] text-ink-muted">No attachments.</p>
      ) : attachments.length === 0 ? (
        <div
          className={cn('task-attachments__empty-wrap', dragging && 'task-attachments--dragging')}
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(Array.from(event.dataTransfer.files));
          }}
        >
          <button
            type="button"
            className="task-attachments__empty"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Spinner label="Uploading attachment" />
            ) : (
              <>
                <ArrowUpTrayIcon className="h-4 w-4" aria-hidden="true" />
                <span>Add screenshots or files</span>
                <span className="task-attachment__hint">PNG, JPEG, WebP, PDF, text</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div
          className={cn('task-attachments', dragging && 'task-attachments--dragging')}
          onDragEnter={(event) => {
            if (!canEdit || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (!canEdit) return;
            event.preventDefault();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            setDragging(false);
            void upload(Array.from(event.dataTransfer.files));
          }}
        >
          {attachments.map((filename) => {
            const info = describeAttachment(filename);
            const thumb = getTaskAttachmentUrl(task, filename, '300x0');
            return (
              <div key={filename} className="task-attachment">
                <button
                  type="button"
                  className="task-attachment__open"
                  onClick={() => open(filename)}
                  aria-label={`Open ${info.name}`}
                  title={info.name}
                >
                  {info.kind === 'image' ? (
                    <img
                      src={thumb}
                      alt={info.name}
                      loading="lazy"
                      className="task-attachment__image"
                    />
                  ) : (
                    <span className="task-attachment__file">
                      {info.kind === 'pdf' ? (
                        <DocumentIcon className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <PaperClipIcon className="h-5 w-5" aria-hidden="true" />
                      )}
                      <span className="task-attachment__name">{info.name}</span>
                    </span>
                  )}
                  {info.kind === 'image' && (
                    <span className="task-attachment__caption">{info.name}</span>
                  )}
                </button>

                <div className="task-attachment__actions">
                  {info.kind === 'file' && (
                    <IconButton
                      label={`Download ${info.name}`}
                      size="sm"
                      className="h-8 w-8 bg-surface/90"
                      onClick={() => open(filename)}
                    >
                      <ArrowDownTrayIcon />
                    </IconButton>
                  )}
                  {canEdit && (
                    <IconButton
                      label={`Remove ${info.name}`}
                      size="sm"
                      className="h-8 w-8 bg-surface/90 text-danger hover:bg-danger-soft"
                      disabled={busy}
                      onClick={() => void remove(filename)}
                    >
                      <TrashIcon />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}

          {canEdit && remaining > 0 && (
            <button
              type="button"
              className="task-attachment task-attachment--add"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Spinner label="Uploading attachment" />
              ) : (
                <>
                  <PhotoIcon className="h-5 w-5" aria-hidden="true" />
                  <span>Add screenshot</span>
                  <span className="task-attachment__hint">or drop files</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <p className="task-panel__hint">
          {attachments.length} of {MAX_FILES} files. Click an image to preview it.
        </p>
      )}

      <LazyAttachmentViewer
        isOpen={viewer !== null}
        url={viewer?.url ?? ''}
        filename={viewer?.filename ?? ''}
        onClose={() => setViewer(null)}
      />
    </TaskSection>
  );
}
