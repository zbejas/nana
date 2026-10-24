import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisVerticalIcon, ShareIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { IconButton, MenuItem, MenuSeparator, MenuSurface } from '../ui';

interface EditorContextMenuProps {
  onShare: () => void;
  onExport: () => void;
  onDelete: () => void;
  disabled?: boolean;
  isNewDocument?: boolean;
}

export function EditorContextMenu({ onShare, onExport, onDelete, disabled, isNewDocument }: EditorContextMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  if (disabled) return null;

  const handleItem = (handler: () => void) => {
    if (isNewDocument) return;
    setOpen(false);
    handler();
  };

  return (
    <>
      <IconButton
        ref={buttonRef}
        label="More actions"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <EllipsisVerticalIcon />
      </IconButton>

      <MenuSurface
        open={open}
        onClose={() => setOpen(false)}
        position={{ ...pos, right: pos.right }}
        ariaLabel="Note actions"
        className="w-48"
      >
        <MenuItem
          icon={<ShareIcon />}
          label="Share…"
          disabled={isNewDocument}
          onClick={() => handleItem(onShare)}
        />
        <MenuItem
          icon={<ArrowDownTrayIcon />}
          label="Export note"
          disabled={isNewDocument}
          onClick={() => handleItem(onExport)}
        />
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon />}
          label="Move to trash"
          tone="danger"
          disabled={isNewDocument}
          onClick={() => handleItem(onDelete)}
        />
      </MenuSurface>
    </>
  );
}
