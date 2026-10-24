import type { RefObject } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  DocumentPlusIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  ShareIcon,
  TrashIcon,
  ViewColumnsIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShell } from './ContextMenuShell';

interface DocumentContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    type: 'document' | 'trash-document';
    documentId?: string;
  };
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onAddFolder: () => void;
  onAddDocument: () => void;
  onRenameDocument: () => void;
  onMakePublicDocument: () => void;
  onAddToBoard: () => void;
  onDeleteDocument: () => void;
  onRestoreDocument: () => void;
  onPermanentlyDeleteDocument: () => void;
  onExportDocument: () => void;
  onClose: () => void;
  mode?: 'default' | 'timeline';
  isClosing?: boolean;
}

export function DocumentContextMenu({
  contextMenu,
  onAddFolder,
  onAddDocument,
  onRenameDocument,
  onMakePublicDocument,
  onAddToBoard,
  onDeleteDocument,
  onRestoreDocument,
  onPermanentlyDeleteDocument,
  onExportDocument,
  onClose,
  mode = 'default',
}: DocumentContextMenuProps) {
  const isTrash = contextMenu.type === 'trash-document';
  const isTimelineMode = mode === 'timeline';

  return (
    <ContextMenuShell
      open
      x={contextMenu.x}
      y={contextMenu.y}
      title={isTrash ? 'Trash' : 'Note'}
      onClose={onClose}
    >
      {isTrash ? (
        <>
          <ContextMenuItem icon={<ArrowUturnLeftIcon />} label="Restore note" onClick={onRestoreDocument} />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<XCircleIcon />}
            label="Delete forever"
            hint="Cannot undo"
            onClick={onPermanentlyDeleteDocument}
            danger
          />
        </>
      ) : (
        <>
          {!isTimelineMode && (
            <>
              <ContextMenuItem icon={<FolderPlusIcon />} label="New folder here" onClick={onAddFolder} />
              <ContextMenuItem icon={<DocumentPlusIcon />} label="New note here" onClick={onAddDocument} />
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem icon={<PencilSquareIcon />} label="Rename" onClick={onRenameDocument} />
          <ContextMenuItem icon={<ShareIcon />} label="Share…" onClick={onMakePublicDocument} />
          <ContextMenuItem icon={<ViewColumnsIcon />} label="Add to board" onClick={onAddToBoard} />
          <ContextMenuItem icon={<ArrowDownTrayIcon />} label="Export note" onClick={onExportDocument} />
          <ContextMenuSeparator />
          <ContextMenuItem icon={<TrashIcon />} label="Move to trash" onClick={onDeleteDocument} danger />
        </>
      )}
    </ContextMenuShell>
  );
}
