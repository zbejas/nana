import {
  EllipsisVerticalIcon,
  LockClosedIcon,
  ShareIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import type { Board } from '../../lib/boards';
import { useSharedWithPeople } from '../../state/hooks/useOwnedShares';
import { SharedWithUsersIcon } from '../sharing/SharedWithUsersIcon';
import type { OnDragStartBoard, OnDragEnd } from '../file-folder-handling';

const INDENT_PX = 16;

interface BoardItemProps {
  board: Board;
  draggable?: boolean;
  depth?: number;
  currentFolderId?: string;
  active?: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent | React.TouchEvent) => void;
  onDragStart?: OnDragStartBoard;
  onDragEnd?: OnDragEnd;
}

export function BoardItem({
  board,
  draggable = false,
  depth = 0,
  currentFolderId,
  active = false,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: BoardItemProps) {
  const handleMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onContextMenu(event);
  };

  const indent = depth * INDENT_PX + INDENT_PX;
  const sharedWithPeople = useSharedWithPeople('board', board.id);

  return (
    <div className="group relative">
      <button
        draggable={draggable}
        onDragStart={
          draggable && onDragStart
            ? (event) => onDragStart(event, board.id, currentFolderId)
            : undefined
        }
        onDragEnd={draggable && onDragEnd ? onDragEnd : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={`flex w-full items-center gap-1.5 overflow-hidden rounded-[6px] py-1 pr-7 text-left transition-colors active:cursor-grabbing ${
          active
            ? 'bg-signal-soft text-ink'
            : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
        }`}
        style={{ paddingLeft: `${indent}px` }}
      >
        <ViewColumnsIcon
          className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-signal' : 'text-ink-muted'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
          {board.name || 'Untitled board'}
        </span>
        {board.is_private && (
          <LockClosedIcon className="h-3 w-3 shrink-0 text-warning" aria-label="Private" />
        )}
        {board.is_public && (
          <ShareIcon className="h-3 w-3 shrink-0 text-success" aria-label="Shared publicly" />
        )}
        {sharedWithPeople && <SharedWithUsersIcon />}
      </button>
      <button
        onClick={handleMenuClick}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted opacity-100 transition-all hover:bg-surface-sunken hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        aria-label={`Actions for ${board.name || 'Untitled board'}`}
      >
        <EllipsisVerticalIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
