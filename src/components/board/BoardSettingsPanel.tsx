import { useEffect, useMemo, useRef, useState } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import {
  trashBoard,
  updateBoard,
  type Board,
  type BoardColumn,
} from '../../lib/boards';
import { getAllFolders, type Folder } from '../../lib/folders';
import {
  Button,
  ConfirmDialog,
  Field,
  InlineForm,
  Input,
  Select,
  Switch,
  Textarea,
} from '../ui';
import { BoardColumnsPanel } from './BoardColumnsPanel';

interface BoardSettingsPanelProps {
  board: Board;
  open: boolean;
  /** Focus and select the name when the panel opens. */
  autoFocus?: boolean;
  /** True only for a provisional board created by the global New action. */
  newBoard?: boolean;
  taskCount?: number;
  columns?: BoardColumn[];
  taskCounts?: Record<string, number>;
  onClose: () => void;
  onSaved: (board: Board) => void;
  onTrashed?: (board: Board) => void;
  onColumnsChanged?: () => void | Promise<void>;
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

/**
 * Board details live on the board itself. Creating a board opens this panel;
 * editing it from anywhere else navigates here instead of opening a modal.
 */
export function BoardSettingsPanel({
  board,
  open,
  autoFocus = false,
  newBoard = false,
  taskCount,
  columns = [],
  taskCounts = {},
  onClose,
  onSaved,
  onTrashed,
  onColumnsChanged,
}: BoardSettingsPanelProps) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [isPrivate, setIsPrivate] = useState(board.is_private);
  const [selectedFolderId, setSelectedFolderId] = useState(board.folder ?? '');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [isTrashing, setIsTrashing] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setName(board.name);
    setDescription(board.description);
    setIsPrivate(board.is_private);
    setSelectedFolderId(board.folder ?? '');
    setNameError(null);
    setFormError(null);
    setIsSaving(false);
    setShowTrash(false);
    setIsTrashing(false);
    setTrashError(null);

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
  }, [open, board]);

  useEffect(() => {
    if (!open || !autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.focus({ preventScroll: true });
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, autoFocus]);

  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => ({
        id: folder.id,
        name: folderPath(folder, byId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

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
      const saved = await updateBoard(board.id, {
        name: trimmedName,
        description,
        is_private: isPrivate,
        folder: selectedFolderId,
      });
      onSaved(saved);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the board.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTrash = async () => {
    setTrashError(null);
    setIsTrashing(true);

    try {
      const trashed = await trashBoard(board.id);
      setShowTrash(false);
      onTrashed?.(trashed);
    } catch (error) {
      setShowTrash(false);
      setTrashError(error instanceof Error ? error.message : 'Could not move the board to trash.');
    } finally {
      setIsTrashing(false);
    }
  };

  const trashDescription =
    taskCount === undefined
      ? 'The board and its tasks leave your timeline and library, and its public link stops working. You can restore it any time from Trash.'
      : `The board and its ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} leave your timeline and library, and its public link stops working. You can restore it any time from Trash.`;

  if (!open) return null;

  return (
    <>
      <InlineForm
        title={newBoard ? 'Name your board' : 'Board settings'}
        description={
          newBoard
            ? 'The board is already saved. Name it, file it, or close this panel and keep working.'
            : 'Rename, describe, file, or move this board to trash. Changes stay on this board.'
        }
        onSubmit={(event) => void handleSubmit(event)}
        onClose={onClose}
        className="mb-4"
        footer={
          <>
            <Button
              variant="ghost"
              className="mr-auto text-ink-secondary hover:bg-danger-soft hover:text-danger"
              icon={<TrashIcon />}
              onClick={() => {
                setTrashError(null);
                setShowTrash(true);
              }}
              disabled={isSaving || isTrashing}
            >
              Move to trash
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={isSaving || isTrashing}>
              {newBoard ? 'Close' : 'Cancel'}
            </Button>
            <Button type="submit" variant="primary" loading={isSaving} disabled={isTrashing}>
              Save board
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="board-settings-name" error={nameError}>
            <Input
              id="board-settings-name"
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
            />
          </Field>

          <Field
            label="Description"
            htmlFor="board-settings-description"
            hint="A short note about the work this board holds."
            optional
          >
            <Textarea
              id="board-settings-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="Ship the next release, research, personal admin…"
            />
          </Field>

          <Field
            label="Folder"
            htmlFor="board-settings-folder"
            hint="Boards sit beside notes in the folder tree. The workspace root is always available."
          >
            <Select
              id="board-settings-folder"
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
            id="board-settings-private"
            label="Private"
            description="Hidden from AI chat and MCP. It stays in your workspace and can still be opened here."
            checked={isPrivate}
            onChange={setIsPrivate}
          />

          <BoardColumnsPanel
            boardId={board.id}
            columns={columns}
            taskCounts={taskCounts}
            onChanged={() => onColumnsChanged?.()}
          />

          {(formError || trashError) && (
            <p className="text-[12.5px] text-danger" role="alert">
              {formError || trashError}
            </p>
          )}
        </div>
      </InlineForm>

      <ConfirmDialog
        open={showTrash}
        title={`Move “${board.name}” to trash?`}
        description={trashDescription}
        confirmLabel="Move to trash"
        busy={isTrashing}
        onConfirm={() => void handleTrash()}
        onCancel={() => {
          if (!isTrashing) {
            setShowTrash(false);
          }
        }}
      />
    </>
  );
}
