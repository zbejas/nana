import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatBubbleLeftRightIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button, IconButton, PageHeader, PageShell, SegmentedControl, Sheet } from '../components/ui';
import { ChatHistory } from '../components/chat/ChatHistory';
import { ChatThread } from '../components/chat/ChatThread';
import {
  loadNoteChatStatus,
  refreshStatus,
  setActiveConversation,
  setChatMode,
  startNewConversation,
  useChatStore,
} from '../lib/chat/store';
import { useChatViewportHeight, useIsMobileChat } from '../lib/chat/viewport';
import { findChatModel } from '../lib/chat/models';
import { useBackToClose } from '../lib/useBackToClose';

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

  useBackToClose(isMobile && historySheetOpen, () => setHistorySheetOpen(false));

  const conversation = useChatStore((snapshot) => snapshot.conversation);
  const storeConversationId = useChatStore((snapshot) => snapshot.conversationId);
  const initialConversationId = useRef<string | null>(conversationId ? null : storeConversationId);
  const mode = useChatStore((snapshot) => snapshot.mode);
  const scope = useChatStore((snapshot) => snapshot.scope);
  const noteChatStatus = useChatStore((snapshot) => snapshot.noteChatStatus);
  const status = useChatStore((snapshot) => snapshot.status);
  const selectedModelId = useChatStore((snapshot) => snapshot.selectedModelId);
  const statusLoading = useChatStore((snapshot) => snapshot.statusLoading);
  const statusError = useChatStore((snapshot) => snapshot.statusError);
  const groupChat = scope === 'note'
    || conversation?.scope === 'note'
    || Boolean(conversation?.documentId);
  const groupDocumentId = conversation?.documentId;
  const askOnly = groupChat && noteChatStatus?.canEdit === false;

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

  // A deep link can open a shared note conversation directly. Load its access
  // status so the page uses the same paused/read-only rules as the dock.
  useEffect(() => {
    if (groupDocumentId) void loadNoteChatStatus(groupDocumentId);
  }, [groupDocumentId]);

  useEffect(() => {
    if (askOnly && mode === 'edit') setChatMode('ask');
  }, [askOnly, mode]);
  // A new conversation gets its id from the response header. Keep the URL in
  // sync while the stream is still running.
  useEffect(() => {
    if (!conversationId && storeConversationId) {
      navigate(`/chat/${storeConversationId}`, { replace: true });
    }
  }, [conversationId, storeConversationId, navigate]);

  const newChat = () => {
    const fromSheet = historySheetOpen;
    startNewConversation();
    setShowHistory(false);
    setHistorySheetOpen(false);
    // The sheet owns a synthetic history entry; replace it so Back does not
    // land on the sheet's URL before the previous conversation.
    navigate('/chat', fromSheet ? { replace: true } : undefined);
  };

  const openHistory = () => {
    if (isMobile) setHistorySheetOpen(true);
    else setShowHistory((value) => !value);
  };

  const selectConversation = (id: string) => {
    const fromSheet = historySheetOpen;
    setHistorySheetOpen(false);
    navigate(`/chat/${id}`, fromSheet ? { replace: true } : undefined);
  };

  const selectedModel = findChatModel(status, selectedModelId);
  let statusText = 'Assistant';
  if (status?.configured === false) statusText = 'Not configured';
  else if (selectedModel) statusText = selectedModel.label;
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
        <PageShell scroll="content" className="chat-page flex-1" contentClassName="desktop-page-content-enter">
          <PageHeader
            title={conversation?.title || 'Chat'}
            description={conversationId
              ? groupChat
                ? 'One conversation for everyone with access to this note.'
                : 'Grounded in your workspace.'
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
                {askOnly ? (
                  <span
                    className="inline-flex h-8 items-center rounded-control border border-line bg-surface-sunken px-2.5 text-[12.5px] font-medium text-ink-muted"
                    title="Shared chats on this note are read-only"
                  >
                    Ask only
                  </span>
                ) : (
                  <SegmentedControl
                    label="Chat mode"
                    value={mode}
                    onChange={setChatMode}
                    className="chat-mode-control"
                    options={[
                      { value: 'edit', label: 'Work', title: 'Work — Nana can read and change folders, notes, boards, and tasks' },
                      { value: 'ask', label: 'Ask', title: 'Ask — Nana only reads notes and boards' },
                    ]}
                  />
                )}
                <Button
                  variant="secondary"
                  icon={<PlusIcon />}
                  onClick={newChat}
                  aria-label="New chat"
                >
                  <span className="hidden min-[400px]:inline">New chat</span>
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
