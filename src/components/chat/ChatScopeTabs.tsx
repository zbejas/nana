import { LockClosedIcon } from '@heroicons/react/24/outline';
import { cn } from '../ui';
import type { ChatScope, NoteChatReason } from '../../lib/chat/types';

interface ChatScopeTabsProps {
  scope: ChatScope;
  onChange: (scope: ChatScope) => void;
  /** A note-chat status response has loaded. */
  noteReady: boolean;
  noteEnabled: boolean;
  noteLoading: boolean;
  noteReason: NoteChatReason | null;
  noteError?: string | null;
  className?: string;
}

/** One sentence explaining why the note tab cannot start a shared chat. */
export function noteChatUnavailableMessage(
  reason: NoteChatReason | null,
  loading = false,
  error?: string | null,
): string {
  if (loading && !reason) return 'Checking shared access…';
  if (error && !reason) return error;
  switch (reason) {
    case 'not_shared':
      return "Share this note with a person to chat together. Public links don't start a note chat.";
    case 'private':
      return 'Private notes cannot start a shared chat. Make this note visible to AI first.';
    case 'trashed':
      return 'This note is in the trash. Restore it to use its shared chat.';
    case 'unavailable':
      return 'You no longer have access to this note’s shared chat.';
    default:
      return error || 'Note chat is unavailable right now.';
  }
}

/**
 * Compact Personal | Note switch for the dock header. It mirrors the shared
 * segmented-control styling but supports a paused note tab with history.
 */
export function ChatScopeTabs({
  scope,
  onChange,
  noteReady,
  noteEnabled,
  noteLoading,
  noteReason,
  noteError = null,
  className,
}: ChatScopeTabsProps) {
  const notePaused = noteReady && !noteEnabled;
  const noteDisabled = noteLoading || !noteReady || !noteEnabled;
  const noteTitle = noteDisabled || notePaused
    ? noteChatUnavailableMessage(noteReason, noteLoading, noteError)
    : 'Chat together about this note';

  const tabClass = (active: boolean, disabled: boolean) => cn(
    'inline-flex h-[26px] items-center justify-center gap-1 rounded-[4px] border px-2.5 text-[12px] font-medium transition-colors duration-150',
    active
      ? 'border-line bg-surface text-ink'
      : 'border-transparent text-ink-muted hover:text-ink-secondary',
    disabled && 'cursor-not-allowed text-ink-muted opacity-50 hover:text-ink-muted',
  );

  return (
    <div className={cn('min-w-0', className)}>
      <div
        role="group"
        aria-label="Chat scope"
        className="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-sunken p-0.5"
      >
        <button
          type="button"
          aria-pressed={scope === 'personal'}
          title="Personal — only you can see this chat"
          onClick={() => onChange('personal')}
          className={tabClass(scope === 'personal', false)}
        >
          Personal
        </button>
        <button
          type="button"
          aria-pressed={scope === 'note'}
          disabled={noteDisabled}
          title={noteTitle}
          onClick={() => onChange('note')}
          className={tabClass(scope === 'note', noteDisabled)}
        >
          {notePaused && <LockClosedIcon className="h-3 w-3 shrink-0" aria-hidden="true" />}
          Note
        </button>
      </div>
      {(noteReady || Boolean(noteError)) && !noteEnabled && (
        <p className="mt-1 truncate text-[10.5px] leading-tight text-ink-muted" title={noteTitle}>
          {noteTitle}
        </p>
      )}
    </div>
  );
}
