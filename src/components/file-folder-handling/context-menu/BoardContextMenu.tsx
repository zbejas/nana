import type { RefObject } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  ShareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShell } from './ContextMenuShell';

interface BoardContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    type: 'board' | 'trash-board';
    boardId?: string;
    boardName?: string;
  };
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onOpenBoard: () => void;
  onEditBoard: () => void;
  onShareBoard: () => void;
  onExportBoard: () => void;
  onTrashBoard: () => void;
  onRestoreBoard?: () => void;
  onPermanentlyDeleteBoard?: () => void;
  onClose: () => void;
  isClosing?: boolean;
}

export function BoardContextMenu({
  contextMenu,
  contextMenuRef,
  onOpenBoard,
  onEditBoard,
  onShareBoard,
  onExportBoard,
  onTrashBoard,
  onRestoreBoard,
  onPermanentlyDeleteBoard,
  onClose,
  isClosing,
}: BoardContextMenuProps) {
  const trash = contextMenu.type === 'trash-board';

  return (
    <ContextMenuShell
      open
      x={contextMenu.x}
      y={contextMenu.y}
      title={contextMenu.boardName || 'Board'}
      onClose={onClose}
    >
      {trash ? (
        <>
          <ContextMenuItem
            icon={<ArrowUturnLeftIcon />}
            label="Restore board"
            onClick={onRestoreBoard ?? onClose}
          />
          <ContextMenuItem
            icon={<ArrowDownTrayIcon />}
            label="Export board"
            onClick={onExportBoard}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<TrashIcon />}
            label="Delete forever"
            danger
            onClick={onPermanentlyDeleteBoard ?? onClose}
          />
        </>
      ) : (
        <>
          <ContextMenuItem icon={<ArrowTopRightOnSquareIcon />} label="Open board" onClick={onOpenBoard} />
          <ContextMenuItem icon={<PencilSquareIcon />} label="Edit board…" onClick={onEditBoard} />
          <ContextMenuItem icon={<ShareIcon />} label="Share…" onClick={onShareBoard} />
          <ContextMenuItem icon={<ArrowDownTrayIcon />} label="Export board" onClick={onExportBoard} />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<TrashIcon />}
            label="Move to trash"
            danger
            onClick={onTrashBoard}
          />
        </>
      )}
    </ContextMenuShell>
  );
}
