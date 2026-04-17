import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { isPdfFile } from '../../lib/documents';

const PDFJS_WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export interface AttachmentViewerModalProps {
  isOpen: boolean;
  url: string;
  filename: string;
  onClose: () => void;
}

export default function AttachmentViewerModal({
  isOpen,
  url,
  filename,
  onClose,
}: AttachmentViewerModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const renderContent = () => {
    if (isPdfFile(filename)) {
      return (
        <Worker workerUrl={PDFJS_WORKER_URL}>
          <div className="flex-1 overflow-auto" style={{ height: '100%' }}>
            <Viewer
              fileUrl={url}
              withCredentials={false}
              renderError={(error) => (
                <div className="flex items-center justify-center h-full text-red-400 text-sm p-8 text-center">
                  <p>Failed to load PDF. Try downloading instead.<br /><span className="text-red-500/60 text-xs">{String(error.message)}</span></p>
                </div>
              )}
              renderLoader={(percentages) => (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  Loading… {Math.round(percentages)}%
                </div>
              )}
            />
          </div>
        </Worker>
      );
    }

    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Preview not available for this file type.
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[10002] flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${filename}`}
        className="relative flex flex-col w-full h-full max-w-6xl mx-auto my-4 md:my-8 bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
          <h3 className="text-sm font-medium text-gray-200 truncate mr-4">
            {filename}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close viewer"
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10 flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {renderContent()}
        </div>
      </div>
    </div>,
    window.document.body,
  );
}
