import { DocumentPlusIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import { MenuItem, MenuSurface } from './ui';

interface NewContentMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onCreateNote: () => void;
  onCreateBoard: () => void;
}

/**
 * One "New" menu for the global sidebar button and the timeline header.
 * Notes and boards are the two things a workspace can start.
 */
export function NewContentMenu({
  open,
  anchorRect,
  onClose,
  onCreateNote,
  onCreateBoard,
}: NewContentMenuProps) {
  if (!open || !anchorRect) return null;

  const left =
    typeof window === 'undefined'
      ? anchorRect.left
      : Math.max(8, Math.min(anchorRect.left, window.innerWidth - 224));

  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      position={{
        top: anchorRect.bottom + 6,
        left,
      }}
      ariaLabel="New"
      className="min-w-[13rem]"
    >
      <MenuItem
        icon={<DocumentPlusIcon />}
        label="New note"
        onClick={() => {
          onClose();
          onCreateNote();
        }}
      />
      <MenuItem
        icon={<ViewColumnsIcon />}
        label="New board"
        onClick={() => {
          onClose();
          onCreateBoard();
        }}
      />
    </MenuSurface>
  );
}
