import { useEffect, useRef, useState } from 'react';
import { ArchiveBoxIcon } from '@heroicons/react/24/outline';
import {
  archiveBoard,
  createBoard,
  updateBoard,
  type Board,
} from '../../lib/boards';
import { Button, ConfirmDialog, Dialog, Field, Input, Textarea } from '../ui';

interface BoardDialogProps {
  open: boolean;
  board?: Board | null;
  taskCount?: number;
  onClose: () => void;
  onSaved: (board: Board) => void;
  onArchived?: (board: Board) => void;
}

export function BoardDialog({
  open,
  board = null,
  taskCount = 0,
  onClose,
  onSaved,
  onArchived,
}: BoardDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setName(board?.name ?? '');
    setDescription(board?.description ?? '');
    setNameError(null);
    setFormError(null);
    setIsSaving(false);
    setShowArchive(false);
    setIsArchiving(false);
    setArchiveError(null);
  }, [open, board]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Give the board a name.');
      nameRef.current?.focus();
      return;
    }

    setNameError(null);
    setFormError(null);
    setIsSaving(true);

    try {
      const saved = board
        ? await updateBoard(board.id, { name: trimmedName, description })
        : await createBoard({ name: trimmedName, description });

      onSaved(saved);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the board.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!board) return;

    setArchiveError(null);
    setIsArchiving(true);

    try {
      const archived = await archiveBoard(board.id);
      setShowArchive(false);
      if (onArchived) {
        onArchived(archived);
      } else {
        onClose();
      }
    } catch (error) {
      setShowArchive(false);
      setArchiveError(error instanceof Error ? error.message : 'Could not archive the board.');
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={board ? 'Edit board' : 'New board'}
        description={
          board
            ? 'Rename the board or change what it is for. Archiving keeps every task until you restore it.'
            : 'A board keeps a set of tasks together. Notes stay in your library.'
        }
        size="md"
        initialFocusRef={nameRef}
        footer={
          <>
            {board && (
              <Button
                variant="ghost"
                className="mr-auto text-ink-secondary"
                icon={<ArchiveBoxIcon />}
                onClick={() => {
                  setArchiveError(null);
                  setShowArchive(true);
                }}
                disabled={isSaving || isArchiving}
              >
                Archive board
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={isSaving || isArchiving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSubmit()}
              loading={isSaving}
              disabled={isArchiving}
            >
              {board ? 'Save' : 'Create board'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="Name" htmlFor="board-name" error={nameError}>
            <Input
              id="board-name"
              ref={nameRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError && event.target.value.trim()) {
                  setNameError(null);
                }
              }}
              placeholder="What is this board for?"
              maxLength={120}
              invalid={Boolean(nameError)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="board-description"
            hint="A short note about the work this board holds."
            optional
          >
            <Textarea
              id="board-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="Ship the next release, research, personal admin…"
            />
          </Field>

          {formError && (
            <p className="text-sm text-danger" role="alert">
              {formError}
            </p>
          )}
          {archiveError && (
            <p className="text-sm text-danger" role="alert">
              {archiveError}
            </p>
          )}
        </div>
      </Dialog>

      {board && (
        <ConfirmDialog
          open={showArchive}
          title={`Archive “${board.name}”?`}
          description={`The board and its ${taskCount} tasks leave your boards index. Nothing is deleted — restore it any time from Archived boards.`}
          confirmLabel="Archive board"
          busy={isArchiving}
          onConfirm={() => void handleArchive()}
          onCancel={() => {
            if (!isArchiving) {
              setShowArchive(false);
            }
          }}
        />
      )}
    </>
  );
}
