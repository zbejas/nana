import { lazy, Suspense } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { AttachmentViewerModalProps } from './AttachmentViewerModal';

const AttachmentViewerModal = lazy(() => import('./AttachmentViewerModal'));

export function LazyAttachmentViewer(props: AttachmentViewerModalProps) {
  if (!props.isOpen) return null;

  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[10002] flex items-stretch md:items-center md:justify-center md:p-4">
          <div
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-md"
            onClick={props.onClose}
          />
          <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface md:max-h-[90vh] md:max-w-6xl md:rounded-panel md:border md:border-line md:shadow-float">
            <div className="flex items-center justify-between border-b border-line px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] md:px-4 md:py-3 flex-shrink-0">
              <h3 className="text-sm font-medium truncate mr-4 font-display text-base text-ink">{props.filename}</h3>
              <button
                onClick={props.onClose}
                aria-label="Close viewer"
                className="text-ink-muted hover:text-ink transition-colors p-2 rounded-control hover:bg-surface-raised flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-surface-sunken/70 flex items-center justify-center px-4 text-ink-muted text-sm">
              Loading viewer…
            </div>
          </div>
        </div>
      }
    >
      <AttachmentViewerModal {...props} />
    </Suspense>
  );
}
