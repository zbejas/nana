import { useEffect, useRef } from 'react';
import {
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';

interface ProfileContextMenuProps {
  isOpen: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSignOut: () => void;
  onSettings?: () => void;
  position?: 'below' | 'right';
}

export function ProfileContextMenu({
  isOpen,
  anchorRect,
  onClose,
  onSignOut,
  onSettings,
  position = 'below',
}: ProfileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRect) return null;

  const style: React.CSSProperties =
    position === 'right'
      ? { top: anchorRect.top, left: anchorRect.right + 8, position: 'fixed' }
      : { top: anchorRect.bottom + 4, left: anchorRect.left + 8, position: 'fixed', minWidth: anchorRect.width - 16 };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99]"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        className="z-[100] min-w-[180px] bg-black/60 backdrop-blur-xl border-2 border-white/15 rounded-lg shadow-lg animate-in zoom-in-95 fade-in duration-150 ease-out"
        style={style}
      >
        {onSettings && (
          <button
            onClick={() => {
              onSettings();
              onClose();
            }}
            className="w-full px-4 py-3 text-left text-gray-300 hover:bg-white/10 active:bg-white/20 hover:text-white transition-colors flex items-center gap-2"
          >
            <Cog6ToothIcon className="w-4 h-4 flex-shrink-0" />
            Settings
          </button>
        )}
        <button
          onClick={() => {
            onSignOut();
            onClose();
          }}
          className="w-full px-4 py-3 text-left text-red-300 hover:bg-red-500/20 active:bg-red-500/30 hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowRightOnRectangleIcon className="w-4 h-4 flex-shrink-0" />
          Sign Out
        </button>
      </div>
    </>
  );
}
