import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PaperAirplaneIcon,
  PlusIcon,
  TrashIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  ChevronDownIcon,
  ClipboardIcon,
  ArrowPathIcon,
  CheckIcon,
  ArrowRightIcon,
  SparklesIcon,
  DocumentTextIcon,
  ViewColumnsIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../lib/pocketbase';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { Button, IconButton, PageHeader, PageShell } from '../components/ui';
import { getRecentChatId, setLastChat, clearLastChat } from '../lib/settings';
import { useToasts } from '../state/hooks';
import type { ChatToolActivity } from '../api/chat/types';
import { CHAT_EMPTY_RESPONSE_FALLBACK } from '../api/chat/types';

// ── Types ────────────────────────────────────────────────────────────

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  streaming?: boolean;
  tools?: ChatToolActivity[];
  model?: string;
}

interface Conversation {
  id: string;
  title: string;
  created: string;
  updated: string;
}

// ── Persistent stream store (survives component unmounts) ────────────
// When the user navigates away mid-stream, the async fetch loop keeps
// running and writing here. When ChatPage remounts it rehydrates from
// this store instead of fetching (possibly incomplete) data from the server.

const streamStore = {
  /** Conversation ID the stream belongs to (null = brand-new chat before server assigns one) */
  conversationId: null as string | null,
  /** Server-assigned ID for new conversations (from X-Conversation-Id header) */
  resolvedId: null as string | null,
  /** Whether this was a newly-created conversation */
  isNewConversation: false,
  /** Full messages array (user + assistant) kept up-to-date during streaming */
  messages: [] as Message[],
  /** True while the stream is in progress */
  active: false,
  /** Error captured during streaming */
  error: null as string | null,
  /** Callback set by the mounted component; null when unmounted */
  onUpdate: null as (() => void) | null,
  /** When true, the next sync should fire a "reply done" toast */
  pendingDoneToast: false,
};

function notifyStream() {
  streamStore.onUpdate?.();
}

// ── Tool activity (quiet, names/status only) ─────────────────────────

function upsertToolActivity(
  tools: ChatToolActivity[],
  id: string,
  name: string,
  status: ChatToolActivity['status'],
): ChatToolActivity[] {
  const existing = tools.findIndex((tool) => tool.id === id);
  if (existing === -1) return [...tools, { id, name, status }];
  const next = [...tools];
  if (next[existing]) {
    next[existing] = { id, name, status };
  }
  return next;
}

function setToolActivityStatus(
  tools: ChatToolActivity[],
  id: string,
  status: ChatToolActivity['status'],
): ChatToolActivity[] {
  const existing = tools.findIndex((tool) => tool.id === id);
  if (existing === -1) return tools;
  const current = tools[existing];
  if (!current) return tools;
  const next = [...tools];
  next[existing] = { ...current, status };
  return next;
}

function toolActivityLabel(tool: ChatToolActivity): string {
  switch (tool.name) {
    case 'list_notes':
      return 'Searched notes';
    case 'read_note':
      return 'Read notes';
    case 'list_boards':
      return 'Checked boards';
    case 'read_board':
      return 'Read a board';
    default:
      return 'Checked the workspace';
  }
}

function summarizeToolActivityLabels(tools: ChatToolActivity[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const label = toolActivityLabel(tool);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => {
      if (label === 'Read notes') return count > 1 ? `Read ${count} notes` : 'Read a note';
      if (label === 'Read a board' && count > 1) return `Read ${count} boards`;
      return label;
    })
    .join(' · ');
}

// ── API helpers ──────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = pb.authStore.token;
  return token ? { Authorization: token } : {};
}

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/chat/conversations', {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

async function fetchConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch conversation');
  return res.json();
}

async function deleteConversationApi(id: string): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

// ── Component ────────────────────────────────────────────────────────

export function ChatPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId?: string }>();

  // State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const [showScrollButton, setShowScrollButton] = useState(false);
  const [chatHeight, setChatHeight] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isAutoScrollEnabled = useRef(true);
  const didRedirectRef = useRef(false);
  // Keep a ref to the latest messages so sendMessage can read them without
  // adding `messages` to its dependency array (which would recreate it on
  // every streamed chunk).
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  const { showToast } = useToasts();

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const isRegeneratingRef = useRef(false);

  const isNewChat = !conversationId;
  const hasMessages = messages.length > 0;
  const activeModel = messages.reduce<string | undefined>(
    (model, message) => (message.role === 'assistant' && message.model ? message.model : model),
    undefined,
  );
  const conversationTitle =
    conversations.find((conversation) => conversation.id === conversationId)?.title || 'Conversation';

  // ── Responsive ───────────────────────────────────────────────────

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Mobile keyboard viewport fix ─────────────────────────────────

  useEffect(() => {
    if (!isMobile) {
      setChatHeight(null);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const onViewportResize = () => {
      const offset = vv.offsetTop;
      const keyboardHeight = window.innerHeight - vv.height - offset;

      // Only pin explicit height while keyboard is open.
      if (keyboardHeight > 120) {
        const visibleHeight = Math.max(vv.height - offset, 0);
        setChatHeight(`${visibleHeight}px`);
        return;
      }

      setChatHeight(null);
    };

    onViewportResize();
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', onViewportResize);
    return () => {
      vv.removeEventListener('resize', onViewportResize);
      vv.removeEventListener('scroll', onViewportResize);
    };
  }, [isMobile]);

  // ── Restore last chat session (within 30 min) ────────────────────

  useEffect(() => {
    if (!isNewChat || didRedirectRef.current) return;
    const recentId = getRecentChatId();
    if (recentId) {
      didRedirectRef.current = true;
      navigate(`/chat/${recentId}`, { replace: true });
    }
  }, [isNewChat, navigate]);

  // ── Subscribe to persistent stream store ─────────────────────────
  // Syncs module-level streamStore → React state whenever the store
  // changes (including while the component was unmounted and remounted).

  useEffect(() => {
    const sync = () => {
      setMessages([...streamStore.messages]);
      setIsStreaming(streamStore.active);
      if (streamStore.error) setError(streamStore.error);

      // Fire a toast when a reply just finished
      if (streamStore.pendingDoneToast) {
        streamStore.pendingDoneToast = false;
        showToast('AI reply finished', 'info');
      }
    };

    streamStore.onUpdate = sync;

    // On mount: if the store has an active or just-finished stream that
    // matches the current conversation, hydrate immediately.
    const matchesCurrent =
      streamStore.messages.length > 0 &&
      (streamStore.conversationId === (conversationId ?? null) ||
       streamStore.resolvedId === conversationId);

    if (matchesCurrent) {
      sync();
    }

    // If a new-chat stream finished while we were away and we're still on
    // /chat (no conversationId), navigate to the resolved conversation.
    if (
      !conversationId &&
      !streamStore.active &&
      streamStore.resolvedId &&
      streamStore.messages.length > 0
    ) {
      const id = streamStore.resolvedId;
      // Clear store before navigating so the load-conversation effect
      // doesn't see stale data.
      streamStore.messages = [];
      streamStore.resolvedId = null;
      streamStore.conversationId = null;
      streamStore.isNewConversation = false;
      navigate(`/chat/${id}`, { replace: true });
    }

    return () => {
      if (streamStore.onUpdate === sync) {
        streamStore.onUpdate = null;
      }
    };
  }, [conversationId, navigate]);

  // ── Load conversations list ──────────────────────────────────────

  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
    } catch {
      // Silently fail — sidebar will just be empty
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── Load conversation messages when navigating to one ────────────

  useEffect(() => {
    if (!conversationId) {
      // Only clear if there's no active stream for a new chat
      if (!streamStore.active || streamStore.conversationId !== null) {
        setMessages([]);
        setError(null);
      }
      return;
    }

    // Persist this as the last active chat
    setLastChat(conversationId);
    isAutoScrollEnabled.current = true;

    // If the stream store already has data for this conversation
    // (active or just-completed), skip the server fetch.
    if (
      streamStore.messages.length > 0 &&
      (streamStore.conversationId === conversationId ||
       streamStore.resolvedId === conversationId)
    ) {
      setMessages([...streamStore.messages]);
      setIsStreaming(streamStore.active);
      if (!streamStore.active) {
        // Stream finished while we were away — clean up store
        streamStore.messages = [];
        streamStore.resolvedId = null;
        streamStore.conversationId = null;
        streamStore.isNewConversation = false;
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await fetchConversation(conversationId);
        if (cancelled) return;
        setMessages(data.messages);
        setError(null);
      } catch {
        if (cancelled) return;
        // Conversation was deleted or doesn't exist — clear stored
        // last-chat and silently open a fresh chat instead of
        // showing an error.
        clearLastChat();
        navigate('/chat', { replace: true });
      }
    })();

    return () => { cancelled = true; };
  }, [conversationId, navigate]);

  // ── Auto-scroll (only when user is near bottom) ─────────────────

  useEffect(() => {
    if (isAutoScrollEnabled.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAutoScrollEnabled.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrollEnabled.current = true;
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ── Auto-resize textarea ─────────────────────────────────────────

  const adjustTextareaHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, []);

  // Resize on every value change (typing, paste, clear, etc.)
  useEffect(() => {
    adjustTextareaHeight(inputRef.current);
  }, [input, adjustTextareaHeight]);

  // ── Focus input ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isStreaming && !isMobile) {
      inputRef.current?.focus();
    }
  }, [isStreaming, conversationId, isMobile]);

  // ── Send message ─────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);

    // Re-enable auto-scroll when user sends a message
    isAutoScrollEnabled.current = true;
    setShowScrollButton(false);

    // Build the full messages array for this stream
    const userMsg: Message = { role: 'user', content: text };
    const assistantMsg: Message = { role: 'assistant', content: '', streaming: true };
    const allMessages = [...messagesRef.current, userMsg, assistantMsg];

    // Initialise persistent stream store
    streamStore.conversationId = conversationId || null;
    streamStore.resolvedId = null;
    streamStore.isNewConversation = false;
    streamStore.messages = allMessages;
    streamStore.active = true;
    streamStore.error = null;

    // Update React state
    setMessages(allMessages);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: text,
          ...(isRegeneratingRef.current ? { regenerate: true } : {}),
        }),
        signal: controller.signal,
      });

      // Reset regenerate flag after sending
      isRegeneratingRef.current = false;

      if (!res.ok) {
        let errMsg = 'Failed to send message';
        try {
          const errData = await res.json() as { error?: string };
          if (errData.error) errMsg = errData.error;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      // Get conversation ID from response header (for new conversations)
      const newConversationId = res.headers.get('X-Conversation-Id');
      const isNew = res.headers.get('X-Is-New-Conversation') === 'true';

      const modelNameHeader = res.headers.get('X-Model-Name') || '';

      // Persist the resolved ID immediately so the store knows the
      // server-assigned conversation even if we unmount mid-stream.
      if (isNew && newConversationId) {
        streamStore.resolvedId = newConversationId;
        streamStore.isNewConversation = true;
        setLastChat(newConversationId);
        notifyStream();
      }

      // Stream the response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';
      let fullReasoning = '';
      let streamError = '';
      let buffer = '';
      let toolActivity: ChatToolActivity[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6); // strip "data: "
            if (payload === '[DONE]') continue;

            try {
              const chunk = JSON.parse(payload);
              if (chunk.type === 'text-delta') {
                fullText += chunk.delta;
              } else if (chunk.type === 'reasoning-delta') {
                fullReasoning += chunk.delta;
              } else if (chunk.type === 'tool-input-start') {
                toolActivity = upsertToolActivity(
                  toolActivity,
                  chunk.toolCallId,
                  chunk.toolName,
                  'running',
                );
              } else if (chunk.type === 'tool-input-available') {
                toolActivity = upsertToolActivity(
                  toolActivity,
                  chunk.toolCallId,
                  chunk.toolName,
                  'running',
                );
              } else if (chunk.type === 'tool-input-error') {
                toolActivity = upsertToolActivity(
                  toolActivity,
                  chunk.toolCallId,
                  chunk.toolName,
                  'error',
                );
              } else if (chunk.type === 'tool-output-available') {
                const failed = chunk.output
                  && typeof chunk.output === 'object'
                  && chunk.output.ok === false;
                toolActivity = setToolActivityStatus(
                  toolActivity,
                  chunk.toolCallId,
                  failed ? 'error' : 'success',
                );
              } else if (chunk.type === 'tool-output-error' || chunk.type === 'tool-output-denied') {
                toolActivity = setToolActivityStatus(toolActivity, chunk.toolCallId, 'error');
              } else if (chunk.type === 'error') {
                streamError = chunk.errorText || 'An error occurred during streaming';
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Update persistent store with both text and reasoning
        const updated = [...streamStore.messages];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (lastIdx >= 0 && last && last.role === 'assistant') {
          updated[lastIdx] = {
            ...last,
            content: fullText,
            ...(fullReasoning ? { reasoning: fullReasoning } : {}),
            ...(toolActivity.length > 0 ? { tools: toolActivity } : {}),
            model: modelNameHeader,
          };
        }
        streamStore.messages = updated;
        notifyStream();
      }

      // If an error occurred during streaming, throw to trigger error handling
      if (streamError) {
        throw new Error(streamError);
      }

      // Finalize the assistant message
      {
        const updated = [...streamStore.messages];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (lastIdx >= 0 && last && last.role === 'assistant') {
          updated[lastIdx] = {
            ...last,
            content: fullText.trim() ? fullText : CHAT_EMPTY_RESPONSE_FALLBACK,
            streaming: false,
            ...(fullReasoning ? { reasoning: fullReasoning } : {}),
            ...(toolActivity.length > 0 ? { tools: toolActivity } : {}),
            model: modelNameHeader,
          };
        }
        streamStore.messages = updated;
        streamStore.active = false;
        streamStore.pendingDoneToast = true;
        notifyStream();
      }

      // Navigate to the new conversation URL if this was a new chat
      if (isNew && newConversationId) {
        navigate(`/chat/${newConversationId}`, { replace: true });
        loadConversations(); // Refresh sidebar

        // Refresh again after a delay to pick up AI-generated title
        setTimeout(() => loadConversations(), 4000);
      } else if (conversationId) {
        // Update last-chat timestamp on each interaction
        setLastChat(conversationId);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      // Remove the empty assistant placeholder on error
      const updated = [...streamStore.messages];
      const lastIdx = updated.length - 1;
      const last = updated[lastIdx];
      if (lastIdx >= 0 && last && last.role === 'assistant' && !last.content) {
        updated.pop();
      }
      streamStore.messages = updated;
      streamStore.active = false;
      streamStore.error = err instanceof Error ? err.message : 'Failed to send message';
      notifyStream();
    } finally {
      abortRef.current = null;
    }
  }, [
    input,
    isStreaming,
    conversationId,
    navigate,
    loadConversations,
  ]);

  // ── Delete conversation ──────────────────────────────────────────

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversationApi(id);
      setConversations(prev => prev.filter(c => c.id !== id));

      // Clear last-chat if we're deleting it
      const recent = getRecentChatId();
      if (recent === id) clearLastChat();

      if (conversationId === id) {
        navigate('/chat', { replace: true });
      }
    } catch {
      setError('Failed to delete conversation');
    }
  }, [conversationId, navigate]);

  // ── New chat ─────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    // Clear stream store so old data doesn't leak into the new chat
    streamStore.messages = [];
    streamStore.conversationId = null;
    streamStore.resolvedId = null;
    streamStore.isNewConversation = false;
    streamStore.active = false;
    streamStore.error = null;

    clearLastChat();
    navigate('/chat');
    setMessages([]);
    setError(null);
    setShowSidebar(false);
  }, [navigate]);

  // ── Copy / Regenerate handlers ──────────────────────────────────

  const copyMessage = useCallback((index: number, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(index);
      setTimeout(() => setCopiedId(prev => prev === index ? null : prev), 2000);
    });
  }, []);

  const regenerateLastResponse = useCallback(() => {
    if (isStreaming) return;

    let lastUserMsg: Message | null = null;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate?.role === 'user') {
        lastUserMsg = candidate;
        lastUserIdx = i;
        break;
      }
    }
    if (!lastUserMsg) return;

    // Trim messages to remove the last assistant response
    const trimmed = messages.slice(0, lastUserIdx);
    setMessages(trimmed);
    messagesRef.current = trimmed;
    streamStore.messages = trimmed;

    // Set input and flag for auto-send
    setInput(lastUserMsg.content);
    isRegeneratingRef.current = true;
    setPendingRegenerate(true);
  }, [isStreaming, messages]);

  // ── Key handler ──────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // ── Auto-send on regenerate ──────────────────────────────────────

  useEffect(() => {
    if (pendingRegenerate && input.trim()) {
      setPendingRegenerate(false);
      sendMessage();
    }
  }, [pendingRegenerate, input, sendMessage]);

  // ── Render ───────────────────────────────────────────────────────

  // Composer — one shell for the empty state and the message list.
  const inputBar = (
    <div className="w-full max-w-[800px]">
      {error && (
        <div
          role="alert"
          className="mb-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] leading-relaxed text-danger"
        >
          {error}
        </div>
      )}
      <div className="overflow-hidden rounded-panel border border-line bg-surface p-1.5 transition-colors focus-within:border-signal/50 focus-within:ring-4 focus-within:ring-signal/10">
        <label htmlFor="chat-composer" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="chat-composer"
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your notes or board..."
          rows={1}
          className="max-h-48 w-full resize-none overflow-y-auto scrollbar-autohide bg-transparent px-3 pb-1 pt-2.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
          style={{ minHeight: '2.75rem' }}
        />
        <div className="flex items-center justify-between gap-3 px-1.5 pb-1">
          <span className="hidden select-none text-[11.5px] text-ink-muted md:block">
            Enter to send · Shift+Enter for a new line
          </span>
          <button
            type="button"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            aria-label="Send message"
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-signal-bright text-on-signal sm:h-9 sm:w-9 transition-colors hover:bg-signal-bright-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PaperAirplaneIcon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="relative flex h-full overflow-hidden bg-canvas"
      style={isMobile && chatHeight ? { height: chatHeight } : undefined}
    >
      <PageShell scroll="content" className="flex-1" contentClassName="desktop-page-content-enter">
        <PageHeader
          title={isNewChat ? 'Chat' : conversationTitle}
          description={isNewChat ? 'Ask your notes or the board.' : 'Grounded in your workspace.'}
          meta={
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              {activeModel || 'Assistant'}
            </span>
          }
          actions={
            <>
              <Button variant="secondary" icon={<PlusIcon />} onClick={startNewChat}>
                New chat
              </Button>
              <IconButton
                label="Chat history"
                onClick={() => setShowSidebar(prev => !prev)}
                className={showSidebar ? 'bg-signal-soft text-signal' : 'bg-surface hover:bg-surface-raised'}
              >
                <ChatBubbleLeftRightIcon />
              </IconButton>
            </>
          }
        />

        <div className="flex min-h-0 w-full max-w-[800px] flex-1 flex-col">
        {/* Messages area + input */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isNewChat && !hasMessages ? (
          // ── Empty state: top-aligned reading column ──────────────────
          <div className="flex flex-1 min-h-0 flex-col">
            <div className="flex-1 overflow-y-auto scrollbar-autohide">
              <div className="flex min-h-full flex-col">
              <div className="my-auto w-full max-w-[800px] pb-4 pt-3 sm:pb-6 sm:pt-8">
                <h2 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[30px]">
                  Ask your notes.
                </h2>
                <p className="mt-2.5 max-w-[52ch] text-[14px] leading-relaxed text-ink-secondary">
                  Nana can list and read notes and boards, then answer from what it finds.
                </p>
                <div className="mt-6 grid w-full gap-2.5 sm:mt-8 sm:grid-cols-2">
                {[
                  { icon: SparklesIcon, prompt: 'What changed in my notes this week?' },
                  { icon: ViewColumnsIcon, prompt: 'Summarise the board.' },
                  { icon: MagnifyingGlassIcon, prompt: 'Find the note about …' },
                  { icon: DocumentTextIcon, prompt: 'What should I work on next?' },
                ].map(({ icon: Icon, prompt }) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
                    className="group flex min-h-[4rem] items-start gap-3 rounded-panel border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-raised sm:min-h-[5.25rem] sm:p-4"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-line bg-surface-sunken text-ink-muted">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 pt-0.5 text-[13px] font-medium leading-snug text-ink-secondary group-hover:text-ink">
                      {prompt}
                    </span>
                    <ArrowRightIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-muted transition-colors group-hover:text-ink" aria-hidden="true" />
                  </button>
                ))}
                </div>
              </div>
              </div>
            </div>
            <footer className="shrink-0 px-1 pt-3 sm:px-2 md:pb-4">
              {inputBar}
            </footer>
          </div>
        ) : (
          // ── Message list + bottom input ────────────────────────────
          <>
            <div className="relative flex-1 min-h-0">
              <main
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="absolute inset-0 overflow-y-auto scrollbar-autohide px-1 py-4 sm:px-2"
              >
                <div className="w-full max-w-[800px]">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={msg.role === 'user'
                        ? 'mb-7 flex flex-col items-end'
                        : 'mb-9 w-full max-w-[68ch]'}
                    >
                      {msg.role === 'user' ? (
                        <>
                          <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">
                            You
                          </p>
                          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] rounded-br-[3px] bg-surface-raised px-4 py-3 text-[14px] leading-[1.6] text-ink sm:max-w-[75%]">
                            {msg.content}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="mb-2.5 flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-line bg-surface-sunken text-[10px] font-semibold text-ink-secondary">
                              N
                            </span>
                            <span className="text-[11.5px] font-medium text-ink-secondary">Nana</span>
                          </div>

                          {msg.tools && msg.tools.length > 0 && (
                            <div className="mb-3" role="status" aria-live="polite" aria-atomic="true">
                              <p className="inline-flex min-h-7 items-center gap-2 rounded-[5px] border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-secondary">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    msg.streaming && msg.tools.some((tool) => tool.status === 'running')
                                      ? 'animate-pulse bg-signal'
                                      : 'bg-success'
                                  }`}
                                  aria-hidden="true"
                                />
                                {msg.streaming && msg.tools.some((tool) => tool.status === 'running')
                                  ? 'Looking through your workspace…'
                                  : summarizeToolActivityLabels(msg.tools)}
                              </p>
                            </div>
                          )}

                          {msg.reasoning && (
                            <details
                              className="group mb-3"
                              open={msg.streaming && !msg.content}
                            >
                              <summary className="flex h-7 cursor-pointer select-none items-center gap-1.5 text-[11.5px] font-medium text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden [&::marker]:hidden">
                                <ChevronDownIcon
                                  className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
                                  aria-hidden="true"
                                />
                                <span>{msg.streaming && !msg.content ? 'Thinking…' : 'Reasoning'}</span>
                              </summary>
                              <div className="mt-1 max-h-80 overflow-y-auto border-l border-line pl-3 text-[13px] leading-relaxed text-ink-muted scrollbar-autohide">
                                <MarkdownPreview
                                  content={msg.reasoning}
                                  className="chat-markdown !text-[13px] !leading-relaxed text-ink-muted [&_p]:my-1 [&_pre]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_code]:text-[11.5px]"
                                />
                              </div>
                            </details>
                          )}

                          {msg.content ? (
                            <div className="chat-answer break-words text-[14.5px] leading-[1.75] text-ink">
                              <MarkdownPreview
                                content={msg.content}
                                className="chat-markdown !text-[14.5px] !leading-[1.75] [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs"
                              />
                              {msg.streaming && (
                                <span
                                  className="ml-0.5 inline-block h-4 w-px animate-pulse bg-signal align-text-bottom"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                          ) : !msg.reasoning && msg.streaming && !(msg.tools && msg.tools.length > 0) ? (
                            <p className="inline-flex items-center gap-2 text-[11.5px] font-medium text-ink-muted">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
                              Thinking…
                            </p>
                          ) : null}

                          {!msg.streaming && msg.content && (
                            <div className="mt-2 flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => copyMessage(i, msg.content)}
                                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                                title="Copy message"
                                aria-label="Copy message"
                              >
                                {copiedId === i ? (
                                  <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                                ) : (
                                  <ClipboardIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                              </button>
                              {/* Only show regenerate on the last assistant message */}
                              {i === messages.length - 1 && (
                                <button
                                  type="button"
                                  onClick={regenerateLastResponse}
                                  className="flex h-7 w-7 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                                  title="Regenerate response"
                                  aria-label="Regenerate response"
                                >
                                  <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </main>

              {/* Scroll-to-bottom button */}
              {showScrollButton && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-[6px] border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
                  title="Scroll to bottom"
                  aria-label="Scroll to bottom"
                >
                  <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>New messages</span>
                </button>
              )}
            </div>
            <footer className="shrink-0 px-1 pb-0 pt-3 sm:px-2 md:pb-4">
              {inputBar}
            </footer>
          </>
        )}
        </div>
        </div>
      </PageShell>

      {/* ── Right history scrim (mobile only) ────────────────────── */}
      {isMobile && showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-scrim"
          onClick={() => setShowSidebar(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Conversation history panel (right side, collapsible) ── */}
      <div
        className={`
          ${isMobile
            ? `fixed bottom-0 right-0 top-0 z-50 w-72 border-l border-line bg-canvas-deep transition-transform duration-200 ease-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`
            : `relative shrink-0 transition-[width,opacity,margin] duration-200 ease-out overflow-hidden ${showSidebar ? 'my-6 mr-4 w-64 opacity-100 lg:my-9' : 'w-0 opacity-0'}`
          }
          flex flex-col
        `}
      >
        {/* Inner container — carries the visual chrome on desktop */}
        <div className={`flex min-h-0 flex-1 flex-col ${!isMobile ? 'overflow-hidden rounded-panel border border-line bg-surface' : ''}`}>
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            {isMobile ? (
              <button
                type="button"
                onClick={startNewChat}
                className="flex h-8 flex-1 items-center gap-2 rounded-control bg-signal-bright px-2.5 text-[12px] font-medium text-on-signal transition-colors hover:bg-signal-bright-strong"
              >
                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                New chat
              </button>
            ) : (
              <span className="text-[11.5px] font-medium text-ink-muted">Conversations</span>
            )}
            <IconButton label="Close history" size="sm" onClick={() => setShowSidebar(false)}>
              <XMarkIcon />
            </IconButton>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto scrollbar-autohide">
            {conversations.length === 0 && (
              <p className="border-b border-line px-4 py-6 text-[13px] text-ink-muted">No conversations yet</p>
            )}
            {conversations.map(conv => {
              const isActive = conv.id === conversationId;
              return (
                <div
                  key={conv.id}
                  className={`group relative flex items-center border-b border-line transition-colors ${
                    isActive ? 'bg-signal-soft' : 'hover:bg-surface-sunken'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/chat/${conv.id}`);
                      if (isMobile) setShowSidebar(false);
                    }}
                    className={`flex min-w-0 flex-1 items-center px-3 py-2.5 text-left text-[13px] leading-snug transition-colors ${
                      isActive ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'
                    }`}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className="truncate" title={conv.title}>{conv.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(conv.id)}
                    className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-muted opacity-100 transition-colors hover:bg-surface-raised hover:text-danger focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    aria-label={`Delete conversation ${conv.title}`}
                    title={`Delete ${conv.title}`}
                  >
                    <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
