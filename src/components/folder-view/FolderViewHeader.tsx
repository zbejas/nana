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
import { Button, SegmentedControl } from '../ui';

type FolderViewHeaderProps = {
  viewMode: ViewMode;
  currentFolderId: string | null;
  isTrashMode: boolean;
  isSharedMode: boolean;
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
  isSharedMode,
  breadcrumbPath,
  dropZone,
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
  const canDrop = !isTrashMode && !isSharedMode;

  useEffect(() => {
    if (!isInfoOpen) return;

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

  const crumbClass = (active: boolean) =>
    `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-[12px] transition-colors ${
      active
        ? 'border-ember/35 bg-ember-soft text-ember'
        : 'border-transparent text-ink-secondary hover:bg-surface-raised hover:text-ink'
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeftIcon />} onClick={onNavigateUp} disabled={!currentFolderId}>
          Up
        </Button>

        <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            onClick={() => onBreadcrumbClick(null)}
            onDragOver={(event) => canDrop && onDragOver(event, undefined, 'into')}
            onDragLeave={onDragLeave}
            onDrop={(event) => canDrop && void onDrop(event, undefined)}
            className={crumbClass(!currentFolderId)}
          >
            <HomeIcon className="h-3.5 w-3.5" />
            Root
          </button>

          {breadcrumbPath.map((folder, index) => (
            <span key={folder.id} className="flex min-w-0 items-center gap-1">
              <span className="text-ink-muted/60" aria-hidden="true">/</span>
              <button
                onClick={() => onBreadcrumbClick(folder.id)}
                onDragOver={(event) => canDrop && onDragOver(event, folder.id, 'into')}
                onDragLeave={onDragLeave}
                onDrop={(event) => canDrop && void onDrop(event, folder.id, folder.parent || undefined)}
                className={`${crumbClass(dropZone === folder.id || index === breadcrumbPath.length - 1)} min-w-0`}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-40 truncate">{folder.name}</span>
              </button>
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {hasSelection && (
            <Button variant="secondary" size="sm" onClick={onSelectAll} data-selection-control="true">
              Select all
            </Button>
          )}

          <SegmentedControl
            label="View mode"
            value={viewMode}
            onChange={onViewModeChange}
            size="sm"
            options={[
              { value: 'list', label: 'List', icon: <ListBulletIcon className="h-3.5 w-3.5" /> },
              { value: 'icon', label: 'Grid', icon: <Squares2X2Icon className="h-3.5 w-3.5" /> },
            ]}
          />

          <div ref={infoContainerRef} className="relative">
            <button
              type="button"
              data-selection-control="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
              aria-label="Show folder view drag help"
              aria-expanded={isInfoOpen}
              aria-controls={infoPopoverId}
              onClick={() => setIsInfoOpen((previous) => !previous)}
            >
              <InformationCircleIcon className="h-4 w-4" />
            </button>

            {isInfoOpen && (
              <div
                id={infoPopoverId}
                role="tooltip"
                className="absolute right-0 top-full z-20 mt-2 w-56 rounded-control border border-line bg-surface-raised px-3 py-2 text-xs leading-relaxed text-ink-secondary shadow-float"
              >
                Drag items onto a folder card or a path badge to move them. Double-click a folder to open it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
