import {
  DocumentTextIcon,
  FolderIcon,
  LockClosedIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { ChatContextTarget } from '../../lib/chat/context';
import { formatChatContextTitle } from '../../lib/chat/context';

interface ChatContextChipProps {
  target: ChatContextTarget;
  onRemove: () => void;
}

function ContextIcon({ type }: { type: ChatContextTarget['type'] }) {
  if (type === 'board') return <ViewColumnsIcon className="h-3.5 w-3.5" aria-hidden="true" />;
  if (type === 'folder') return <FolderIcon className="h-3.5 w-3.5" aria-hidden="true" />;
  return <DocumentTextIcon className="h-3.5 w-3.5" aria-hidden="true" />;
}

/** The current-page chip above the composer, plus the "what Nana can see" note. */
export function ChatContextChip({ target, onRemove }: ChatContextChipProps) {
  if (target.unavailable) return null;

  const label = formatChatContextTitle(target.type, target.title, target.loading);
  const noun = target.type === 'document' ? 'note' : target.type === 'folder' ? 'folder' : 'board';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={`inline-flex h-6 min-w-0 max-w-[17rem] items-center gap-1.5 rounded-[5px] border px-1.5 text-[11.5px] ${
          target.isPrivate
            ? 'border-warning/30 bg-warning-soft text-warning'
            : 'border-line bg-surface-sunken text-ink-secondary'
        }`}
        title={label}
      >
        <ContextIcon type={target.type} />
        <span className="truncate">{label}</span>
        {target.isPrivate && <LockClosedIcon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove page context"
          title="Remove page context"
          className="-mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <XMarkIcon className="h-3 w-3" aria-hidden="true" />
        </button>
      </span>

      <details className="group relative">
        <summary className="inline-flex cursor-pointer list-none items-center text-[11px] text-ink-muted transition-colors hover:text-ink-secondary [&::-webkit-details-marker]:hidden">
          What Nana can see
        </summary>
        <div className="absolute bottom-full left-1/2 z-30 mb-1.5 w-[17rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-panel border border-line bg-surface-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary shadow-float">
          {target.isPrivate ? (
            <p>
              This {noun} is private. Nana cannot read private notes, boards, or folders, so the
              context will not be attached to this message.
            </p>
          ) : (
            <p>
              Your message carries only the page id. Nana looks up the title and can read the
              {noun === 'note' ? ' note' : ` ${noun}`} with its tools, scoped to your account.
              The page body is never sent with the message.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
