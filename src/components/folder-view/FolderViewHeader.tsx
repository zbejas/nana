import {
  FolderIcon,
  HomeIcon,
  ArrowLeftIcon,
  InformationCircleIcon,
  Squares2X2Icon,
  ListBulletIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import type { FolderTreeNode } from '../../lib/folders';
import type { DropPosition } from '../file-folder-handling/types';
import type { ViewMode } from './types';

type FolderViewHeaderProps = {
  viewMode: ViewMode;
  currentFolderId: string | null;
  isTrashMode: boolean;
  breadcrumbPath: FolderTreeNode[];
  dropZone: string | null;
  isDesktop: boolean;
  hasSelection: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onNavigateUp: () => void;
  onBreadcrumbClick: (folderId: string | null) => void;
  onSelectAll: () => void;
  onDragOver: (event: React.DragEvent, targetFolderId?: string, dropPosition?: DropPosition) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent, targetFolderId?: string, targetParentId?: string) => void;
};

export function FolderViewHeader({
  viewMode,
  currentFolderId,
  isTrashMode,
  breadcrumbPath,
  dropZone,
  isDesktop,
  hasSelection,
  onViewModeChange,
  onNavigateUp,
  onBreadcrumbClick,
  onSelectAll,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderViewHeaderProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const infoButtonId = useId();
  const infoPopoverId = `${infoButtonId}-popover`;
  const infoContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isInfoOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!infoContainerRef.current?.contains(event.target as Node)) {
        setIsInfoOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsInfoOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isInfoOpen]);

  return (
    <header>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white">
            <FolderIcon className="w-5 h-5 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Folder View</h1>
          </div>
          <p className="text-xs text-gray-400 mt-1">Desktop explorer mode</p>
        </div>

        <div className="flex items-center gap-2">
          {hasSelection && (
            <button
              onClick={onSelectAll}
              data-selection-control="true"
              className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
              title="Select all"
            >
              Select all
            </button>
          )}
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-2 rounded-lg border transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-500/20 border-blue-500/30 text-blue-100'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
            title="List view"
          >
            <ListBulletIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('icon')}
            className={`p-2 rounded-lg border transition-colors ${
              viewMode === 'icon'
                ? 'bg-blue-500/20 border-blue-500/30 text-blue-100'
                : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
            }`}
            title="Icon view"
          >
            <Squares2X2Icon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={onNavigateUp}
          disabled={!currentFolderId}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-white/10 bg-white/5 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" /> Up
        </button>

        <button
          onClick={() => onBreadcrumbClick(null)}
          onDragOver={(event) => !isTrashMode && onDragOver(event, undefined, 'into')}
          onDragLeave={onDragLeave}
          onDrop={(event) => !isTrashMode && void onDrop(event, undefined)}
          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
            dropZone === 'root'
              ? 'border-blue-400 bg-blue-500/20 text-blue-100'
              : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
          }`}
        >
          <HomeIcon className="w-3.5 h-3.5" /> Root
        </button>

        {breadcrumbPath.map((folder) => (
          <button
            key={folder.id}
            onClick={() => onBreadcrumbClick(folder.id)}
            onDragOver={(event) => !isTrashMode && onDragOver(event, folder.id, 'into')}
            onDragLeave={onDragLeave}
            onDrop={(event) => !isTrashMode && void onDrop(event, folder.id, folder.parent || undefined)}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border whitespace-nowrap transition-colors ${
              dropZone === folder.id
                ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <FolderIcon className="w-3.5 h-3.5 shrink-0" />
            <span>{folder.name}</span>
          </button>
        ))}
        <div ref={infoContainerRef} className="relative ml-auto">
          <button
            type="button"
            data-selection-control="true"
            className="inline-flex items-center text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Show folder view drag help"
            aria-expanded={isInfoOpen}
            aria-controls={infoPopoverId}
            onClick={() => setIsInfoOpen((previous) => !previous)}
          >
            <InformationCircleIcon className="w-4 h-4" />
          </button>

          {isInfoOpen && (
            <div
              id={infoPopoverId}
              role="tooltip"
              className="absolute right-0 top-full z-20 mt-2 max-w-56 rounded-md border border-white/10 bg-black/90 px-3 py-2 text-xs text-gray-200 shadow-lg"
            >
              Drag items onto path badges to move them
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
