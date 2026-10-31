import {
  DocumentTextIcon,
  EllipsisVerticalIcon,
  FolderIcon,
  LockClosedIcon,
  ShareIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import type React from 'react';
import type { BoardSummary } from '../../lib/boards';
import type { FolderTreeNode } from '../../lib/folders';
import type { Document } from '../../lib/documents';
import type { DropPosition } from '../file-folder-handling/types';
import type { PendingCreate, PendingRename } from './types';
import { Badge, Button, IconButton } from '../ui';
import { formatRelativeDate } from '../board/dates';

function plainExcerpt(content: string): string {
  return content
    .slice(0, 600)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function boardTaskLabel(board: BoardSummary): string {
  if (board.total === 0) {
    return 'No tasks';
  }

  return `${board.openCount} open · ${board.doneCount}/${board.total} done`;
}

type FolderViewListProps = {
  displayedFolders: FolderTreeNode[];
  displayedBoards: BoardSummary[];
  displayedDocuments: Document[];
  currentFolderId: string | null;
  selectedFolderIds: string[];
  selectedDocumentIds: string[];
  pendingCreate: PendingCreate | null;
  pendingRename: PendingRename | null;
  isCreating: boolean;
  isRenaming: boolean;
  dropZone: string | null;
  onPendingNameChange: (value: string) => void;
  onCreateSubmit: () => Promise<void>;
  onCreateCancel: () => void;
  onPendingRenameChange: (value: string) => void;
  onRenameSubmit: () => Promise<void>;
  onRenameCancel: () => void;
  onFolderClick: (event: React.MouseEvent, folderId: string) => void;
  onFolderDoubleClick: (folderId: string) => void;
  onBoardClick: (board: BoardSummary) => void;
  onDocumentClick: (event: React.MouseEvent, document: Document) => void;
  onDocumentDoubleClick: (document: Document) => void;
  onItemContextMenu: (
    event: React.MouseEvent,
    type: 'folder' | 'board' | 'document' | 'trash-folder' | 'trash-document' | 'trash-board' | 'empty',
    options?: {
      folderId?: string;
      folderName?: string;
      documentId?: string;
      boardId?: string;
      boardName?: string;
    }
  ) => void;
  onOpenItemMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    type: 'folder' | 'board' | 'document' | 'trash-folder' | 'trash-document' | 'trash-board',
    options?: {
      folderId?: string;
      folderName?: string;
      documentId?: string;
      boardId?: string;
      boardName?: string;
    }
  ) => void;
  onDragStart: (event: React.DragEvent, documentId: string, folderId?: string) => void;
  onDragEnd: () => void;
  onFolderDragStart: (event: React.DragEvent, folderId: string, parentFolderId?: string) => void;
  onFolderDragEnd: () => void;
  onBoardDragStart: (event: React.DragEvent, boardId: string, folderId?: string) => void;
  onBoardDragEnd: () => void;
  onDragOver: (event: React.DragEvent, targetFolderId?: string, dropPosition?: DropPosition) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent, targetFolderId?: string, targetParentId?: string) => void;
};

function InlineNameRow({
  value,
  placeholder,
  isBusy,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  value: string;
  placeholder: string;
  isBusy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="m-1 flex flex-col gap-2 rounded-[8px] border border-signal/25 bg-signal-soft/30 px-3 py-2.5 sm:flex-row sm:items-center">
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-sunken px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-signal/50"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onSubmit} loading={isBusy}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function FolderViewList({
  displayedFolders,
  displayedBoards,
  displayedDocuments,
  currentFolderId,
  selectedFolderIds,
  selectedDocumentIds,
  pendingCreate,
  pendingRename,
  isCreating,
  isRenaming,
  dropZone,
  onPendingNameChange,
  onCreateSubmit,
  onCreateCancel,
  onPendingRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onFolderClick,
  onFolderDoubleClick,
  onBoardClick,
  onDocumentClick,
  onDocumentDoubleClick,
  onItemContextMenu,
  onOpenItemMenu,
  onDragStart,
  onDragEnd,
  onFolderDragStart,
  onFolderDragEnd,
  onBoardDragStart,
  onBoardDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderViewListProps) {
  return (
    <div>
      <div className="hidden h-9 items-center justify-between border-b border-line px-3 text-[11.5px] font-medium text-ink-muted sm:flex sm:px-4">
        <span>Name</span>
        <span>Details</span>
      </div>
      {pendingCreate && (
        <InlineNameRow
          value={pendingCreate.name}
          placeholder={pendingCreate.type === 'folder' ? 'New folder name' : 'New note name'}
          isBusy={isCreating}
          onChange={onPendingNameChange}
          onSubmit={() => void onCreateSubmit()}
          onCancel={onCreateCancel}
          submitLabel={pendingCreate.type === 'folder' ? 'Create folder' : 'Create note'}
        />
      )}

      {displayedFolders.map((folder) => {
        const isSelected = selectedFolderIds.includes(folder.id);
        const isRenamingFolder = pendingRename?.type === 'folder' && pendingRename.id === folder.id;

        return (
          <div key={folder.id} className="group relative border-b border-line last:border-b-0" data-selection-item="true">
            {isRenamingFolder ? (
              <div className="bg-signal-soft/30">
                <InlineNameRow
                  value={pendingRename.name}
                  placeholder="Folder name"
                  isBusy={isRenaming}
                  onChange={onPendingRenameChange}
                  onSubmit={() => void onRenameSubmit()}
                  onCancel={onRenameCancel}
                  submitLabel="Save"
                />
              </div>
            ) : (
              <button
                draggable
                onClick={(event) => onFolderClick(event, folder.id)}
                onDoubleClick={() => onFolderDoubleClick(folder.id)}
                onContextMenu={(event) => onItemContextMenu(event, 'folder', { folderId: folder.id, folderName: folder.name })}
                onDragStart={(event) => onFolderDragStart(event, folder.id, folder.parent || undefined)}
                onDragEnd={onFolderDragEnd}
                onDragOver={(event) => onDragOver(event, folder.id, 'into')}
                onDragLeave={onDragLeave}
                onDrop={(event) => void onDrop(event, folder.id, folder.parent || undefined)}
                className={`flex w-full items-center gap-3 px-3 py-3.5 pr-12 text-left transition-colors sm:px-4 ${
                  dropZone === folder.id
                    ? 'bg-signal-soft ring-1 ring-inset ring-signal/40'
                    : isSelected
                      ? 'bg-signal-soft'
                      : 'hover:bg-surface-raised'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border ${
                    isSelected || dropZone === folder.id
                      ? 'border-signal/30 bg-signal-soft text-signal'
                      : 'border-line bg-surface-sunken text-ink-secondary'
                  }`}
                >
                  <FolderIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-ink">{folder.name}</span>
                    {folder.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {folder.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                    {folder.subfolders.length === 0
                      ? 'Folder'
                      : `${folder.subfolders.length} subfolder${folder.subfolders.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            )}

            {!isRenamingFolder && (
              <IconButton
                label={`Actions for ${folder.name}`}
                size="sm"
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={(event) => onOpenItemMenu(event, 'folder', { folderId: folder.id, folderName: folder.name })}
              >
                <EllipsisVerticalIcon />
              </IconButton>
            )}
          </div>
        );
      })}

      {displayedBoards.map((board) => {
        const updated = formatRelativeDate(board.updated);

        return (
          <div key={board.id} className="group relative border-b border-line last:border-b-0">
            <button
              draggable
              onClick={() => onBoardClick(board)}
              onContextMenu={(event) =>
                onItemContextMenu(event, 'board', { boardId: board.id, boardName: board.name })
              }
              onDragStart={(event) => onBoardDragStart(event, board.id, board.folder || undefined)}
              onDragEnd={onBoardDragEnd}
              className="flex w-full items-center gap-3 px-3 py-3.5 pr-12 text-left transition-colors hover:bg-surface-raised sm:px-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-secondary">
                <ViewColumnsIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium text-ink">{board.name}</span>
                  {board.is_private && (
                    <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private board" />
                  )}
                  {board.is_public && (
                    <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-muted">
                  <span>{updated ? `Updated ${updated}` : 'Board'}</span>
                  <span>·</span>
                  <span>{boardTaskLabel(board)}</span>
                </span>
              </span>
            </button>

            <IconButton
              label={`Actions for ${board.name}`}
              size="sm"
              className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              onClick={(event) =>
                onOpenItemMenu(event, 'board', { boardId: board.id, boardName: board.name })
              }
            >
              <EllipsisVerticalIcon />
            </IconButton>
          </div>
        );
      })}

      {displayedDocuments.map((document) => {
        const isSelected = selectedDocumentIds.includes(document.id);
        const isRenamingDocument = pendingRename?.type === 'document' && pendingRename.id === document.id;
        const tags = document.tags ?? [];

        return (
          <div key={document.id} className="group relative border-b border-line last:border-b-0" data-selection-item="true">
            {isRenamingDocument ? (
              <div className="bg-signal-soft/30">
                <InlineNameRow
                  value={pendingRename.name}
                  placeholder="Note name"
                  isBusy={isRenaming}
                  onChange={onPendingRenameChange}
                  onSubmit={() => void onRenameSubmit()}
                  onCancel={onRenameCancel}
                  submitLabel="Save"
                />
              </div>
            ) : (
              <button
                draggable
                onClick={(event) => onDocumentClick(event, document)}
                onDoubleClick={() => onDocumentDoubleClick(document)}
                onContextMenu={(event) =>
                  onItemContextMenu(event, 'document', {
                    documentId: document.id,
                    folderId: currentFolderId || undefined,
                  })
                }
                onDragStart={(event) => onDragStart(event, document.id, currentFolderId || undefined)}
                onDragEnd={onDragEnd}
                className={`flex w-full items-center gap-3 px-3 py-3.5 pr-12 text-left transition-colors sm:px-4 ${
                  isSelected ? 'bg-signal-soft' : 'hover:bg-surface-raised'
                }`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted">
                  <DocumentTextIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-ink">{document.title || 'Untitled'}</span>
                    {document.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {document.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-muted">
                    <span>Updated {new Date(document.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    {document.word_count > 0 && <span>· {document.word_count} words</span>}
                  </span>
                  {document.content && (
                    <span className="mt-1 block truncate text-[12px] leading-relaxed text-ink-muted">
                      {plainExcerpt(document.content)}
                    </span>
                  )}
                </span>
                {tags.length > 0 && (
                  <span className="hidden shrink-0 items-center gap-1 sm:flex">
                    {tags.slice(0, 2).map((tag) => (
                      <Badge key={`${document.id}-${tag}`} tone="outline" className="max-w-24 truncate">
                        {tag}
                      </Badge>
                    ))}
                    {tags.length > 2 && <span className="text-[11.5px] text-ink-muted">+{tags.length - 2}</span>}
                  </span>
                )}
              </button>
            )}

            {!isRenamingDocument && (
              <IconButton
                label={`Actions for ${document.title || 'Untitled'}`}
                size="sm"
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={(event) =>
                  onOpenItemMenu(event, 'document', {
                    documentId: document.id,
                    folderId: currentFolderId || undefined,
                  })
                }
              >
                <EllipsisVerticalIcon />
              </IconButton>
            )}
          </div>
        );
      })}
    </div>
  );
}
