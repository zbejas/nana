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
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={props.onClose}
          />
          <div className="relative flex h-full w-full flex-col overflow-hidden bg-black/95 backdrop-blur-sm md:max-h-[90vh] md:max-w-6xl md:rounded-2xl md:border md:border-white/10 md:shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] md:px-4 md:py-3 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-200 truncate mr-4">{props.filename}</h3>
              <button
                onClick={props.onClose}
                aria-label="Close viewer"
                className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10 flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-black/40 flex items-center justify-center px-4 text-gray-400 text-sm">
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
