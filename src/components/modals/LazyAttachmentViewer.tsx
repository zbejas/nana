import { lazy, Suspense } from 'react';
import type { AttachmentViewerModalProps } from './AttachmentViewerModal';

const AttachmentViewerModal = lazy(() => import('./AttachmentViewerModal'));

export function LazyAttachmentViewer(props: AttachmentViewerModalProps) {
  if (!props.isOpen) return null;

  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="text-gray-400 text-sm">Loading viewer…</div>
        </div>
      }
    >
      <AttachmentViewerModal {...props} />
    </Suspense>
  );
}
