import { type FolderTreeNode } from '../../lib/folders';
import type { Board } from '../../lib/boards';
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
import { type InlineInputState } from './useInlineInputState';
import { FolderTree } from './FolderTree';
import { InlineNameInput } from './InlineNameInput';

interface FoldersSectionProps {
  folders: FolderTreeNode[];
  boards: Board[];
  isDataLoading: boolean;
  activeDocumentId?: string;
  activeBoardId?: string;
  expandedFolders: Set<string>;
  folderDocuments: Map<string, any[]>;
  loadedFolders: Set<string>;
  loadingFolders: Set<string>;
  dropZone: string | null;
  dropPosition: DropPosition | null;
  inlineInput: InlineInputState | null;
  renamingFolderId: string | null;
  onToggleFolder: (folderId: string) => void;
  onLoadFolder: (folderId: string) => Promise<void>;
  onContextMenu: (e: React.MouseEvent | React.TouchEvent, type: 'empty' | 'folder' | 'document' | 'trash-document' | 'trash-folder' | 'board', data?: any) => void;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
  onDragStart: OnDragStartDocument;
  onDragEnd: OnDragEnd;
  onFolderDragStart: OnDragStartFolder;
  onFolderDragEnd: OnDragEnd;
  onBoardDragStart: OnDragStartBoard;
  onBoardDragEnd: OnDragEnd;
  onDocumentClick: (doc: any) => void;
  onBoardClick: (board: Board) => void;
  onInlineFolderSubmit: (name: string, parentFolderId?: string) => Promise<void>;
  onInlineCancel: () => void;
  onRenameSubmit: (folderId: string, newName: string) => Promise<void>;
  onRenameCancel: () => void;
}

export function FoldersSection({
  folders,
  boards,
  isDataLoading,
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
}: FoldersSectionProps) {
  const hasFolders = folders.length > 0;
  const showEmpty = !hasFolders && !inlineInput && !isDataLoading;

  return (
    <div>
      <FolderTree
        nodes={folders}
        boards={boards}
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
        onInlineFolderSubmit={(name) => onInlineFolderSubmit(name, inlineInput?.parentFolderId)}
        onInlineCancel={onInlineCancel}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
      />
      {inlineInput?.type === 'folder' && !inlineInput.parentFolderId && (
        <InlineNameInput
          onSubmit={(name) => onInlineFolderSubmit(name, undefined)}
          onCancel={onInlineCancel}
          placeholder="Folder name"
          icon="folder"
          depth={0}
        />
      )}
      {showEmpty && (
        <p className="px-2 py-1 text-[12px] text-ink-muted">No folders yet</p>
      )}
    </div>
  );
}
