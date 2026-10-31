import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisVerticalIcon, ShareIcon, ArrowDownTrayIcon, BookmarkIcon, TrashIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { IconButton, MenuItem, MenuSeparator, MenuSurface } from '../ui';

interface EditorContextMenuProps {
  onShare: () => void;
  onExport: () => void;
  onPublish?: () => void;
  publishing?: boolean;
  onDelete: () => void;
  onHideHeader?: () => void;
  disabled?: boolean;
  isNewDocument?: boolean;
}

export function EditorContextMenu({
  onShare,
  onExport,
  onPublish,
  publishing = false,
  onDelete,
  onHideHeader,
  disabled,
  isNewDocument,
}: EditorContextMenuProps) {
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
        size="md"
        className="h-11 w-11 sm:h-8 sm:w-8"
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
        {onPublish && (
          <MenuItem
            icon={<BookmarkIcon />}
            label="Save this version"
            disabled={isNewDocument || publishing}
            onClick={() => handleItem(onPublish)}
          />
        )}
        {onHideHeader && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<ChevronUpIcon />}
              label="Hide header"
              onClick={() => {
                setOpen(false);
                onHideHeader();
              }}
            />
          </>
        )}
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
