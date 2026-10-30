import { useEffect, useState } from 'react';
import { ArrowRightIcon, PlusIcon } from '@heroicons/react/24/outline';
import { getDocument } from '../../lib/documents';
import {
  createBoard,
  listBoardSummaries,
  type BoardSummary,
} from '../../lib/boards';
import {
  createTaskFromDocument,
  listTaskBoardIdsForDocument,
} from '../../lib/tasks';
import { useToasts } from '../../state/hooks';
import { Button, EmptyState, Field, Input, SidePanel, Spinner } from '../ui';
import { padCount } from './dates';

export interface AddToBoardRequest {
  documentId: string;
  title?: string;
}

interface AddToBoardPanelProps {
  request: AddToBoardRequest | null;
  onClose: () => void;
}

export function AddToBoardPanel({ request, onClose }: AddToBoardPanelProps) {
  const { showToast } = useToasts();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [usedBoardIds, setUsedBoardIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!request) {
      setBoards([]);
      setUsedBoardIds(new Set());
      setIsLoading(false);
      setError(null);
      setBusyBoardId(null);
      setCreateOpen(false);
      setNewBoardName('');
      setCreateError(null);
      setIsCreating(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setBusyBoardId(null);

    void Promise.all([
      listBoardSummaries(),
      listTaskBoardIdsForDocument(request.documentId),
    ])
      .then(([summaries, boardIds]) => {
        if (cancelled) return;
        setBoards(summaries.filter((board) => !board.archived));
        setUsedBoardIds(new Set(boardIds));
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load your boards.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  const handleChoose = async (board: BoardSummary) => {
    if (!request || usedBoardIds.has(board.id)) return;

    setBusyBoardId(board.id);
    setError(null);

    try {
      const document = await getDocument(request.documentId);
      await createTaskFromDocument(document, board.id);
      showToast(`“${document.title || 'Untitled'}” added to ${board.name}`, 'success');
      onClose();
    } catch (chooseError) {
      setError(
        chooseError instanceof Error
          ? chooseError.message
          : 'Could not add that note to the board.'
      );
    } finally {
      setBusyBoardId(null);
    }
  };

  const handleCreateBoard = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newBoardName.trim();
    if (!trimmed) {
      setCreateError('Give the board a name.');
      return;
    }

    setCreateError(null);
    setIsCreating(true);

    try {
      const board = await createBoard({ name: trimmed });
      setBoards((current) => [
        { ...board, openCount: 0, doneCount: 0, total: 0, lastActivity: board.updated },
        ...current,
      ]);
      setNewBoardName('');
      setCreateOpen(false);
      showToast('Board created', 'success');
    } catch (createBoardError) {
      setCreateError(
        createBoardError instanceof Error
          ? createBoardError.message
          : 'Could not create the board.'
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <SidePanel
      open={request !== null}
      onClose={onClose}
      title="Add to board"
      description="Choose where this task should live. The note stays in your library."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner label="Loading boards" />
          </div>
        ) : boards.length === 0 ? (
          <EmptyState
            compact
            title="No boards yet"
            description="Create a board, then this note can become its first task."
            action={
              <Button
                variant="primary"
                icon={<PlusIcon />}
                onClick={() => setCreateOpen(true)}
              >
                Create a board
              </Button>
            }
          />
        ) : (
          <div className="border-t border-line">
            {boards.map((board) => {
              const alreadyThere = usedBoardIds.has(board.id);
              const busy = busyBoardId === board.id;

              return (
                <button
                  key={board.id}
                  type="button"
                  disabled={alreadyThere || busyBoardId !== null}
                  onClick={() => void handleChoose(board)}
                  className="flex w-full items-center gap-4 border-b border-line px-2 py-3 text-left transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {board.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {board.description || 'No description'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-muted">
                    {padCount(board.openCount)} open · {padCount(board.total)} total
                  </span>
                  {busy ? (
                    <Spinner className="h-4 w-4 shrink-0" />
                  ) : alreadyThere ? (
                    <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
                      Already here
                    </span>
                  ) : (
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!isLoading && boards.length > 0 && !createOpen && (
          <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
            New board
          </Button>
        )}

        {createOpen && (
          <form
            onSubmit={(event) => void handleCreateBoard(event)}
            className="animate-slideDown rounded-control border border-line bg-surface-sunken p-3.5"
          >
            <Field label="Board name" htmlFor="add-to-board-name" error={createError}>
              <Input
                id="add-to-board-name"
                value={newBoardName}
                onChange={(event) => {
                  setNewBoardName(event.target.value);
                  if (createError && event.target.value.trim()) setCreateError(null);
                }}
                placeholder="What is this board for?"
                maxLength={120}
                autoFocus
                invalid={Boolean(createError)}
              />
            </Field>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreateOpen(false);
                  setNewBoardName('');
                  setCreateError(null);
                }}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={isCreating}>
                Create board
              </Button>
            </div>
          </form>
        )}
      </div>
    </SidePanel>
  );
}
