import { DocumentTextIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import type { Document } from "../../lib/documents";
import type { OnDragStartDocument, OnDragEnd } from '../file-folder-handling';

const INDENT_PX = 20;

interface DocumentItemProps {
  document: Document;
  draggable?: boolean;
  depth?: number;
  currentFolderId?: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent | React.TouchEvent) => void;
  onDragStart?: OnDragStartDocument;
  onDragEnd?: OnDragEnd;
}

export function DocumentItem({
  document,
  draggable = false,
  depth = 0,
  currentFolderId,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: DocumentItemProps) {
  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onContextMenu(e);
  };

  // Indent: chevron-width (20px) is reserved at every level for alignment with folders
  const indent = depth * INDENT_PX + INDENT_PX; // extra INDENT_PX to skip the chevron column

  return (
    <div className="relative group">
      <button
        draggable={draggable}
        onDragStart={draggable && onDragStart ? (e) => onDragStart(e, document.id, currentFolderId) : undefined}
        onDragEnd={draggable && onDragEnd ? onDragEnd : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className="w-full flex items-center gap-1.5 pr-8 py-[5px] rounded-md hover:bg-white/5 active:bg-white/8 transition-colors text-left overflow-hidden active:cursor-grabbing"
        style={{ paddingLeft: `${indent + 4}px` }}
      >
        <DocumentTextIcon className="w-4 h-4 flex-shrink-0 text-gray-500" />
        <span className="text-[13px] text-gray-400 truncate flex-1 group-hover:text-gray-200 leading-tight">{document.title || 'Untitled'}</span>
        {document.tags && document.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {document.tags.slice(0, 2).map((tag, index) => (
              <span
                key={index}
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
      </button>
      <button
        onClick={handleMenuClick}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        aria-label="Document menu"
      >
        <EllipsisVerticalIcon className="w-3.5 h-3.5 text-gray-500" />
      </button>
    </div>
  );
}
