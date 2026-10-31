import { useEffect, useMemo, useState } from 'react';
import {
  CheckIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button, ConfirmDialog, IconButton, Input } from '../ui';
import { useToasts } from '../../state/hooks';
import {
  deleteConversation,
  refreshConversations,
  renameConversation,
  useChatStore,
} from '../../lib/chat/store';
import {
  conversationSubtitle,
  filterConversations,
  groupConversationsByDate,
} from '../../lib/chat/history';
import type { ChatConversation } from '../../lib/chat/types';

interface ChatHistoryProps {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose?: () => void;
  onDeleted?: (id: string) => void;
  /** Hide the internal header when a Sheet already provides one. */
  compactHeader?: boolean;
}

export function ChatHistory({
  activeConversationId,
  onSelect,
  onNewChat,
  onClose,
  onDeleted,
  compactHeader = false,
}: ChatHistoryProps) {
  const conversations = useChatStore((snapshot) => snapshot.conversations);
  const loading = useChatStore((snapshot) => snapshot.conversationsLoading);
  const error = useChatStore((snapshot) => snapshot.conversationsError);
  const pendingIds = useChatStore((snapshot) => snapshot.pendingEditConversationIds);
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToasts();

  useEffect(() => {
    void refreshConversations();
  }, []);

  const visible = useMemo(() => filterConversations(conversations, query), [conversations, query]);
  const groups = useMemo(() => groupConversationsByDate(visible), [visible]);
  const pending = useMemo(() => new Set(pendingIds), [pendingIds]);

  const startRename = (conversation: ChatConversation) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const title = renameDraft.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    try {
      await renameConversation(renamingId, title);
      setRenamingId(null);
    } catch {
      showToast('Could not rename that chat.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteConversation(pendingDelete.id);
      showToast('Chat deleted.', 'info');
      onDeleted?.(pendingDelete.id);
      setPendingDelete(null);
    } catch {
      showToast('Could not delete that chat.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const isPending = (conversation: ChatConversation) =>
    pending.has(conversation.id) || (conversation.pending_edits ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!compactHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <p className="text-[11.5px] font-medium text-ink-muted">History</p>
          {onClose && (
            <IconButton label="Close history" size="sm" onClick={onClose}>
              <XMarkIcon />
            </IconButton>
          )}
        </div>
      )}

      <div className="space-y-2 border-b border-line px-3 py-2.5">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          icon={<PlusIcon />}
          onClick={onNewChat}
        >
          New chat
        </Button>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          icon={<MagnifyingGlassIcon />}
          className="h-8 text-[12.5px]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">
        {loading && conversations.length === 0 && (
          <div className="space-y-2 px-3 py-4" aria-label="Loading chats">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-8 animate-pulse rounded-control bg-surface-sunken" />
            ))}
          </div>
        )}

        {error && (
          <div className="px-3 py-4">
            <p className="text-[12px] leading-relaxed text-danger">{error}</p>
            <Button variant="link" size="sm" className="mt-1" onClick={() => void refreshConversations()}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <p className="px-3 py-5 text-[12.5px] leading-relaxed text-ink-muted">
            {query.trim() ? 'No chats match that search.' : 'No conversations yet.'}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.label} aria-label={group.label} className="pb-1">
            <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-ink-muted">{group.label}</p>
            {group.conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const renaming = renamingId === conversation.id;

              if (renaming) {
                return (
                  <div key={conversation.id} className="flex items-center gap-1 bg-surface-sunken px-2 py-1.5">
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void commitRename();
                        } else if (event.key === 'Escape') {
                          setRenamingId(null);
                        }
                      }}
                      aria-label="Chat title"
                      className="h-7 min-w-0 flex-1 rounded-[4px] border border-signal/50 bg-surface px-2 text-[12.5px] text-ink focus:outline-none focus:ring-4 focus:ring-signal/10"
                    />
                    <IconButton label="Save title" size="sm" className="h-7 w-7" onClick={() => void commitRename()}>
                      <CheckIcon />
                    </IconButton>
                    <IconButton label="Cancel rename" size="sm" className="h-7 w-7" onClick={() => setRenamingId(null)}>
                      <XMarkIcon />
                    </IconButton>
                  </div>
                );
              }

              return (
                <div
                  key={conversation.id}
                  className={`group relative flex items-center transition-colors ${
                    active ? 'bg-signal-soft' : 'hover:bg-surface-sunken'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left text-[12.5px] leading-snug transition-colors ${
                      active ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'
                    }`}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      {isPending(conversation) && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-signal"
                          title="Nana is editing"
                          aria-label="Nana is editing"
                        />
                      )}
                      <span className="truncate" title={conversation.title}>{conversation.title}</span>
                    </span>
                    <span className="mt-0.5 text-[10.5px] text-ink-muted">
                      {conversationSubtitle(conversation)}
                    </span>
                  </button>

                  <div className="mr-1 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    <IconButton
                      label={`Rename ${conversation.title}`}
                      size="sm"
                      className="h-7 w-7"
                      onClick={() => startRename(conversation)}
                    >
                      <PencilSquareIcon />
                    </IconButton>
                    <IconButton
                      label={`Delete ${conversation.title}`}
                      size="sm"
                      className="h-7 w-7 hover:text-danger"
                      onClick={() => setPendingDelete(conversation)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete “${pendingDelete?.title ?? 'this chat'}”?`}
        description="The conversation and its messages are removed. Notes and boards are not changed."
        confirmLabel="Delete chat"
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
