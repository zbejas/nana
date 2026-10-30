import { useState } from 'react';
import type { DocumentVersion } from '../../lib/documents';
import { MarkdownPreview } from '../MarkdownPreview';
import { Button, ConfirmDialog, Dialog } from '../ui';

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

  if (!isOpen || !version) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const content = version.content ?? '';
  const wordCount = content.split(/\s+/).filter((word) => word.length > 0).length;

  const handleRevertConfirm = () => {
    onRevert(version.id);
    setShowRevertConfirm(false);
    onClose();
  };

  const handleCreateNew = () => {
    onCreateNew(content);
    onClose();
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        eyebrow="Version history"
        title={`Version ${version.version_number}`}
        description={`Saved ${formatDate(version.source_created_at || version.created)}${version.change_summary ? ` · ${version.change_summary}` : ''}`}
        size="xl"
        footer={
          <>
            <span className="mr-auto hidden text-xs text-ink-muted sm:block">{wordCount.toLocaleString()} words</span>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={handleCreateNew}>
              Create note from version
            </Button>
            <Button variant="primary" onClick={() => setShowRevertConfirm(true)}>
              Restore this version
            </Button>
          </>
        }
      >
        <div className="rounded-control border border-line bg-surface-sunken/40 p-5 sm:p-7">
          <MarkdownPreview content={content} />
        </div>
      </Dialog>

      <ConfirmDialog
        open={showRevertConfirm}
        title={`Restore version ${version.version_number}?`}
        description="The current content is saved as a version first, so this can be undone."
        confirmLabel="Restore version"
        tone="danger"
        onConfirm={handleRevertConfirm}
        onCancel={() => setShowRevertConfirm(false)}
      />
    </>
  );
}
