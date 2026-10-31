import {
  DocumentTextIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { PendingChatAttachment } from '../../lib/chat/types';
import { formatChatFileSize } from '../../lib/chat/attachments';
import { Spinner, cn } from '../ui';

interface ChatAttachmentTrayProps {
  attachments: PendingChatAttachment[];
  error?: string | null;
  warning?: string | null;
  onRemove: (localId: string) => void;
}

function AttachmentIcon({ attachment }: { attachment: PendingChatAttachment }) {
  if (attachment.kind === 'image') {
    return <PhotoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
  return <DocumentTextIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

/** Draft files inside the composer, before they become a sent message. */
export function ChatAttachmentTray({
  attachments,
  error,
  warning,
  onRemove,
}: ChatAttachmentTrayProps) {
  if (attachments.length === 0 && !error && !warning) return null;

  return (
    <div className="space-y-1.5 px-2 pb-1.5 pt-1">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.localId}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-control border px-2 py-1 text-[11.5px]',
                attachment.status === 'error'
                  ? 'border-danger/30 bg-danger-soft text-danger'
                  : 'border-line bg-surface-sunken text-ink-secondary',
              )}
              title={attachment.error || `${attachment.mimeType} · ${formatChatFileSize(attachment.size)}`}
            >
              {attachment.status === 'uploading' ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <AttachmentIcon attachment={attachment} />
              )}
              <span className="max-w-[12rem] truncate">{attachment.name}</span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-ink-muted">
                {formatChatFileSize(attachment.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(attachment.localId)}
                aria-label={`Remove ${attachment.name}`}
                className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <XMarkIcon className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {warning && (
        <p className="text-[11px] leading-relaxed text-warning" role="status">
          {warning}
        </p>
      )}
      {error && (
        <p className="text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
