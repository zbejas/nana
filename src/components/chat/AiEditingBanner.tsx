import { SparklesIcon } from '@heroicons/react/24/outline';
import { useAiEditing, type AiEditingState } from '../../lib/chat/presence';

interface AiEditingBannerProps {
  type: AiEditingState['targetType'];
  id: string | undefined;
  className?: string;
}

/**
 * Drop-in banner for the editor and board surfaces. It is not mounted here
 * because the editor workstream owns that chrome; the shared presence atom is
 * ready for it.
 */
export function AiEditingBanner({ type, id, className = '' }: AiEditingBannerProps) {
  const editing = useAiEditing();
  if (!editing || !id || editing.targetType !== type || editing.targetId !== id) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 border-b border-signal/20 bg-signal-soft px-4 py-2 text-[12px] font-medium text-signal ${className}`}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
      <SparklesIcon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Nana is editing this note</span>
      {editing.title && (
        <span className="max-w-[20rem] truncate font-normal text-ink-secondary">“{editing.title}”</span>
      )}
    </div>
  );
}
