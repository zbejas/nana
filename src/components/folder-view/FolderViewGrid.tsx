import { DocumentTextIcon, EllipsisVerticalIcon, FolderIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import type { FolderTreeNode } from '../../lib/folders';
import type { Document } from '../../lib/documents';
import type { DropPosition } from '../file-folder-handling/types';
import type { PendingCreate, PendingRename } from './types';

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {pendingCreate && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
          {pendingCreate.type === 'folder' ? (
            <FolderIcon className="w-10 h-10 text-blue-300" />
          ) : (
            <DocumentTextIcon className="w-10 h-10 text-gray-400" />
          )}
          <input
            autoFocus
            value={pendingCreate.name}
            onChange={(event) => onPendingNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onCreateSubmit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCreateCancel();
              }
            }}
            placeholder={pendingCreate.type === 'folder' ? 'New folder name' : 'New file name'}
            className="w-full px-2.5 py-2 rounded-md border border-white/15 bg-black/20 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => void onCreateSubmit()}
              disabled={isCreating}
              className="text-xs px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {pendingCreate.type === 'folder' ? 'Create folder' : 'Create file'}
            </button>
            <button
              onClick={onCreateCancel}
              disabled={isCreating}
              className="text-xs px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {displayedFolders.map((folder) => {
        const isRenamingFolder = pendingRename?.type === 'folder' && pendingRename.id === folder.id;

        return (
          <div key={folder.id} className="relative group" data-selection-item="true">
            {isRenamingFolder ? (
              <div className="w-full rounded-lg border border-blue-300 bg-blue-500/10 p-3 text-left min-h-[120px] flex flex-col gap-2 justify-center">
                <FolderIcon className="w-10 h-10 text-blue-300" />
                <input
                  autoFocus
                  value={pendingRename.name}
                  onChange={(event) => onPendingRenameChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onRenameSubmit();
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  className="w-full px-2.5 py-2 rounded-md border border-white/15 bg-black/20 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => void onRenameSubmit()}
                    disabled={isRenaming}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Save
                  </button>
                  <button
                    onClick={onRenameCancel}
                    disabled={isRenaming}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </div>
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
                className={`w-full rounded-lg border transition-colors p-3 text-left min-h-[120px] flex flex-col justify-center ${
                  dropZone === folder.id
                    ? 'border-blue-400 bg-blue-500/20'
                    : selectedFolderIds.includes(folder.id)
                      ? 'border-blue-300 bg-blue-500/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <FolderIcon className="w-10 h-10 text-blue-300 mb-2" />
                <div className="text-sm text-gray-100 font-medium truncate flex items-center gap-1.5">
                  {folder.name}
                  {folder.is_public && (
                    <GlobeAltIcon className="w-4 h-4 flex-shrink-0 text-emerald-400/70" title="Public" />
                  )}
                </div>
              </button>
            )}

            <button
              onClick={(event) => onOpenItemMenu(event, 'folder', { folderId: folder.id, folderName: folder.name })}
              className={`absolute right-2 top-2 p-1 rounded hover:bg-white/10 opacity-100 transition-opacity ${
                isRenamingFolder ? 'hidden' : ''
              }`}
              aria-label="Folder menu"
            >
              <EllipsisVerticalIcon className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        );
      })}

      {displayedDocuments.map((document) => {
        const isRenamingDocument = pendingRename?.type === 'document' && pendingRename.id === document.id;

        return (
          <div key={document.id} className="relative group w-full" data-selection-item="true">
            {isRenamingDocument ? (
              <div className="relative w-full rounded-lg border border-blue-300 bg-blue-500/10 p-3 text-left min-h-[120px] flex flex-col gap-2 justify-center">
                <DocumentTextIcon className="w-10 h-10 text-gray-400" />
                <input
                  autoFocus
                  value={pendingRename.name}
                  onChange={(event) => onPendingRenameChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void onRenameSubmit();
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  className="w-full px-2.5 py-2 rounded-md border border-white/15 bg-black/20 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => void onRenameSubmit()}
                    disabled={isRenaming}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Save
                  </button>
                  <button
                    onClick={onRenameCancel}
                    disabled={isRenaming}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Cancel
                  </button>
                </div>
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
                className={`relative w-full rounded-lg border transition-colors p-3 text-left min-h-[120px] flex flex-col justify-center pb-7 ${
                  selectedDocumentIds.includes(document.id)
                    ? 'border-blue-300 bg-blue-500/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                {(document.tags.length > 0) && (
                  <div className="absolute bottom-2 right-2 flex items-center justify-end gap-1">
                    {document.tags.slice(0, 2).map((tag) => (
                      <span
                        key={`${document.id}-${tag}`}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 border border-white/10"
                      >
                        {tag}
                      </span>
                    ))}
                    {document.tags.length > 2 && (
                      <span className="text-[10px] text-gray-500">+{document.tags.length - 2}</span>
                    )}
                  </div>
                )}
                <DocumentTextIcon className="w-10 h-10 text-gray-400 mb-2" />
                <div className="text-sm text-gray-200 truncate flex items-center gap-1.5">
                  {document.title || 'Untitled'}
                  {document.is_public && (
                    <GlobeAltIcon className="w-4 h-4 flex-shrink-0 text-emerald-400/70" title="Public" />
                  )}
                </div>
              </button>
            )}

            <button
              onClick={(event) =>
                onOpenItemMenu(event, 'document', {
                  documentId: document.id,
                  folderId: currentFolderId || undefined,
                })
              }
              className={`absolute right-2 top-2 p-1 rounded hover:bg-white/10 opacity-100 transition-opacity ${
                isRenamingDocument ? 'hidden' : ''
              }`}
              aria-label="Document menu"
            >
              <EllipsisVerticalIcon className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
