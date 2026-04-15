import { type FolderTreeNode } from '../../lib/folders';
import type {
  DropPosition,
  OnDragOver,
  OnDragLeave,
  OnDrop,
  OnDragStartDocument,
  OnDragEnd,
  OnDragStartFolder,
} from '../file-folder-handling';
import { type InlineInputState } from './useInlineInputState';
import { FolderTree } from './FolderTree';
import { InlineNameInput } from './InlineNameInput';

interface FoldersSectionProps {
  folders: FolderTreeNode[];
  isDataLoading: boolean;
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
  onContextMenu: (e: React.MouseEvent | React.TouchEvent, type: 'empty' | 'folder' | 'document' | 'trash-document' | 'trash-folder', data?: any) => void;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
  onDragStart: OnDragStartDocument;
  onDragEnd: OnDragEnd;
  onFolderDragStart: OnDragStartFolder;
  onFolderDragEnd: OnDragEnd;
  onDocumentClick: (doc: any) => void;
  onInlineFolderSubmit: (name: string, parentFolderId?: string) => Promise<void>;
  onInlineCancel: () => void;
  onRenameSubmit: (folderId: string, newName: string) => Promise<void>;
  onRenameCancel: () => void;
}

export function FoldersSection({
  folders,
  isDataLoading,
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
  onDocumentClick,
  onInlineFolderSubmit,
  onInlineCancel,
  onRenameSubmit,
  onRenameCancel,
}: FoldersSectionProps) {
  return (
    <div>
      <FolderTree
        nodes={folders}
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
        onDocumentClick={onDocumentClick}
        onInlineFolderSubmit={(name) => onInlineFolderSubmit(name, inlineInput?.parentFolderId)}
        onInlineCancel={onInlineCancel}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
      />
      {inlineInput?.type === 'folder' && !inlineInput.parentFolderId && (
        <InlineNameInput
          onSubmit={(name) => onInlineFolderSubmit(name, undefined)}
          onCancel={onInlineCancel}
          placeholder="Enter folder name..."
          icon="folder"
          depth={0}
        />
      )}
      {folders.length === 0 && !inlineInput && isDataLoading && (
        <div className="px-3 py-4 flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {folders.length === 0 && !inlineInput && !isDataLoading && (
        <div className="px-3 py-2 text-xs text-gray-600 italic">No folders yet</div>
      )}
    </div>
  );
}
