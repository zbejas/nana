import { useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveBoxIcon } from '@heroicons/react/24/outline';
import {
  archiveBoard,
  createBoard,
  updateBoard,
  type Board,
} from '../../lib/boards';
import { getAllFolders, type Folder } from '../../lib/folders';
import { Button, ConfirmDialog, Dialog, Field, Input, Select, Switch, Textarea } from '../ui';

interface BoardDialogProps {
  open: boolean;
  board?: Board | null;
  /** Initial folder when creating a board. Editing uses the board's folder. */
  folderId?: string;
  /** Omit when the caller only has the board record and no task count. */
  taskCount?: number;
  onClose: () => void;
  onSaved: (board: Board) => void;
  onArchived?: (board: Board) => void;
}

function folderPath(folder: Folder, byId: Map<string, Folder>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: Folder | undefined = folder;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name || 'Untitled');
    current = current.parent ? byId.get(current.parent) : undefined;
  }

  return names.join(' / ');
}

export function BoardDialog({
  open,
  board = null,
  folderId,
  taskCount,
  onClose,
  onSaved,
  onArchived,
}: BoardDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
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
    setIsPrivate(board?.is_private ?? false);
    setSelectedFolderId(board?.folder ?? folderId ?? '');
    setNameError(null);
    setFormError(null);
    setIsSaving(false);
    setShowArchive(false);
    setIsArchiving(false);
    setArchiveError(null);

    let cancelled = false;
    void getAllFolders()
      .then((records) => {
        if (!cancelled) setFolders(records);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, board, folderId]);

  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => ({
        id: folder.id,
        name: folderPath(folder, byId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders]);

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
      let saved: Board;

      if (board) {
        const patch = {
          name: trimmedName,
          description,
          is_private: isPrivate,
          ...(selectedFolderId !== (board.folder ?? '') ? { folder: selectedFolderId } : {}),
        };
        saved = await updateBoard(board.id, patch);
      } else {
        saved = await createBoard({
          name: trimmedName,
          description,
          folder: selectedFolderId || undefined,
          is_private: isPrivate,
        });
      }

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

  const archiveDescription =
    taskCount === undefined
      ? 'The board and its tasks leave your timeline and library, and its public link stops working. Nothing is deleted — restore it any time from Archived boards.'
      : `The board and its ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} leave your timeline and library, and its public link stops working. Nothing is deleted — restore it any time from Archived boards.`;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={board ? 'Edit board' : 'New board'}
        description={
          board
            ? 'Rename the board, move it to a folder, or change what it is for. Archiving keeps every task until you restore it.'
            : folderId
              ? 'A board keeps a set of tasks together. It will be filed in this folder; notes stay in your library.'
              : 'A board keeps a set of tasks together. Choose a folder, or leave it at the workspace root.'
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

          <Field
            label="Folder"
            htmlFor="board-folder"
            hint="Boards sit beside notes in the folder tree. The workspace root is always available."
          >
            <Select
              id="board-folder"
              value={selectedFolderId}
              onChange={(event) => setSelectedFolderId(event.target.value)}
            >
              <option value="">Workspace root</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
              {selectedFolderId && !folderOptions.some((folder) => folder.id === selectedFolderId) && (
                <option value={selectedFolderId}>Current folder</option>
              )}
            </Select>
          </Field>

          <Switch
            id="board-private"
            label="Private"
            description="Hidden from AI chat and MCP. It stays in your workspace and can still be opened here."
            checked={isPrivate}
            onChange={setIsPrivate}
          />

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
          description={archiveDescription}
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
