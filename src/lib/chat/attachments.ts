import type { AIChatModelOption } from '../ai/types';
import type { ChatAttachmentKind } from '../../api/chat/types';

export const CHAT_ATTACHMENT_ACCEPT =
  '.txt,.md,.markdown,.pdf,image/png,image/jpeg,image/webp,image/gif';

/** Client-side hint only; the server re-detects from magic bytes. */
export function classifyChatFile(file: File): ChatAttachmentKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) {
    return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) ? 'image' : null;
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'text/plain'
    || type === 'text/markdown'
    || type === 'text/x-markdown'
    || name.endsWith('.txt')
    || name.endsWith('.md')
    || name.endsWith('.markdown')
  ) {
    return 'text';
  }
  return null;
}

export function formatChatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A short warning when the current model cannot use a selected file. */
export function attachmentModelWarning(
  kind: ChatAttachmentKind,
  model: AIChatModelOption | null,
): string | null {
  if (!model) return null;
  if (kind === 'image' && !model.vision) {
    return `${model.label} cannot read images. Switch to a vision-capable model or remove the image.`;
  }
  return null;
}
