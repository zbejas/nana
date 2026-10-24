import type { RefObject } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  DocumentPlusIcon,
  FolderPlusIcon,
  PencilSquareIcon,
  ShareIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShell } from './ContextMenuShell';

interface FolderContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    type: 'folder' | 'trash-folder' | 'empty';
    folderId?: string;
    folderName?: string;
  };
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onAddFolder: () => void;
  onAddDocument: () => void;
  onRenameFolder: () => void;
  onMakePublicFolder: () => void;
  onDeleteFolder: () => void;
  onRestoreFolder: () => void;
  onPermanentlyDeleteFolder: () => void;
  onExportFolder: () => void;
  onClose: () => void;
  isClosing?: boolean;
}

export function FolderContextMenu({
  contextMenu,
  onAddFolder,
  onAddDocument,
  onRenameFolder,
  onMakePublicFolder,
  onDeleteFolder,
  onRestoreFolder,
  onPermanentlyDeleteFolder,
  onExportFolder,
  onClose,
}: FolderContextMenuProps) {
  const isTrash = contextMenu.type === 'trash-folder';
  const isEmpty = contextMenu.type === 'empty';

  return (
    <ContextMenuShell
      open
      x={contextMenu.x}
      y={contextMenu.y}
      title={isTrash ? 'Trash folder' : isEmpty ? 'Workspace' : 'Folder'}
      onClose={onClose}
    >
      {isTrash ? (
        <>
          <ContextMenuItem icon={<ArrowUturnLeftIcon />} label="Restore folder" onClick={onRestoreFolder} />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<XCircleIcon />}
            label="Delete forever"
            hint="Cannot undo"
            onClick={onPermanentlyDeleteFolder}
            danger
          />
        </>
      ) : (
        <>
          <ContextMenuItem icon={<FolderPlusIcon />} label={isEmpty ? 'New folder' : 'New subfolder'} onClick={onAddFolder} />
          <ContextMenuItem icon={<DocumentPlusIcon />} label="New note" onClick={onAddDocument} />
          {!isEmpty && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<PencilSquareIcon />} label="Rename" onClick={onRenameFolder} />
              <ContextMenuItem icon={<ShareIcon />} label="Share…" onClick={onMakePublicFolder} />
              <ContextMenuItem icon={<ArrowDownTrayIcon />} label="Export folder (.zip)" onClick={onExportFolder} />
              <ContextMenuSeparator />
              <ContextMenuItem icon={<TrashIcon />} label="Move to trash" onClick={onDeleteFolder} danger />
            </>
          )}
        </>
      )}
    </ContextMenuShell>
  );
}
