import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatBubbleLeftRightIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, PageHeader, PageShell, SegmentedControl, Sheet } from '../components/ui';
import { ChatHistory } from '../components/chat/ChatHistory';
import { ChatThread } from '../components/chat/ChatThread';
import {
  refreshStatus,
  setActiveConversation,
  setChatMode,
  startNewConversation,
  useChatStore,
} from '../lib/chat/store';
import { useChatViewportHeight, useIsMobileChat } from '../lib/chat/viewport';

/**
 * Full-page chat for deep links. It shares the dock's store and components, so
 * a reply started in the dock is visible here and vice versa.
 */
export function ChatPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const isMobile = useIsMobileChat();
  const viewportHeight = useChatViewportHeight(isMobile);
  const [showHistory, setShowHistory] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);

  const conversation = useChatStore((snapshot) => snapshot.conversation);
  const storeConversationId = useChatStore((snapshot) => snapshot.conversationId);
  const initialConversationId = useRef<string | null>(conversationId ? null : storeConversationId);
  const mode = useChatStore((snapshot) => snapshot.mode);
  const status = useChatStore((snapshot) => snapshot.status);
  const statusLoading = useChatStore((snapshot) => snapshot.statusLoading);
  const statusError = useChatStore((snapshot) => snapshot.statusError);

  useEffect(() => {
    if (conversationId) {
      setActiveConversation(conversationId);
      return;
    }
    // Bare /chat resumes the persisted conversation once, then rewrites the
    // URL so the page remains deep-linkable. A deliberate New chat clears the
    // persisted id before navigating here, so this does not reopen it.
    if (initialConversationId.current === null) {
      initialConversationId.current = storeConversationId;
    }
    if (initialConversationId.current) {
      setActiveConversation(initialConversationId.current);
      navigate(`/chat/${initialConversationId.current}`, { replace: true });
      return;
    }
    startNewConversation();
  }, [conversationId, navigate]);

  useEffect(() => {
    void refreshStatus();
  }, []);

  // A new conversation gets its id from the response header. Keep the URL in
  // sync while the stream is still running.
  useEffect(() => {
    if (!conversationId && storeConversationId) {
      navigate(`/chat/${storeConversationId}`, { replace: true });
    }
  }, [conversationId, storeConversationId, navigate]);

  const newChat = () => {
    startNewConversation();
    setShowHistory(false);
    setHistorySheetOpen(false);
    navigate('/chat');
  };

  const openHistory = () => {
    if (isMobile) setHistorySheetOpen(true);
    else setShowHistory((value) => !value);
  };

  const selectConversation = (id: string) => {
    setHistorySheetOpen(false);
    navigate(`/chat/${id}`);
  };

  let statusText = 'Assistant';
  if (status?.configured === false) statusText = 'Not configured';
  else if (status?.model) statusText = status.model;
  else if (statusLoading) statusText = 'Checking status…';
  else if (statusError) statusText = 'Status unavailable';

  const statusDot = status?.configured === false
    ? 'bg-warning'
    : status?.configured === true
      ? 'bg-success'
      : 'bg-ink-muted';

  const history = (
    <ChatHistory
      activeConversationId={storeConversationId}
      onSelect={selectConversation}
      onNewChat={newChat}
      onClose={isMobile ? undefined : () => setShowHistory(false)}
      onDeleted={(id) => {
        if (conversationId === id) navigate('/chat', { replace: true });
      }}
    />
  );

  return (
    <>
      <div
        className="relative flex h-full overflow-hidden bg-canvas"
        style={isMobile && viewportHeight ? { height: `${viewportHeight}px` } : undefined}
      >
        <PageShell scroll="content" className="flex-1" contentClassName="desktop-page-content-enter">
          <PageHeader
            title={conversation?.title || 'Chat'}
            description={conversationId
              ? 'Grounded in your workspace.'
              : mode === 'edit'
                ? 'Ask, or tell Nana what to change.'
                : 'Ask your notes and boards.'}
            meta={
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} aria-hidden="true" />
                {statusText}
              </span>
            }
            actions={
              <>
                <SegmentedControl
                  label="Chat mode"
                  value={mode}
                  onChange={setChatMode}
                  options={[
                    { value: 'edit', label: 'Work', title: 'Work — Nana can read and change folders, notes, boards, and tasks' },
                    { value: 'ask', label: 'Ask', title: 'Ask — Nana only reads notes and boards' },
                  ]}
                />
                <Button variant="secondary" icon={<PlusIcon />} onClick={newChat}>
                  New chat
                </Button>
                <IconButton
                  label="Chat history"
                  onClick={openHistory}
                  className={showHistory ? 'bg-signal-soft text-signal' : 'bg-surface hover:bg-surface-raised'}
                >
                  <ChatBubbleLeftRightIcon />
                </IconButton>
              </>
            }
          />

          <div className="flex min-h-0 w-full max-w-[800px] flex-1 flex-col">
            <ChatThread
              key={conversationId ?? 'new'}
              variant="page"
              autoFocus
              onOpenSettings={() => navigate('/settings/admin/ai')}
            />
          </div>
        </PageShell>

        {showHistory && !isMobile && (
          <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-canvas-deep">
            {history}
          </aside>
        )}
      </div>

      {isMobile && (
        <Sheet
          open={historySheetOpen}
          onClose={() => setHistorySheetOpen(false)}
          title="Chat history"
        >
          <div className="h-[70dvh] min-h-0">{history}</div>
        </Sheet>
      )}
    </>
  );
}
