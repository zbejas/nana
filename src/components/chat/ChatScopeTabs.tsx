import { LockClosedIcon } from '@heroicons/react/24/outline';
import { SegmentedControl } from '../ui';
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
      return "Share this note with a person to chat together. Public links don't start a shared chat.";
    case 'private':
      return 'Private notes cannot start a shared chat. Make this note visible to AI first.';
    case 'trashed':
      return 'This note is in the trash. Restore it to use its shared chat.';
    case 'unavailable':
      return 'You no longer have access to this note’s shared chat.';
    default:
      return error || 'Shared chat is unavailable right now.';
  }
}

/**
 * Compact conversation-scope switch. Personal is the reader's own thread;
 * Note is the one shared conversation for the current document.
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

  return (
    <SegmentedControl
      label="Chat scope"
      size="sm"
      className={className}
      value={scope}
      onChange={(next) => {
        if (next === 'note' && noteDisabled) return;
        onChange(next);
      }}
      options={[
        {
          value: 'personal',
          label: 'Personal',
          title: 'Personal — only you can see this chat',
        },
        {
          value: 'note',
          label: 'Shared',
          title: noteTitle,
          disabled: noteDisabled,
          ...(notePaused
            ? { icon: <LockClosedIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> }
            : {}),
        },
      ]}
    />
  );
}
