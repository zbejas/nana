import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';
import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  updateTaskComment,
  type TaskComment,
  type TaskCommentsResult,
} from '../../lib/tasks';
import { useAuth } from '../../lib/auth';
import { Avatar, Button, ConfirmDialog, Spinner } from '../ui';
import { MarkdownPreview } from '../MarkdownPreview';
import { NanaInlineMarkdownEditor } from '../editor/milkdown/NanaInlineMarkdownEditor';
import { TaskSection } from './TaskSection';
import { formatRelativeDate } from './dates';
import { COMMENT_VIEW_ONLY_COPY, canUseCommentComposer } from './task-panel-model';

interface TaskCommentsProps {
  taskId: string;
  canEdit: boolean;
  canComment?: boolean;
  isOwner: boolean;
  onChanged: () => void;
}

export function TaskComments({ taskId, canEdit, canComment, isOwner, onChanged }: TaskCommentsProps) {
  const { user } = useAuth();
  const [result, setResult] = useState<TaskCommentsResult | null>(null);
  const [items, setItems] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskComment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setResult(null);
    setItems([]);
    setEditingId(null);
    setEditBody('');
    setEditError(null);
    setDeleting(null);
    setBody('');
    setComposerError(null);

    void listTaskComments(taskId)
      .then((response) => {
        if (!current) return;
        setResult(response);
        setItems([...response.items].sort((left, right) => left.created.localeCompare(right.created)));
      })
      .catch((loadError) => {
        if (!current) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load comments.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [taskId, retryToken]);

  const canWrite = canUseCommentComposer(canComment, result?.canComment, canEdit);

  const handlePost = async () => {
    const text = body.trim();
    if (!text || posting) return;

    setPosting(true);
    setComposerError(null);
    try {
      const created = await createTaskComment(taskId, text);
      setItems((current) => [...current, created]);
      setBody('');
      onChanged();
    } catch (postError) {
      setComposerError(postError instanceof Error ? postError.message : 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  };

  const startEdit = (comment: TaskComment) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const text = editBody.trim();
    if (!text || savingEdit) return;

    setSavingEdit(true);
    setEditError(null);
    try {
      const updated = await updateTaskComment(editingId, text);
      setItems((current) => current.map((comment) => (comment.id === updated.id ? updated : comment)));
      setEditingId(null);
      setEditBody('');
      onChanged();
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : 'Could not save the comment.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteTaskComment(deleting.id);
      setItems((current) => current.filter((comment) => comment.id !== deleting.id));
      setDeleting(null);
      onChanged();
    } catch (deleteError) {
      setEditError(deleteError instanceof Error ? deleteError.message : 'Could not delete the comment.');
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const composerShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handlePost();
    }
  };

  return (
    <TaskSection title="Comments" count={items.length} id="task-comments">
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-ink-muted">
          <Spinner className="h-4 w-4" label="Loading comments" />
          Loading comments…
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowPathIcon />}
            onClick={() => setRetryToken((token) => token + 1)}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <div className="task-comments__empty">
              <ChatBubbleLeftRightIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                No comments yet.
                {canWrite ? ' Start the conversation.' : ''}
              </p>
            </div>
          ) : (
            <ol className="task-comments">
              {items.map((comment) => {
                const author = comment.author;
                const isAuthor = comment.canEdit || comment.author?.id === user?.id;
                const canRemove = comment.canDelete || isOwner;
                const edited = comment.updated && comment.updated !== comment.created;
                const editing = editingId === comment.id;

                return (
                  <li key={comment.id} className="task-comment">
                    <Avatar
                      src={author?.avatar}
                      name={author?.name || 'Someone'}
                      className="task-comment__avatar h-6 w-6 text-[9px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[12px] font-semibold text-ink">
                          {author?.id === user?.id ? 'You' : author?.name || 'Someone'}
                        </span>
                        <time
                          dateTime={comment.created}
                          title={new Date(comment.created).toLocaleString()}
                          className="text-[10.5px] tabular-nums text-ink-muted"
                        >
                          {formatRelativeDate(comment.created)}
                        </time>
                        {edited && <span className="text-[10.5px] text-ink-muted">Edited</span>}
                      </div>

                      {editing ? (
                        <div
                          className="mt-2 space-y-2"
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault();
                              void saveEdit();
                            }
                          }}
                        >
                          <NanaInlineMarkdownEditor
                            value={editBody}
                            onChange={setEditBody}
                            placeholder="Edit this comment…"
                            minHeight={64}
                            ariaLabel="Edit comment"
                            showToolbar
                            enableSlash
                          />
                          {editError && (
                            <p className="text-[11px] leading-relaxed text-danger" role="alert">
                              {editError}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => void saveEdit()}
                              loading={savingEdit}
                              disabled={!editBody.trim()}
                            >
                              Save comment
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingId(null);
                                setEditBody('');
                                setEditError(null);
                              }}
                              disabled={savingEdit}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="task-comment__body">
                            <MarkdownPreview content={comment.body} />
                          </div>
                          {(isAuthor || canRemove) && (
                            <div className="mt-1 flex items-center gap-1">
                              {isAuthor && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-ink-muted"
                                  icon={<PencilSquareIcon />}
                                  onClick={() => startEdit(comment)}
                                >
                                  Edit
                                </Button>
                              )}
                              {canRemove && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-ink-muted hover:text-danger"
                                  icon={<TrashIcon />}
                                  onClick={() => setDeleting(comment)}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {editError && !editingId && (
            <p className="mt-2 text-[11px] leading-relaxed text-danger" role="alert">
              {editError}
            </p>
          )}

          {canWrite ? (
            <div
              ref={composerRef}
              className="task-comments__composer"
              onKeyDown={composerShortcut}
            >
              <NanaInlineMarkdownEditor
                value={body}
                onChange={(value) => {
                  setBody(value);
                  if (composerError) setComposerError(null);
                }}
                placeholder="Write a comment…"
                minHeight={64}
                ariaLabel="New comment"
                showToolbar
                enableSlash
              />
              {composerError && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-danger" role="alert">
                  {composerError}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink-muted">
                  Plain text and Markdown. Raw HTML is stripped. ⌘/Ctrl + Enter posts.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="task-comments__post h-8"
                  onClick={() => void handlePost()}
                  loading={posting}
                  disabled={!body.trim()}
                >
                  Comment
                </Button>
              </div>
            </div>
          ) : (
            <p className="task-comments__readonly" role="note">
              {COMMENT_VIEW_ONLY_COPY}
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this comment?"
        description="The comment is removed from the task. This cannot be undone."
        confirmLabel="Delete comment"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleteBusy) setDeleting(null);
        }}
      />
    </TaskSection>
  );
}
