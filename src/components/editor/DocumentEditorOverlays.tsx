import { ArrowDownIcon, LockClosedIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { IconButton } from '../ui';

export function EditorDragOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[9999] flex items-center justify-center border-2 border-dashed border-signal/50 bg-canvas/85">
      <div className="text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-signal/30 bg-signal-soft text-signal">
          <PaperClipIcon className="h-5 w-5" />
        </span>
        <p className="text-base font-medium text-ink">Drop files to attach</p>
        <p className="mt-1 text-xs text-ink-muted">They are added to this note when you drop them.</p>
      </div>
    </div>
  );
}

export function EditorReadOnlyOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="mx-3 mb-2 mt-2 flex items-center gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 sm:mx-4">
      <LockClosedIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-xs font-medium text-warning">Read-only trash note. Restore it to edit.</p>
    </div>
  );
}

export function ShowHeaderButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;

  return (
    <div className="fixed right-3 top-3 z-20">
      <IconButton
        label="Show header"
        onClick={onClick}
        className="border border-line bg-surface-raised shadow-float"
      >
        <ArrowDownIcon />
      </IconButton>
    </div>
  );
}
