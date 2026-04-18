import { LockClosedIcon, PaperClipIcon } from '@heroicons/react/24/outline';

type EditorDragOverlayProps = {
  visible: boolean;
};

export function EditorDragOverlay({ visible }: EditorDragOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm border-2 border-dashed border-white/20 z-[9999] flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <PaperClipIcon className="w-16 h-16 text-white/60 mx-auto mb-4" />
        <p className="text-white/80 text-lg font-medium">Drop files to attach</p>
      </div>
    </div>
  );
}

type EditorReadOnlyOverlayProps = {
  visible: boolean;
};

export function EditorReadOnlyOverlay({ visible }: EditorReadOnlyOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 mx-2 mt-1 mb-1 rounded-lg border border-yellow-500/30 bg-yellow-900/20 text-yellow-300">
      <LockClosedIcon className="w-4 h-4 shrink-0" />
      <p className="text-xs font-medium">Read-only trash document — Restore to edit</p>
    </div>
  );
}

type ShowHeaderButtonProps = {
  visible: boolean;
  onClick: () => void;
};

export function ShowHeaderButton({ visible, onClick }: ShowHeaderButtonProps) {
  if (!visible) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      className="fixed top-2 right-2 p-2 rounded-lg border border-white/10 bg-white/10 dark:bg-white/10 light:bg-white/80 text-gray-200 dark:text-gray-200 light:text-gray-700 hover:bg-white/20 light:hover:bg-white transition-all z-20 backdrop-blur-sm animate-in fade-in duration-300"
      title="Show header"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}
