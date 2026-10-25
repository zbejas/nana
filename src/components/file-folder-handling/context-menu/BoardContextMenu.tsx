import type { RefObject } from 'react';
import { ArrowTopRightOnSquareIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { ContextMenuItem, ContextMenuShell } from './ContextMenuShell';

interface BoardContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    type: 'board';
    boardId?: string;
    boardName?: string;
  };
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onOpenBoard: () => void;
  onEditBoard: () => void;
  onClose: () => void;
  isClosing?: boolean;
}

export function BoardContextMenu({
  contextMenu,
  contextMenuRef,
  onOpenBoard,
  onEditBoard,
  onClose,
}: BoardContextMenuProps) {
  return (
    <ContextMenuShell
      open
      x={contextMenu.x}
      y={contextMenu.y}
      title={contextMenu.boardName || 'Board'}
      onClose={onClose}
    >
      <ContextMenuItem icon={<ArrowTopRightOnSquareIcon />} label="Open board" onClick={onOpenBoard} />
      <ContextMenuItem icon={<PencilSquareIcon />} label="Edit board…" onClick={onEditBoard} />
    </ContextMenuShell>
  );
}
