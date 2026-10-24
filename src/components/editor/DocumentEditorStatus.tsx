import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export function DocumentLoadingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas">
      <span className="h-9 w-9 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
      <p className="text-sm text-ink-muted">Opening the note…</p>
    </div>
  );
}

export function DocumentNotFoundState() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-canvas p-8 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-warning/25 bg-warning-soft text-warning">
        <ExclamationTriangleIcon className="h-6 w-6" />
      </span>
      <h2 className="font-display text-2xl text-ink">Note not found</h2>
      <p className="mt-2 text-sm text-ink-secondary">It may have been moved to trash or removed.</p>
      <p className="mt-1 text-xs text-ink-muted">Taking you back to the library…</p>
    </div>
  );
}
