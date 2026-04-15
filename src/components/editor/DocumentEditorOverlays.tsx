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
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm border border-white/10 z-30 flex items-center justify-center">
      <div className="rounded-xl border border-white/15 bg-black/70 px-4 py-3 text-center">
        <LockClosedIcon className="w-6 h-6 text-yellow-300 mx-auto mb-2" />
        <p className="text-sm font-medium text-white">Read-only trash document</p>
        <p className="text-xs text-gray-300 mt-1">Restore the document to edit it.</p>
      </div>
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
