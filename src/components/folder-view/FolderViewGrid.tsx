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

function boardTaskLabel(board: BoardSummary): string {
  if (board.total === 0) {
    return 'No tasks';
  }

  return `${board.openCount} open · ${board.doneCount}/${board.total} done`;
}

type FolderViewGridProps = {
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
    type: 'folder' | 'board' | 'document' | 'trash-folder' | 'trash-document' | 'empty',
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
    type: 'folder' | 'board' | 'document' | 'trash-folder' | 'trash-document',
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

function InlineNameCard({
  value,
  placeholder,
  isBusy,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  icon,
}: {
  value: string;
  placeholder: string;
  isBusy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[9rem] flex-col justify-center gap-2 rounded-panel border border-signal/35 bg-signal-soft/40 p-4">
      <div className="text-signal">{icon}</div>
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
        className="h-8 w-full rounded-control border border-line bg-surface-sunken px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-signal/50"
      />
      <div className="flex gap-2">
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

export function FolderViewGrid({
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
}: FolderViewGridProps) {
  return (
    <div className="folder-view-grid gap-3 p-3 sm:p-4">
      {pendingCreate && (
        <InlineNameCard
          value={pendingCreate.name}
          placeholder={pendingCreate.type === 'folder' ? 'New folder' : 'New note'}
          isBusy={isCreating}
          onChange={onPendingNameChange}
          onSubmit={() => void onCreateSubmit()}
          onCancel={onCreateCancel}
          submitLabel={pendingCreate.type === 'folder' ? 'Create' : 'Create'}
          icon={pendingCreate.type === 'folder' ? <FolderIcon className="h-6 w-6" /> : <DocumentTextIcon className="h-6 w-6" />}
        />
      )}

      {displayedFolders.map((folder) => {
        const isRenamingFolder = pendingRename?.type === 'folder' && pendingRename.id === folder.id;
        const isSelected = selectedFolderIds.includes(folder.id);

        return (
          <div key={folder.id} className="group relative" data-selection-item="true">
            {isRenamingFolder ? (
              <InlineNameCard
                value={pendingRename.name}
                placeholder="Folder name"
                isBusy={isRenaming}
                onChange={onPendingRenameChange}
                onSubmit={() => void onRenameSubmit()}
                onCancel={onRenameCancel}
                submitLabel="Save"
                icon={<FolderIcon className="h-6 w-6" />}
              />
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
                className={`flex min-h-[9rem] w-full flex-col justify-between rounded-panel border p-4 text-left transition-colors ${
                  dropZone === folder.id
                    ? 'border-signal/50 bg-signal-soft'
                    : isSelected
                      ? 'border-signal/35 bg-signal-soft/60'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised'
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-secondary">
                  <FolderIcon className="h-4 w-4" />
                </span>
                <span className="mt-4 block">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-ink">{folder.name}</span>
                    {folder.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {folder.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                    {folder.subfolders.length === 0 ? 'Folder' : `${folder.subfolders.length} subfolders`}
                  </span>
                </span>
              </button>
            )}

            {!isRenamingFolder && (
              <IconButton
                label={`Actions for ${folder.name}`}
                size="sm"
                className="absolute right-1.5 top-1.5 h-7 w-7 bg-surface opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
          <div key={board.id} className="group relative">
            <button
              draggable
              onClick={() => onBoardClick(board)}
              onContextMenu={(event) =>
                onItemContextMenu(event, 'board', { boardId: board.id, boardName: board.name })
              }
              onDragStart={(event) => onBoardDragStart(event, board.id, board.folder || undefined)}
              onDragEnd={onBoardDragEnd}
              className="flex min-h-[9rem] w-full flex-col justify-between rounded-panel border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-secondary">
                <ViewColumnsIcon className="h-4 w-4" />
              </span>
              <span className="mt-4 block">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium text-ink">{board.name}</span>
                  {board.is_private && (
                    <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private board" />
                  )}
                  {board.is_public && (
                    <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                  {updated ? `Updated ${updated}` : 'Board'}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                  {boardTaskLabel(board)}
                </span>
              </span>
            </button>

            <IconButton
              label={`Actions for ${board.name}`}
              size="sm"
              className="absolute right-1.5 top-1.5 h-7 w-7 bg-surface opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
        const isRenamingDocument = pendingRename?.type === 'document' && pendingRename.id === document.id;
        const isSelected = selectedDocumentIds.includes(document.id);
        const tags = document.tags ?? [];

        return (
          <div key={document.id} className="group relative" data-selection-item="true">
            {isRenamingDocument ? (
              <InlineNameCard
                value={pendingRename.name}
                placeholder="Note name"
                isBusy={isRenaming}
                onChange={onPendingRenameChange}
                onSubmit={() => void onRenameSubmit()}
                onCancel={onRenameCancel}
                submitLabel="Save"
                icon={<DocumentTextIcon className="h-6 w-6" />}
              />
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
                className={`flex min-h-[9rem] w-full flex-col justify-between rounded-panel border p-4 text-left transition-colors ${
                  isSelected
                    ? 'border-signal/35 bg-signal-soft/60'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised'
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted">
                  <DocumentTextIcon className="h-4 w-4" />
                </span>
                <span className="mt-4 block">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-ink">{document.title || 'Untitled'}</span>
                    {document.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {document.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                    {document.word_count > 0 ? `${document.word_count} words` : 'Empty note'}
                  </span>
                  {document.content && (
                    <span className="mt-1 line-clamp-2 block text-[12px] leading-relaxed text-ink-muted">
                      {document.content
                        .slice(0, 400)
                        .replace(/```[\s\S]*?```/g, ' ')
                        .replace(/[#>*_`~\-[\]()]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 100)}
                    </span>
                  )}
                  {tags.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {tags.slice(0, 1).map((tag) => (
                        <Badge key={`${document.id}-${tag}`} tone="outline" className="max-w-24 truncate">
                          {tag}
                        </Badge>
                      ))}
                      {tags.length > 1 && <span className="text-[11.5px] leading-5 text-ink-muted">+{tags.length - 1}</span>}
                    </span>
                  )}
                </span>
              </button>
            )}

            {!isRenamingDocument && (
              <IconButton
                label={`Actions for ${document.title || 'Untitled'}`}
                size="sm"
                className="absolute right-1.5 top-1.5 h-7 w-7 bg-surface opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
