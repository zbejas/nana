import { FolderIcon, ChevronRightIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { useState, useRef, useEffect } from 'react';
import type { FolderTreeNode } from "../../lib/folders";
import type { Document } from "../../lib/documents";
import type {
  DropPosition,
  OnDragOver,
  OnDragLeave,
  OnDrop,
  OnDragStartDocument,
  OnDragEnd,
  OnDragStartFolder,
} from '../file-folder-handling';
import { InlineNameInput } from "./InlineNameInput";
import { DocumentItem } from "./DocumentItem";

const INDENT_PX = 20;

// Rename input component for folders
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      onSubmit(name.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
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

  const indent = depth * INDENT_PX;

  return (
    <div 
      className="flex items-center gap-1.5 py-[5px] bg-white/8 rounded-md"
      style={{ paddingLeft: `${indent + 4}px`, paddingRight: '0.5rem' }}
    >
      <div className="w-4 flex-shrink-0" /> {/* chevron placeholder */}
      <FolderIcon className="w-4 h-4 text-yellow-500/80 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-gray-200 placeholder-gray-500"
      />
    </div>
  );
}

interface FolderTreeProps {
  nodes: FolderTreeNode[];
  depth?: number;
  parentFolderId?: string; // Track the parent of these nodes for sibling drops
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
  onContextMenu: (e: React.MouseEvent | React.TouchEvent, type: 'folder' | 'document', options?: { folderId?: string; folderName?: string; documentId?: string }) => void;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
  onDragStart: OnDragStartDocument;
  onDragEnd: OnDragEnd;
  onFolderDragStart?: OnDragStartFolder;
  onFolderDragEnd?: OnDragEnd;
  onDocumentClick: (doc: Document) => void;
  onInlineFolderSubmit: (name: string) => Promise<void>;
  onInlineCancel: () => void;
  onRenameSubmit: (folderId: string, newName: string) => Promise<void>;
  onRenameCancel: () => void;
}

export function FolderTree({
  nodes,
  depth = 0,
  parentFolderId,
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
}: FolderTreeProps) {
  const handleFolderClick = async (folderId: string, hasContent: boolean) => {
    if (!hasContent) return;

    // Toggle expansion
    onToggleFolder(folderId);

    // If expanding and not yet loaded, trigger lazy load
    const isExpanding = !expandedFolders.has(folderId);
    if (isExpanding && !loadedFolders.has(folderId) && !loadingFolders.has(folderId)) {
      await onLoadFolder(folderId);
    }
  };

  // Helper to determine drop position based on mouse position within element
  const getDropPosition = (e: React.DragEvent, element: HTMLElement): 'above' | 'below' | 'into' => {
    const rect = element.getBoundingClientRect();
    const mouseY = e.clientY;
    const elementTop = rect.top;
    const elementHeight = rect.height;

    const relativeY = mouseY - elementTop;
    const threshold = elementHeight * 0.25; // 25% from top/bottom edges

    if (relativeY < threshold) {
      return 'above';
    } else if (relativeY > elementHeight - threshold) {
      return 'below';
    } else {
      return 'into';
    }
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    const position = getDropPosition(e, e.currentTarget as HTMLElement);
    onDragOver(e, folderId, position);
  };

  const handleFolderDrop = (e: React.DragEvent, folderId: string, folderParentId?: string) => {
    onDrop(e, folderId, folderParentId);
  };

  return (
    <>
      {nodes.map(folder => {
        const isExpanded = expandedFolders.has(folder.id);
        const docs = folderDocuments.get(folder.id) || [];
        const isLoading = loadingFolders.has(folder.id);
        const hasContent = docs.length > 0 || folder.subfolders.length > 0 || (!loadedFolders.has(folder.id) && !isLoading);
        const indent = depth * INDENT_PX;
        
        return (
          <div key={folder.id}>
            {/* Folder Header */}
            {renamingFolderId === folder.id ? (
              <RenameInput
                initialName={folder.name}
                depth={depth}
                onSubmit={(newName) => onRenameSubmit(folder.id, newName)}
                onCancel={onRenameCancel}
              />
            ) : (
              <div className="relative group">
                {/* Drop indicator line - above */}
                {dropZone === folder.id && dropPosition === 'above' && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                )}

                <button
                  draggable={onFolderDragStart !== undefined}
                  onDragStart={onFolderDragStart ? (e) => onFolderDragStart(e, folder.id, folder.parent) : undefined}
                  onDragEnd={onFolderDragEnd}
                  onClick={() => handleFolderClick(folder.id, hasContent)}
                  onContextMenu={(e) => onContextMenu(e, 'folder', { folderId: folder.id, folderName: folder.name })}
                  onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => handleFolderDrop(e, folder.id, parentFolderId)}
                  className={`w-full flex items-center gap-1.5 pr-8 py-[5px] rounded-md hover:bg-white/5 transition-colors text-left overflow-hidden active:cursor-grabbing ${
                    dropZone === folder.id && dropPosition === 'into' ? 'bg-blue-500/15 ring-1 ring-blue-500/50' : ''
                  }`}
                  style={{ paddingLeft: `${indent + 4}px` }}
                >
                  {/* Chevron / spinner */}
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {isLoading ? (
                      <svg className="w-3.5 h-3.5 text-gray-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : hasContent ? (
                      <ChevronRightIcon 
                        className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} 
                      />
                    ) : null}
                  </span>
                  <FolderIcon className={`w-4 h-4 flex-shrink-0 ${isExpanded ? 'text-yellow-400' : 'text-yellow-500/70'}`} />
                  <span className="text-[13px] text-gray-300 truncate flex-1 leading-tight">{folder.name}</span>
                </button>

                {/* Drop indicator line - below */}
                {dropZone === folder.id && dropPosition === 'below' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 z-10" />
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onContextMenu(e, 'folder', { folderId: folder.id, folderName: folder.name });
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  aria-label="Folder menu"
                >
                  <EllipsisVerticalIcon className="w-3.5 h-3.5 text-gray-500" />
                </button>
              </div>
            )}
            
            {/* Documents and Subfolders */}
            {isExpanded && hasContent && (
              <div className="relative">
                {/* Indent guide line */}
                <div 
                  className="absolute top-0 bottom-0 w-px bg-white/[0.06]" 
                  style={{ left: `${indent + 13}px` }}
                />
                
                {/* Documents */}
                {docs.map(doc => (
                  <DocumentItem
                    key={doc.id}
                    document={doc}
                    draggable
                    depth={depth + 1}
                    currentFolderId={folder.id}
                    onClick={() => onDocumentClick(doc)}
                    onContextMenu={(e) => onContextMenu(e, 'document', { folderId: folder.id, documentId: doc.id })}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}
                
                {/* Subfolders */}
                {folder.subfolders.length > 0 && (
                  <FolderTree
                    nodes={folder.subfolders}
                    depth={depth + 1}
                    parentFolderId={folder.id}
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
                    onInlineFolderSubmit={onInlineFolderSubmit}
                    onInlineCancel={onInlineCancel}
                    onRenameSubmit={onRenameSubmit}
                    onRenameCancel={onRenameCancel}
                  />
                )}
                
                {/* Inline input for subfolder */}
                {inlineInput?.type === 'folder' && inlineInput.parentFolderId === folder.id && (
                  <InlineNameInput
                    onSubmit={onInlineFolderSubmit}
                    onCancel={onInlineCancel}
                    placeholder="Enter folder name..."
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
