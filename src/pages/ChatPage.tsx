import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  SparklesIcon,
  PaperAirplaneIcon,
  PlusIcon,
  TrashIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  CheckIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../lib/pocketbase';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { getRecentChatId, setLastChat, clearLastChat } from '../lib/settings';
import { useToasts } from '../state/hooks';
import { listDocuments } from '../lib/documents/crud';
import type { Document } from '../lib/documents/types';

// ── Types ────────────────────────────────────────────────────────────

interface ChatSource {
  id: string;
  title: string;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  sources?: ChatSource[];
}

interface Conversation {
  id: string;
  title: string;
  created: string;
  updated: string;
}

// ── Persistent stream store (survives component unmounts) ────────────
// When the user navigates away mid-stream, the async fetch loop keeps
// running and writing here.  When ChatPage remounts it rehydrates from
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

  // Document picker
  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [attachedDocs, setAttachedDocs] = useState<{ id: string; title: string }[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputThickRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isAutoScrollEnabled = useRef(true);
  const didRedirectRef = useRef(false);
  // Keep a ref to the latest messages so sendMessage can read them without
  // adding `messages` to its dependency array (which would recreate it on
  // every streamed chunk).
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  const { showToast } = useToasts();

  const isNewChat = !conversationId;
  const hasMessages = messages.length > 0;

  // ── Responsive ───────────────────────────────────────────────────

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Load documents for doc picker ────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    listDocuments().then(({ items }) => {
      if (!cancelled) setAllDocuments(items);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Document picker filtering ────────────────────────────────────

  const filteredDocuments = useMemo(() => {
    const q = docSearchQuery.toLowerCase();
    return allDocuments.filter(d => !q || d.title.toLowerCase().includes(q));
  }, [allDocuments, docSearchQuery]);

  const docPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDocPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (docPickerRef.current && !docPickerRef.current.contains(e.target as Node)) {
        setShowDocPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDocPicker]);

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
    adjustTextareaHeight(inputThickRef.current);
  }, [input, adjustTextareaHeight]);

  // ── Focus input ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming, conversationId]);

  // ── Send message ─────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Capture attached doc IDs before clearing
    const docIds = attachedDocs.map(d => d.id);

    setInput('');
    setAttachedDocs([]);
    setShowDocPicker(false);
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
          ...(docIds.length > 0 ? { documentIds: docIds } : {}),
        }),
        signal: controller.signal,
      });

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

      // Parse RAG sources (documents used for context)
      let ragSources: ChatSource[] = [];
      try {
        const sourcesHeader = res.headers.get('X-RAG-Sources');
        if (sourcesHeader) {
          ragSources = JSON.parse(sourcesHeader);
        }
      } catch { /* ignore parse errors */ }

      // Persist the resolved ID immediately so the store knows the
      // server-assigned conversation even if we unmount mid-stream.
      if (isNew && newConversationId) {
        streamStore.resolvedId = newConversationId;
        streamStore.isNewConversation = true;
        setLastChat(newConversationId);
      }

      // Stream the response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;

        // Update persistent store
        const updated = [...streamStore.messages];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (lastIdx >= 0 && last && last.role === 'assistant') {
          updated[lastIdx] = { ...last, content: fullText };
        }
        streamStore.messages = updated;
        // Notify mounted component (no-op if unmounted)
        notifyStream();
      }

      // Finalize the assistant message
      {
        const updated = [...streamStore.messages];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (lastIdx >= 0 && last && last.role === 'assistant') {
          updated[lastIdx] = {
            ...last,
            content: fullText,
            streaming: false,
            ...(ragSources.length > 0 ? { sources: ragSources } : {}),
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
  }, [input, isStreaming, conversationId, navigate, loadConversations, attachedDocs]);

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

    navigate('/chat');
    setMessages([]);
    setError(null);
    setShowSidebar(false);
  }, [navigate]);

  // ── Key handler ──────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // ── Render ───────────────────────────────────────────────────────

  // ── Document picker popover (shared between both input bars) ───

  const renderDocPicker = () => {
    if (!showDocPicker) return null;
    return (
      <div
        ref={docPickerRef}
        className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-xl bg-gray-900/95 border border-white/10 backdrop-blur-xl shadow-2xl"
      >
        <div className="p-2 border-b border-white/5">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={docSearchQuery}
              onChange={e => setDocSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/30"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto scrollbar-autohide p-1">
          {filteredDocuments.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No documents found</p>
          ) : (
            filteredDocuments.map(doc => {
              const isAttached = attachedDocs.some(d => d.id === doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    if (isAttached) {
                      setAttachedDocs(prev => prev.filter(d => d.id !== doc.id));
                    } else {
                      setAttachedDocs(prev => [...prev, { id: doc.id, title: doc.title }]);
                    }
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${
                    isAttached
                      ? 'bg-blue-500/15 text-blue-200'
                      : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <DocumentTextIcon className="w-4 h-4 shrink-0 text-gray-500" />
                  <span className="flex-1 truncate">{doc.title}</span>
                  {isAttached && <CheckIcon className="w-4 h-4 shrink-0 text-blue-400" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  // ── Attached doc chips ───────────────────────────────────────────

  const renderAttachedDocs = () => {
    if (attachedDocs.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-white/5">
        {attachedDocs.map(doc => (
          <span
            key={doc.id}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-500/15 border border-blue-500/20 px-2 py-0.5 text-xs text-blue-300"
          >
            <DocumentTextIcon className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[150px]">{doc.title}</span>
            <button
              type="button"
              onClick={() => setAttachedDocs(prev => prev.filter(d => d.id !== doc.id))}
              className="ml-0.5 rounded p-0.5 hover:bg-blue-500/20 transition-colors"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
    );
  };

  // Input bar component (reused in message-list footer and mobile empty state)
  const inputBar = (
    <div className="w-full max-w-5xl mx-auto">
      {error && (
        <div className="mb-2 px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="relative bg-white/5 border border-white/10 rounded-2xl overflow-visible">
        {renderDocPicker()}
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-white placeholder-gray-500 focus:outline-none max-h-48 overflow-y-auto scrollbar-autohide"
          style={{ minHeight: '2.5rem' }}
        />
        {renderAttachedDocs()}
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => { setShowDocPicker(prev => !prev); setDocSearchQuery(''); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              attachedDocs.length > 0
                ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-400'
            }`}
            title="Attach documents for context"
          >
            <PaperClipIcon className="w-3.5 h-3.5" />
            {attachedDocs.length > 0 ? `${attachedDocs.length} doc${attachedDocs.length > 1 ? 's' : ''}` : 'Attach docs'}
          </button>
          <button
            type="button"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-lg p-2 text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  // Thicker input bar for desktop empty state (more padding + heavier border)
  const inputBarThick = (
    <div className="w-full max-w-5xl mx-auto">
      {error && (
        <div className="mb-2 px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="relative bg-white/5 border-2 border-white/15 rounded-2xl overflow-visible">
        {renderDocPicker()}
        <textarea
          ref={inputThickRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-sm text-white placeholder-gray-500 focus:outline-none max-h-48 overflow-y-auto scrollbar-autohide"
          style={{ minHeight: '2.75rem' }}
        />
        {renderAttachedDocs()}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/5">
          <button
            type="button"
            onClick={() => { setShowDocPicker(prev => !prev); setDocSearchQuery(''); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
              attachedDocs.length > 0
                ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-400'
            }`}
            title="Attach documents for context"
          >
            <PaperClipIcon className="w-3.5 h-3.5" />
            {attachedDocs.length > 0 ? `${attachedDocs.length} doc${attachedDocs.length > 1 ? 's' : ''}` : 'Attach docs'}
          </button>
          <button
            type="button"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-lg p-2 text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`h-full bg-black/40 backdrop-blur-md overflow-hidden flex ${isMobile ? 'px-1 pt-4 pb-0' : 'p-4 sm:p-6'}`}
      style={isMobile && chatHeight ? { height: chatHeight } : undefined}
    >
      {/* ── Main chat area ──────────────────────────────────────── */}
      <div className="desktop-page-content-enter flex-1 min-w-0 flex flex-col h-full">
        {/* Header */}
        <header className="shrink-0 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-white">
                <SparklesIcon className="w-5 h-5 text-blue-400" />
                <h1 className="text-xl font-bold text-white">Chat</h1>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {isNewChat ? 'Start a new conversation with AI' : (conversations.find(c => c.id === conversationId)?.title || 'Conversation with AI')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={startNewChat}
                className="inline-flex items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/20 p-2 text-blue-100 hover:bg-blue-500/30 transition-colors"
                title="New chat"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowSidebar(prev => !prev)}
                className={`inline-flex items-center justify-center rounded-lg border p-2 transition-colors ${showSidebar ? 'border-blue-500/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30' : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'}`}
                title="Chat history"
              >
                <ChatBubbleLeftRightIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Messages area + input */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isNewChat && !hasMessages ? (
          isMobile ? (
            // ── Mobile: hero at top, input pinned at bottom ──────────────
            <div className="flex-1 flex flex-col p-4">
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <SparklesIcon className="w-10 h-10 text-blue-400 mx-auto" />
                  <h2 className="text-xl font-semibold text-white">How can I help you?</h2>
                  <p className="text-sm text-gray-400">Start a conversation with AI</p>
                </div>
              </div>
              {inputBar}
            </div>
          ) : (
            // ── Desktop: hero + thick input centered together ─────────────
            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-8">
              <div className="text-center space-y-2">
                <SparklesIcon className="w-12 h-12 text-blue-400 mx-auto" />
                <h2 className="text-2xl font-semibold text-white">How can I help you?</h2>
                <p className="text-sm text-gray-400">Start a conversation with AI</p>
              </div>
              <div className="w-full max-w-4xl">
                {inputBarThick}
              </div>
            </div>
          )
        ) : (
          // ── Message list + bottom input ────────────────────────────
          <>
            <div className="relative flex-1 min-h-0">
              <main
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="absolute inset-0 overflow-y-auto scrollbar-autohide px-2 sm:px-4 py-4"
              >
                <div className="max-w-5xl mx-auto space-y-4">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`
                          max-w-[85%] rounded-2xl px-4 py-2.5 text-sm break-words
                          ${msg.role === 'user'
                            ? 'bg-blue-500/20 border border-blue-500/30 text-blue-50'
                            : 'bg-white/5 border border-white/10 text-gray-200'
                          }
                          ${msg.streaming && !msg.content ? 'animate-pulse' : ''}
                        `}
                      >
                        {!msg.content ? (
                          <span className="text-gray-500 italic">Thinking...</span>
                        ) : (
                          <MarkdownPreview
                            content={msg.content}
                            className="chat-markdown [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs"
                          />
                        )}
                        {msg.streaming && msg.content && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-400 animate-pulse rounded-sm align-text-bottom" />
                        )}
                        {msg.sources && msg.sources.length > 0 && !msg.streaming && (
                          <div className="mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-gray-500 mr-0.5 self-center">Sources:</span>
                            {msg.sources.map((src) => (
                              <a
                                key={src.id}
                                href={`/document/${src.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/document/${src.id}`);
                                }}
                                className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition-colors cursor-pointer"
                                title={src.title}
                              >
                                <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                </svg>
                                <span className="truncate max-w-[120px]">{src.title}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </main>

              {/* Scroll-to-bottom button */}
              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm px-3 py-1.5 text-xs text-gray-300 hover:bg-white/20 hover:text-white transition-all shadow-lg"
                  title="Scroll to bottom"
                >
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                  <span>New messages</span>
                </button>
              )}
            </div>
            <footer className="shrink-0 px-1 sm:px-4 pb-0 pt-2 md:pb-4">
              {inputBar}
            </footer>
          </>
        )}
        </div>
      </div>

      {/* ── Right sidebar backdrop (mobile only) ────────────────── */}
      {isMobile && showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* ── Conversation history panel (right side, collapsible) ── */}
      <div
        className={`
          ${isMobile
            ? `fixed top-0 right-0 bottom-0 z-50 w-72 transition-transform duration-200 ease-out bg-black/60 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`
            : `relative shrink-0 transition-[width,opacity] duration-200 ease-out overflow-hidden ${showSidebar ? 'w-64 opacity-100' : 'w-0 opacity-0'}`
          }
          flex flex-col ml-3
        `}
      >
        {/* Inner container — carries the visual chrome on desktop */}
        <div className={`flex flex-col h-full ${!isMobile ? 'bg-white/5 rounded-2xl ring-1 ring-white/8 overflow-hidden' : ''}`}>
          {/* Panel header */}
          <div className="px-3 pt-3 pb-2 flex items-center gap-2">
            <button
              onClick={startNewChat}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white bg-blue-500/20 hover:bg-blue-500/30 ring-1 ring-blue-500/30 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              New Chat
            </button>
            <button
              onClick={() => setShowSidebar(false)}
              className="rounded-xl p-2 text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
              title="Close panel"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 scrollbar-autohide">
            {conversations.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-6">No conversations yet</p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`
                  group flex items-center gap-2 rounded-xl px-3 py-2 text-sm cursor-pointer transition-colors
                  ${conv.id === conversationId
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }
                `}
                onClick={() => {
                  navigate(`/chat/${conv.id}`);
                  if (isMobile) setShowSidebar(false);
                }}
              >
                <ChatBubbleLeftRightIcon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate" title={conv.title}>{conv.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(conv.id);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
