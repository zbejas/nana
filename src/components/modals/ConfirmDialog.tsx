import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onSave,
  onDiscard,
  onCancel,
  saveLabel = "Save",
  discardLabel = "Discard",
  cancelLabel = "Cancel",
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    cancelButtonRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="relative bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-2xl max-w-md w-full p-6"
      >
        <h3 id={titleId} className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p id={messageId} className="text-gray-400 mb-6">{message}</p>

        <div className="flex gap-3 justify-end">
          {cancelLabel && (
            <button
              ref={cancelButtonRef}
              onClick={onCancel}
              className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium border border-white/10"
            >
              {cancelLabel}
            </button>
          )}
          {discardLabel && (
            <button
              onClick={onDiscard}
              className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm font-medium border border-red-500/30"
            >
              {discardLabel}
            </button>
          )}
          {saveLabel && (
            <button
              onClick={onSave}
              className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm font-medium border border-green-500/30"
            >
              {saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
