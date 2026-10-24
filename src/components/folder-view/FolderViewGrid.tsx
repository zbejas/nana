import { DocumentTextIcon, EllipsisVerticalIcon, FolderIcon, LockClosedIcon, ShareIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import type { FolderTreeNode } from '../../lib/folders';
import type { Document } from '../../lib/documents';
import type { DropPosition } from '../file-folder-handling/types';
import type { PendingCreate, PendingRename } from './types';
import { Badge, Button, IconButton } from '../ui';

type FolderViewGridProps = {
  displayedFolders: FolderTreeNode[];
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
  onDocumentClick: (event: React.MouseEvent, document: Document) => void;
  onDocumentDoubleClick: (document: Document) => void;
  onItemContextMenu: (
    event: React.MouseEvent,
    type: 'folder' | 'document' | 'trash-folder' | 'trash-document' | 'empty',
    options?: { folderId?: string; folderName?: string; documentId?: string }
  ) => void;
  onOpenItemMenu: (
    event: React.MouseEvent<HTMLButtonElement>,
    type: 'folder' | 'document' | 'trash-folder' | 'trash-document',
    options?: { folderId?: string; folderName?: string; documentId?: string }
  ) => void;
  onDragStart: (event: React.DragEvent, documentId: string, folderId?: string) => void;
  onDragEnd: () => void;
  onFolderDragStart: (event: React.DragEvent, folderId: string, parentFolderId?: string) => void;
  onFolderDragEnd: () => void;
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
    <div className="flex min-h-[7.5rem] flex-col justify-center gap-2 rounded-panel border border-signal/35 bg-signal-soft/40 p-3">
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
  onDocumentClick,
  onDocumentDoubleClick,
  onItemContextMenu,
  onOpenItemMenu,
  onDragStart,
  onDragEnd,
  onFolderDragStart,
  onFolderDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderViewGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-4 xl:grid-cols-5">
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
                className={`flex min-h-[7.5rem] w-full flex-col justify-between rounded-panel border p-3 text-left transition-colors ${
                  dropZone === folder.id
                    ? 'border-signal/50 bg-signal-soft'
                    : isSelected
                      ? 'border-signal/35 bg-signal-soft/60'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised'
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-warning">
                  <FolderIcon className="h-4 w-4" />
                </span>
                <span className="mt-3 block">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{folder.name}</span>
                    {folder.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {folder.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-muted">
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
                className={`flex min-h-[7.5rem] w-full flex-col justify-between rounded-panel border p-3 text-left transition-colors ${
                  isSelected
                    ? 'border-signal/35 bg-signal-soft/60'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised'
                }`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-sunken text-ink-muted">
                  <DocumentTextIcon className="h-4 w-4" />
                </span>
                <span className="mt-3 block">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{document.title || 'Untitled'}</span>
                    {document.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                    {document.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                    {document.word_count > 0 ? `${document.word_count} words` : 'Empty note'}
                  </span>
                  {tags.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {tags.slice(0, 1).map((tag) => (
                        <Badge key={`${document.id}-${tag}`} tone="outline" className="max-w-24 truncate">
                          {tag}
                        </Badge>
                      ))}
                      {tags.length > 1 && <span className="text-[10px] leading-5 text-ink-muted">+{tags.length - 1}</span>}
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
