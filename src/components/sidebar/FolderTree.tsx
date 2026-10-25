import { FolderIcon, ChevronRightIcon, EllipsisVerticalIcon, LockClosedIcon, ShareIcon } from '@heroicons/react/24/outline';
import { useState, useRef, useEffect } from 'react';
import type { FolderTreeNode } from "../../lib/folders";
import type { Board } from "../../lib/boards";
import type { Document } from "../../lib/documents";
import type {
  DropPosition,
  OnDragOver,
  OnDragLeave,
  OnDrop,
  OnDragStartDocument,
  OnDragStartBoard,
  OnDragEnd,
  OnDragStartFolder,
} from '../file-folder-handling';
import { InlineNameInput } from "./InlineNameInput";
import { BoardItem } from "./BoardItem";
import { DocumentItem } from "./DocumentItem";

const INDENT_PX = 16;

function RenameInput({ initialName, depth, onSubmit, onCancel }: {
  initialName: string;
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && name.trim()) {
      event.preventDefault();
      onSubmit(name.trim());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    if (name.trim() && name.trim() !== initialName) {
      onSubmit(name.trim());
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 rounded-[6px] bg-surface-raised py-1 pr-2"
      style={{ paddingLeft: `${depth * INDENT_PX + INDENT_PX + 22}px` }}
    >
      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        aria-label="Folder name"
        className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}

interface FolderTreeProps {
  nodes: FolderTreeNode[];
  boards: Board[];
  depth?: number;
  parentFolderId?: string;
  activeDocumentId?: string;
  activeBoardId?: string;
  expandedFolders: Set<string>;
  folderDocuments: Map<string, Document[]>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
  dropZone: string | null;
  dropPosition: DropPosition | null;
  inlineInput: {
    type: 'folder' | 'document';
    parentFolderId?: string;
    depth?: number;
  } | null;
  renamingFolderId: string | null;
  onToggleFolder: (folderId: string) => void;
  onLoadFolder: (folderId: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent | React.TouchEvent, type: 'folder' | 'document' | 'board', options?: { folderId?: string; folderName?: string; documentId?: string; boardId?: string; boardName?: string }) => void;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
  onDragStart: OnDragStartDocument;
  onDragEnd: OnDragEnd;
  onFolderDragStart?: OnDragStartFolder;
  onFolderDragEnd?: OnDragEnd;
  onBoardDragStart: OnDragStartBoard;
  onBoardDragEnd: OnDragEnd;
  onDocumentClick: (doc: Document) => void;
  onBoardClick: (board: Board) => void;
  onInlineFolderSubmit: (name: string) => Promise<void>;
  onInlineCancel: () => void;
  onRenameSubmit: (folderId: string, newName: string) => Promise<void>;
  onRenameCancel: () => void;
}

export function FolderTree({
  nodes,
  boards,
  depth = 0,
  parentFolderId,
  activeDocumentId,
  activeBoardId,
  expandedFolders,
  folderDocuments,
  loadedFolders,
  loadingFolders,
  dropZone,
  dropPosition,
  inlineInput,
  renamingFolderId,
  onToggleFolder,
  onLoadFolder,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onFolderDragStart,
  onFolderDragEnd,
  onBoardDragStart,
  onBoardDragEnd,
  onDocumentClick,
  onBoardClick,
  onInlineFolderSubmit,
  onInlineCancel,
  onRenameSubmit,
  onRenameCancel,
}: FolderTreeProps) {
  const handleFolderClick = async (folderId: string, hasContent: boolean) => {
    if (!hasContent) return;

    onToggleFolder(folderId);

    const isExpanding = !expandedFolders.has(folderId);
    if (isExpanding && !loadedFolders.has(folderId) && !loadingFolders.has(folderId)) {
      await onLoadFolder(folderId);
    }
  };

  const getDropPosition = (event: React.DragEvent, element: HTMLElement): 'above' | 'below' | 'into' => {
    const rect = element.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const threshold = rect.height * 0.25;

    if (relativeY < threshold) return 'above';
    if (relativeY > rect.height - threshold) return 'below';
    return 'into';
  };

  return (
    <>
      {nodes.map((folder) => {
        const isExpanded = expandedFolders.has(folder.id);
        const docs = folderDocuments.get(folder.id) || [];
        const folderBoards = boards.filter((board) => board.folder === folder.id);
        const isLoading = loadingFolders.has(folder.id);
        const hasContent = docs.length > 0 || folderBoards.length > 0 || folder.subfolders.length > 0 || (!loadedFolders.has(folder.id) && !isLoading);
        const indent = depth * INDENT_PX;
        const isDropTarget = dropZone === folder.id;

        return (
          <div key={folder.id}>
            {renamingFolderId === folder.id ? (
              <RenameInput
                initialName={folder.name}
                depth={depth}
                onSubmit={(newName) => onRenameSubmit(folder.id, newName)}
                onCancel={onRenameCancel}
              />
            ) : (
              <div className="group relative">
                {isDropTarget && dropPosition === 'above' && (
                  <div className="absolute left-2 right-2 top-0 z-10 h-0.5 rounded-full bg-signal" />
                )}

                <button
                  draggable={onFolderDragStart !== undefined}
                  onDragStart={onFolderDragStart ? (event) => onFolderDragStart(event, folder.id, folder.parent) : undefined}
                  onDragEnd={onFolderDragEnd}
                  onClick={() => handleFolderClick(folder.id, hasContent)}
                  onContextMenu={(event) => onContextMenu(event, 'folder', { folderId: folder.id, folderName: folder.name })}
                  onDragOver={(event) => onDragOver(event, folder.id, getDropPosition(event, event.currentTarget))}
                  onDragLeave={onDragLeave}
                  onDrop={(event) => onDrop(event, folder.id, parentFolderId)}
                  className={`flex w-full items-center gap-1 overflow-hidden rounded-[6px] py-1 pr-7 text-left transition-colors active:cursor-grabbing ${
                    isDropTarget && dropPosition === 'into'
                      ? 'bg-signal-soft ring-1 ring-inset ring-signal/40'
                      : 'hover:bg-surface-raised'
                  }`}
                  style={{ paddingLeft: `${indent}px` }}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-muted">
                    {isLoading ? (
                      <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : hasContent ? (
                      <ChevronRightIcon className={`h-3 w-3 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                    ) : null}
                  </span>
                  <FolderIcon className={`h-3.5 w-3.5 shrink-0 ${isExpanded ? 'text-signal' : 'text-ink-muted'}`} />
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-secondary group-hover:text-ink">
                    {folder.name}
                  </span>
                  {folder.is_private && <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />}
                  {folder.is_public && <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />}
                </button>

                {isDropTarget && dropPosition === 'below' && (
                  <div className="absolute bottom-0 left-2 right-2 z-10 h-0.5 rounded-full bg-signal" />
                )}

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onContextMenu(event, 'folder', { folderId: folder.id, folderName: folder.name });
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted opacity-100 transition-all hover:bg-surface-sunken hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Actions for ${folder.name}`}
                >
                  <EllipsisVerticalIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {isExpanded && hasContent && (
              <div className="relative">
                <div
                  className="absolute bottom-0 top-0 w-px bg-line"
                  style={{ left: `${indent + 9}px` }}
                  aria-hidden="true"
                />
                {docs.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    document={doc}
                    draggable
                    depth={depth + 1}
                    currentFolderId={folder.id}
                    active={doc.id === activeDocumentId}
                    onClick={() => onDocumentClick(doc)}
                    onContextMenu={(event) => onContextMenu(event, 'document', { folderId: folder.id, documentId: doc.id })}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}

                {folderBoards.map((board) => (
                  <BoardItem
                    key={board.id}
                    board={board}
                    draggable
                    depth={depth + 1}
                    currentFolderId={folder.id}
                    active={board.id === activeBoardId}
                    onClick={() => onBoardClick(board)}
                    onContextMenu={(event) =>
                      onContextMenu(event, 'board', {
                        folderId: folder.id,
                        boardId: board.id,
                        boardName: board.name,
                      })
                    }
                    onDragStart={onBoardDragStart}
                    onDragEnd={onBoardDragEnd}
                  />
                ))}

                {folder.subfolders.length > 0 && (
                  <FolderTree
                    nodes={folder.subfolders}
                    boards={boards}
                    depth={depth + 1}
                    parentFolderId={folder.id}
                    activeDocumentId={activeDocumentId}
                    activeBoardId={activeBoardId}
                    expandedFolders={expandedFolders}
                    folderDocuments={folderDocuments}
                    loadedFolders={loadedFolders}
                    loadingFolders={loadingFolders}
                    dropZone={dropZone}
                    dropPosition={dropPosition}
                    inlineInput={inlineInput}
                    renamingFolderId={renamingFolderId}
                    onToggleFolder={onToggleFolder}
                    onLoadFolder={onLoadFolder}
                    onContextMenu={onContextMenu}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onFolderDragStart={onFolderDragStart}
                    onFolderDragEnd={onFolderDragEnd}
                    onBoardDragStart={onBoardDragStart}
                    onBoardDragEnd={onBoardDragEnd}
                    onDocumentClick={onDocumentClick}
                    onBoardClick={onBoardClick}
                    onInlineFolderSubmit={onInlineFolderSubmit}
                    onInlineCancel={onInlineCancel}
                    onRenameSubmit={onRenameSubmit}
                    onRenameCancel={onRenameCancel}
                  />
                )}

                {inlineInput?.type === 'folder' && inlineInput.parentFolderId === folder.id && (
                  <InlineNameInput
                    onSubmit={onInlineFolderSubmit}
                    onCancel={onInlineCancel}
                    placeholder="Folder name"
                    icon="folder"
                    depth={depth + 1}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
