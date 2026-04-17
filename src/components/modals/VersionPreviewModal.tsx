import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { DocumentVersion } from '../../lib/documents';
import { ConfirmDialog } from './ConfirmDialog';
import { MarkdownPreview } from '../MarkdownPreview';

interface VersionPreviewModalProps {
  isOpen: boolean;
  version: DocumentVersion | null;
  onClose: () => void;
  onRevert: (versionId: string) => void;
  onCreateNew: (content: string) => void;
}

export function VersionPreviewModal({
  isOpen,
  version,
  onClose,
  onRevert,
  onCreateNew,
}: VersionPreviewModalProps) {
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (showRevertConfirm) {
          setShowRevertConfirm(false);
          return;
        }
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, showRevertConfirm]);

  if (!isOpen || !version) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleRevertClick = () => {
    setShowRevertConfirm(true);
  };

  const handleRevertConfirm = () => {
    onRevert(version.id);
    setShowRevertConfirm(false);
    onClose();
  };

  const handleCreateNew = () => {
    onCreateNew(version.content);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-preview-title"
        className="relative bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 id="version-preview-title" className="text-xl font-semibold text-white">
              Version {version.version_number} Preview
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              Created {formatDate(version.source_created_at || version.created)}
            </p>
            {version.change_summary && (
              <p className="text-sm text-gray-500 mt-1 italic">
                "{version.change_summary}"
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close version preview"
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content Preview */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px] scrollbar-autohide">
          <MarkdownPreview content={version.content || ''} />
        </div>

        {/* Footer Actions */}
        <div className="p-4 md:p-6 border-t border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          <div className="text-sm text-gray-400 hidden md:block">
            {version.content.split(/\s+/).filter(w => w.length > 0).length} words
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full md:w-auto">
            <button
              onClick={onClose}
              className="px-5 py-3 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 active:bg-gray-600 transition-colors text-sm font-medium border border-white/10 min-h-[44px]"
            >
              Close
            </button>
            <button
              onClick={handleCreateNew}
              className="px-5 py-3 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 active:bg-blue-500/40 transition-colors text-sm font-medium border border-blue-500/30 flex items-center justify-center gap-2 min-h-[44px]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="sm:hidden">Create New</span>
              <span className="hidden sm:inline">Create New Document</span>
            </button>
            <button
              onClick={handleRevertClick}
              className="px-5 py-3 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 active:bg-green-500/40 transition-colors text-sm font-medium border border-green-500/30 flex items-center justify-center gap-2 min-h-[44px]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="sm:hidden">Revert</span>
              <span className="hidden sm:inline">Revert to This Version</span>
            </button>
          </div>
        </div>
      </div>

      {/* Revert Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showRevertConfirm}
        title="Revert to Version?"
        message={`Are you sure you want to revert to version ${version.version_number}? This will create a new version with this content.`}
        onSave={handleRevertConfirm}
        onDiscard={handleRevertConfirm}
        onCancel={() => setShowRevertConfirm(false)}
        saveLabel="Revert"
        discardLabel=""
        cancelLabel="Cancel"
      />
    </div>,
    window.document.body
  );
}
