import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVerticalIcon, ShareIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';

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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const close = () => setOpen(false);
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, updatePosition]);

  if (disabled) return null;

  const itemBase = 'flex items-center gap-3 px-3 py-2 text-sm transition-colors w-full';
  const itemClass = `${itemBase} text-gray-300 hover:bg-white/10 light:text-gray-700 light:hover:bg-gray-100`;
  const deleteClass = `${itemBase} text-red-400 hover:bg-red-500/10 light:text-red-600 light:hover:bg-red-50`;
  const disabledClass = 'opacity-50 cursor-not-allowed';

  const handleItem = (handler: () => void) => {
    if (isNewDocument) return;
    setOpen(false);
    handler();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="true"
        className="p-1.5 sm:p-2 rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:bg-gray-200"
      >
        <EllipsisVerticalIcon className="w-5 h-5 sm:w-4 sm:h-4" />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="w-48 rounded-lg border border-white/10 bg-black/80 backdrop-blur-xl shadow-xl z-50 py-1 light:bg-white/90 light:border-gray-300"
        >
          <button
            role="menuitem"
            onClick={() => handleItem(onShare)}
            disabled={isNewDocument}
            className={`${itemClass} ${isNewDocument ? disabledClass : ''}`}
          >
            <ShareIcon className="w-4 h-4" />
            Share
          </button>
          <button
            role="menuitem"
            onClick={() => handleItem(onExport)}
            disabled={isNewDocument}
            className={`${itemClass} ${isNewDocument ? disabledClass : ''}`}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Export
          </button>
          <button
            role="menuitem"
            onClick={() => handleItem(onDelete)}
            disabled={isNewDocument}
            className={`${deleteClass} ${isNewDocument ? disabledClass : ''}`}
          >
            <TrashIcon className="w-4 h-4" />
            Delete
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
