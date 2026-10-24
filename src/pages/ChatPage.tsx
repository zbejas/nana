import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAtomValue, useSetAtom } from 'jotai';
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
  DocumentTextIcon,
  ClipboardIcon,
  ArrowPathIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../lib/pocketbase';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { IconButton } from '../components/ui';
import { getRecentChatId, setLastChat, clearLastChat } from '../lib/settings';
import { highlightText } from '../lib/highlightText';
import { useToasts } from '../state/hooks';
import { listDocuments } from '../lib/documents/crud';
import type { Document } from '../lib/documents/types';
import { useDocumentSearch } from '../lib/documents/useDocumentSearch';
import {
  CHAT_ATTACHMENT_DRAFT_KEY,
  chatAttachedDocumentsAtom,
  clearChatAttachedDocumentsAtom,
  moveChatAttachedDocumentsAtom,
  removeChatAttachedDocumentAtom,
  toggleChatAttachedDocumentAtom,
  type ChatAttachedDocument,
} from '../state/atoms';

// ── Types ────────────────────────────────────────────────────────────

interface ChatSource {
  id: string;
  title: string;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  streaming?: boolean;
  sources?: ChatSource[];
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

function formatDocumentDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const EMPTY_ATTACHED_DOCS: ChatAttachedDocument[] = [];

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
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');

  const attachedDocumentsByScope = useAtomValue(chatAttachedDocumentsAtom);
  const toggleChatAttachedDocument = useSetAtom(toggleChatAttachedDocumentAtom);
  const removeChatAttachedDocument = useSetAtom(removeChatAttachedDocumentAtom);
  const clearChatAttachedDocuments = useSetAtom(clearChatAttachedDocumentsAtom);
  const moveChatAttachedDocuments = useSetAtom(moveChatAttachedDocumentsAtom);

  const activeAttachmentScopeKey = conversationId ?? streamStore.resolvedId ?? CHAT_ATTACHMENT_DRAFT_KEY;
  const attachedDocs = attachedDocumentsByScope[activeAttachmentScopeKey] ?? EMPTY_ATTACHED_DOCS;

  const attachedDocIds = useMemo(() => new Set(attachedDocs.map(doc => doc.id)), [attachedDocs]);
  const trimmedDocSearchQuery = docSearchQuery.trim();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputThickRef = useRef<HTMLTextAreaElement>(null);
  const docPickerRef = useRef<HTMLDivElement>(null);
  const docPickerToggleRef = useRef<HTMLButtonElement>(null);
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

  const closeDocPicker = useCallback(() => {
    setShowDocPicker(false);
    setDocSearchQuery('');
  }, []);

  const toggleDocPicker = useCallback(() => {
    setShowDocPicker(prev => !prev);
    setDocSearchQuery('');
  }, []);

  const toggleAttachedDocument = useCallback((doc: Pick<Document, 'id' | 'title'>) => {
    toggleChatAttachedDocument({
      scopeKey: activeAttachmentScopeKey,
      doc: {
        id: doc.id,
        title: doc.title || 'Untitled',
      },
    });
  }, [activeAttachmentScopeKey, toggleChatAttachedDocument]);

  const handleRemoveAttachedDocument = useCallback((docId: string) => {
    removeChatAttachedDocument({
      scopeKey: activeAttachmentScopeKey,
      docId,
    });
  }, [activeAttachmentScopeKey, removeChatAttachedDocument]);

  const { results: searchedDocuments, isLoading: isSearchingDocuments } = useDocumentSearch(docSearchQuery, {
    debounceMs: 250,
    enabled: showDocPicker && trimmedDocSearchQuery.length > 0,
    limit: isMobile ? 16 : 12,
  });

  const browseDocuments = useMemo(() => {
    if (attachedDocIds.size === 0) return allDocuments;

    const selected: Document[] = [];
    const available: Document[] = [];

    for (const doc of allDocuments) {
      if (attachedDocIds.has(doc.id)) {
        selected.push(doc);
      } else {
        available.push(doc);
      }
    }

    return [...selected, ...available];
  }, [allDocuments, attachedDocIds]);

  useEffect(() => {
    if (!showDocPicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (docPickerRef.current?.contains(target) || docPickerToggleRef.current?.contains(target)) {
        return;
      }

      closeDocPicker();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDocPicker, closeDocPicker]);

  useEffect(() => {
    if (!showDocPicker) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDocPicker();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showDocPicker, closeDocPicker]);

  useEffect(() => {
    if (!isMobile || !showDocPicker) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, showDocPicker]);

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
    if (!isStreaming && !isMobile) {
      inputRef.current?.focus();
    }
  }, [isStreaming, conversationId, isMobile]);

  // ── Send message ─────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Capture attached doc IDs before clearing
    const docIds = attachedDocs.map(d => d.id);

    setInput('');
    closeDocPicker();
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

      // Parse RAG sources (documents used for context)
      let ragSources: ChatSource[] = [];
      try {
        const sourcesHeader = res.headers.get('X-RAG-Sources');
        if (sourcesHeader) {
          ragSources = JSON.parse(sourcesHeader);
        }
      } catch { /* ignore parse errors */ }

      const modelNameHeader = res.headers.get('X-Model-Name') || '';

      // Persist the resolved ID immediately so the store knows the
      // server-assigned conversation even if we unmount mid-stream.
      if (isNew && newConversationId) {
        streamStore.resolvedId = newConversationId;
        streamStore.isNewConversation = true;
        moveChatAttachedDocuments({
          fromScopeKey: CHAT_ATTACHMENT_DRAFT_KEY,
          toScopeKey: newConversationId,
        });
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
            content: fullText,
            streaming: false,
            ...(fullReasoning ? { reasoning: fullReasoning } : {}),
            ...(ragSources.length > 0 ? { sources: ragSources } : {}),
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
    attachedDocs,
    closeDocPicker,
    moveChatAttachedDocuments,
  ]);

  // ── Delete conversation ──────────────────────────────────────────

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversationApi(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      clearChatAttachedDocuments(id);

      // Clear last-chat if we're deleting it
      const recent = getRecentChatId();
      if (recent === id) clearLastChat();

      if (conversationId === id) {
        navigate('/chat', { replace: true });
      }
    } catch {
      setError('Failed to delete conversation');
    }
  }, [clearChatAttachedDocuments, conversationId, navigate]);

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

  // ── Document picker popover (shared between both input bars) ───

  const renderDocPicker = () => {
    if (!showDocPicker) return null;
    const pickerDocuments = trimmedDocSearchQuery ? searchedDocuments : browseDocuments;
    const emptyLabel = trimmedDocSearchQuery
      ? 'No documents match that search'
      : 'No documents available yet';

    const pickerContent = (
      <>
        <div className={`${isMobile ? 'px-4 pb-4 pt-3' : 'px-3 py-3'} border-b border-line`}>
          {isMobile && <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-raised" />}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Document context</p>
              <p className="mt-1 text-xs text-ink-muted">
                {attachedDocs.length > 0
                  ? `${attachedDocs.length} selected for this chat`
                  : 'Attach documents to steer the reply'}
              </p>
            </div>
            {isMobile && (
              <button
                type="button"
                onClick={closeDocPicker}
                className="rounded-panel border border-line bg-surface-raised p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
                aria-label="Close document picker"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="relative mt-3">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              type="text"
              value={docSearchQuery}
              onChange={e => setDocSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="w-full rounded-panel border border-line bg-surface-raised pl-9 pr-3 py-2 text-sm text-ink placeholder:text-ink-muted transition-colors focus:outline-none focus:border-ember/30 focus:bg-surface-raised"
              autoFocus={!isMobile}
            />
          </div>
        </div>

        <div className={`overflow-y-auto scrollbar-autohide ${isMobile ? 'max-h-[min(60vh,32rem)] px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'max-h-[min(22rem,45vh)] p-2'}`}>
          {isSearchingDocuments ? (
            <div className="flex items-center justify-center gap-2 px-3 py-5 text-xs text-ink-muted">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4Zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647Z" />
              </svg>
              Searching documents...
            </div>
          ) : pickerDocuments.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-ink-muted">{emptyLabel}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {trimmedDocSearchQuery ? 'Try a shorter title or tag search.' : 'Create a document to use it as chat context.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1 py-2">
              {pickerDocuments.map(doc => {
                const isAttached = attachedDocIds.has(doc.id);
                const visibleTags = doc.tags?.slice(0, 2) ?? [];

                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => toggleAttachedDocument(doc)}
                    className={`group flex w-full items-start gap-3 rounded-panel border px-3 py-2.5 text-left transition-colors ${
                      isAttached
                        ? 'border-ember/30 bg-ember-soft text-ember'
                        : 'border-transparent text-ink-muted hover:border-line hover:bg-surface-raised'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control border ${
                      isAttached
                        ? 'border-ember/30 bg-ember-soft text-ember'
                        : 'border-line bg-surface-raised text-ink-muted group-hover:text-ink-muted'
                    }`}>
                      <DocumentTextIcon className="w-4 h-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0 block flex-1 truncate text-sm font-medium leading-5">
                          {highlightText(doc.title || 'Untitled', trimmedDocSearchQuery, 'bg-ember-soft text-ember')}
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${
                          isAttached
                            ? 'border-ember/30 bg-ember-soft text-ember'
                            : 'border-line text-ink-muted group-hover:text-ink-muted'
                        }`}>
                          {isAttached ? 'Added' : 'Add'}
                        </span>
                      </span>

                      <span className={`mt-1 flex items-center gap-1.5 overflow-hidden text-[11px] ${
                        isAttached ? 'text-ember' : 'text-ink-muted'
                      }`}>
                        <span className="truncate">
                          {visibleTags.length > 0 ? (
                            visibleTags.map((tag, index) => (
                              <span key={`${doc.id}-${tag}`}>
                                {index > 0 && ' • '}
                                {highlightText(tag, trimmedDocSearchQuery, 'bg-ember-soft text-ember')}
                              </span>
                            ))
                          ) : (
                            'No tags'
                          )}
                        </span>
                        <span className={isAttached ? 'shrink-0 text-ember' : 'shrink-0 text-ink-muted'}>•</span>
                        <span className="shrink-0">Updated {formatDocumentDate(doc.updated)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>
    );

    if (isMobile) {
      return createPortal(
        <div className="fixed inset-0 z-[80]">
          <div
            className="absolute inset-0 bg-surface-sunken/70 backdrop-blur-sm"
            onClick={closeDocPicker}
          />
          <div
            ref={docPickerRef}
            className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[1.75rem] border border-line border-b-0 bg-surface-sunken/70 shadow-float backdrop-blur-xl"
          >
            {pickerContent}
          </div>
        </div>,
        document.body,
      );
    }

    return (
      <div
        ref={docPickerRef}
        className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-panel border border-line bg-surface-sunken/70 shadow-float backdrop-blur-xl"
      >
        {pickerContent}
      </div>
    );
  };

  // ── Attached doc chips ───────────────────────────────────────────

  const renderAttachedDocs = () => {
    if (attachedDocs.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-line">
        {attachedDocs.map(doc => (
          <span
            key={doc.id}
            className="inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border border-ember/30 bg-ember-soft px-2.5 py-1 text-[11px] text-ember sm:max-w-[12rem]"
          >
            <DocumentTextIcon className="w-3 h-3 shrink-0" />
            <span className="truncate">{doc.title}</span>
            <button
              type="button"
              onClick={() => handleRemoveAttachedDocument(doc.id)}
              className="rounded-full p-0.5 transition-colors hover:bg-ember-soft"
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
        <div className="mb-2 px-3 py-2 bg-danger-soft border border-danger/30 rounded-control text-sm text-danger">
          {error}
        </div>
      )}
      <div className="relative rounded-panel border border-line bg-surface shadow-panel overflow-visible">
        {renderDocPicker()}
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none max-h-48 overflow-y-auto scrollbar-autohide"
          style={{ minHeight: '2.5rem' }}
        />
        {renderAttachedDocs()}
        <div className="flex items-center justify-between px-3 py-2 border-t border-line">
          <button
            ref={docPickerToggleRef}
            type="button"
            onClick={toggleDocPicker}
            className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-medium transition-all ${
              showDocPicker || attachedDocs.length > 0
                ? 'bg-ember-soft text-ember hover:bg-ember/15'
                : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
            }`}
            title="Attach documents for context"
            aria-expanded={showDocPicker}
          >
            <PaperClipIcon className="w-3.5 h-3.5" />
            {attachedDocs.length > 0 ? `${attachedDocs.length} doc${attachedDocs.length > 1 ? 's' : ''}` : (isMobile ? 'Docs' : 'Attach docs')}
          </button>
          <button
            type="button"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-control bg-ember p-2 text-on-ember transition-colors hover:bg-ember-strong disabled:cursor-not-allowed disabled:opacity-40"
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
        <div className="mb-2 px-3 py-2 bg-danger-soft border border-danger/30 rounded-control text-sm text-danger">
          {error}
        </div>
      )}
      <div className="relative rounded-panel border border-line bg-surface shadow-panel overflow-visible">
        {renderDocPicker()}
        <textarea
          ref={inputThickRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          className="w-full resize-none bg-transparent px-5 pt-4 pb-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none max-h-48 overflow-y-auto scrollbar-autohide"
          style={{ minHeight: '2.75rem' }}
        />
        {renderAttachedDocs()}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-line">
          <button
            ref={docPickerToggleRef}
            type="button"
            onClick={toggleDocPicker}
            className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-medium transition-all ${
              showDocPicker || attachedDocs.length > 0
                ? 'bg-ember-soft text-ember hover:bg-ember/15'
                : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
            }`}
            title="Attach documents for context"
            aria-expanded={showDocPicker}
          >
            <PaperClipIcon className="w-3.5 h-3.5" />
            {attachedDocs.length > 0 ? `${attachedDocs.length} doc${attachedDocs.length > 1 ? 's' : ''}` : (isMobile ? 'Docs' : 'Attach docs')}
          </button>
          <button
            type="button"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 rounded-control bg-ember p-2 text-on-ember transition-colors hover:bg-ember-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`flex h-full overflow-hidden bg-canvas ${isMobile ? 'px-1 pt-4 pb-0' : 'px-4 py-5 sm:px-6 sm:py-6'}`}
      style={isMobile && chatHeight ? { height: chatHeight } : undefined}
    >
      {/* ── Main chat area ──────────────────────────────────────── */}
      <div className="desktop-page-content-enter flex-1 min-w-0 flex flex-col h-full">
        {/* Header */}
        <header className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5"><SparklesIcon className="h-3.5 w-3.5 text-ember" /> Assistant</p>
            <h1 className="mt-1.5 truncate font-display text-2xl leading-tight text-ink">Chat</h1>
            <p className="mt-1 truncate text-sm text-ink-secondary">
              {isNewChat ? 'Ask about your notes, or bring a document into the conversation.' : (conversations.find(c => c.id === conversationId)?.title || 'Conversation with AI')}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <IconButton label="New chat" onClick={startNewChat}>
              <PlusIcon />
            </IconButton>
            <IconButton
              label="Chat history"
              onClick={() => setShowSidebar(prev => !prev)}
              className={showSidebar ? 'bg-ember-soft text-ember' : undefined}
            >
              <ChatBubbleLeftRightIcon />
            </IconButton>
          </div>
        </header>

        {/* Messages area + input */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isNewChat && !hasMessages ? (
          isMobile ? (
            // ── Mobile: hero at top, input pinned at bottom ──────────────
            <div className="flex-1 flex flex-col p-4">
              <div className="flex-1 flex items-center justify-center">
                <div className="max-w-sm space-y-2 text-center">
                  <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-ember/25 bg-ember-soft text-ember">
                    <SparklesIcon className="h-5 w-5" />
                  </span>
                  <h2 className="font-display text-2xl text-ink">How can I help?</h2>
                  <p className="text-sm leading-relaxed text-ink-secondary">
                    Ask about your notes, or attach a document to keep the conversation grounded.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {['Summarise my recent notes', 'Help me plan the week', 'Draft a short update'].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-secondary transition-colors hover:border-ember/35 hover:text-ember"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {inputBar}
            </div>
          ) : (
            // ── Desktop: hero + thick input centered together ─────────────
            <div className="flex-1 flex flex-col items-center justify-center p-4 gap-8">
              <div className="max-w-md space-y-2 text-center">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-ember/25 bg-ember-soft text-ember">
                  <SparklesIcon className="h-5 w-5" />
                </span>
                <h2 className="font-display text-3xl text-ink">How can I help?</h2>
                <p className="text-sm leading-relaxed text-ink-secondary">
                  Ask about your notes, or attach a document to keep the conversation grounded.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-3">
                  {['Summarise my recent notes', 'Help me plan the week', 'Draft a short update'].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-secondary transition-colors hover:border-ember/35 hover:text-ember"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
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
                      <div className={`max-w-[85%] ${msg.role === 'assistant' ? 'space-y-1' : ''}`}>
                        {/* Model name label for assistant messages */}
                        {msg.role === 'assistant' && msg.model && (
                          <div className="flex items-center gap-1.5 px-1 mb-1">
                            <SparklesIcon className="w-3 h-3 text-ember" />
                            <span className="text-[11px] font-medium text-ink-muted">{msg.model}</span>
                          </div>
                        )}
                        <div
                          className={`
                            rounded-panel px-4 py-2.5 text-sm break-words
                            ${msg.role === 'user'
                              ? 'border border-ember/25 bg-ember-soft text-ink'
                              : 'border border-line bg-surface-raised text-ink-secondary'
                            }
                            ${msg.streaming && !msg.content ? 'animate-pulse' : ''}
                          `}
                        >
                          {/* Reasoning/thinking section */}
                          {msg.reasoning && (
                            <details
                              className="mb-2 rounded-control border border-line bg-surface-raised"
                              open={msg.streaming && !msg.content}
                            >
                              <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs text-ink-muted select-none hover:text-ink transition-colors [&::-webkit-details-marker]:hidden [&::marker]:hidden">
                                <SparklesIcon className="w-3 h-3 shrink-0" />
                                <span>Thinking</span>
                                {msg.streaming && !msg.content && (
                                  <span className="inline-block w-1 h-3 ml-0.5 bg-surface-raised animate-pulse rounded-sm" />
                                )}
                              </summary>
                              <div className="px-2.5 pb-2 text-xs text-ink-muted break-words max-h-80 overflow-y-auto scrollbar-autohide">
                                <MarkdownPreview
                                  content={msg.reasoning}
                                  className="chat-markdown text-xs text-ink-muted [&_p]:my-0.5 [&_pre]:my-1 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[10px]"
                                />
                              </div>
                            </details>
                          )}
                          {/* Main content */}
                          {!msg.content && !msg.reasoning ? (
                            <span className="text-ink-muted italic">Thinking...</span>
                          ) : msg.content ? (
                            <MarkdownPreview
                              content={msg.content}
                              className="chat-markdown [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs"
                            />
                          ) : null}
                          {msg.streaming && msg.content && (
                            <span className="inline-block w-1.5 h-4 ml-0.5 bg-ember-soft animate-pulse rounded-sm align-text-bottom" />
                          )}
                          {msg.sources && msg.sources.length > 0 && !msg.streaming && (
                            <div className="mt-2 pt-2 border-t border-line flex flex-wrap gap-1.5">
                              <span className="text-[10px] text-ink-muted mr-0.5 self-center">Sources:</span>
                              {msg.sources.map((src) => (
                                <a
                                  key={src.id}
                                  href={`/document/${src.id}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    navigate(`/document/${src.id}`);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-[6px] bg-ember-soft border border-ember/30 px-1.5 py-0.5 text-[10px] text-ember hover:bg-ember-soft hover:text-ember transition-colors cursor-pointer"
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
                        {/* Action buttons for assistant messages (only when not streaming) */}
                        {msg.role === 'assistant' && !msg.streaming && msg.content && (
                          <div className="flex items-center gap-0.5 px-1 mt-1">
                            <button
                              type="button"
                              onClick={() => copyMessage(i, msg.content)}
                              className="rounded-control p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink transition-colors"
                              title="Copy message"
                            >
                              {copiedId === i ? (
                                <CheckIcon className="w-3.5 h-3.5 text-sage" />
                              ) : (
                                <ClipboardIcon className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {/* Only show regenerate on the last assistant message */}
                            {i === messages.length - 1 && (
                              <button
                                type="button"
                                onClick={regenerateLastResponse}
                                className="rounded-control p-1.5 text-ink-muted hover:bg-surface-raised hover:text-ink transition-colors"
                                title="Regenerate response"
                              >
                                <ArrowPathIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
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
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-surface-raised border border-line backdrop-blur-sm px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink transition-all shadow-float"
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
          className="fixed inset-0 z-40 bg-canvas-deep/60 backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* ── Conversation history panel (right side, collapsible) ── */}
      <div
        className={`
          ${isMobile
            ? `fixed bottom-0 right-0 top-0 z-50 w-72 bg-canvas-deep shadow-float ring-1 ring-line transition-transform duration-200 ease-out ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`
            : `relative shrink-0 transition-[width,opacity] duration-200 ease-out overflow-hidden ${showSidebar ? 'w-64 opacity-100' : 'w-0 opacity-0'}`
          }
          flex flex-col ml-3
        `}
      >
        {/* Inner container — carries the visual chrome on desktop */}
        <div className={`flex flex-col h-full ${!isMobile ? 'overflow-hidden rounded-panel border border-line bg-surface' : ''}`}>
          {/* Panel header */}
          <div className="px-3 pt-3 pb-2 flex items-center gap-2">
            <button
              onClick={startNewChat}
              className="flex flex-1 items-center justify-center gap-2 rounded-control bg-ember px-3 py-2 text-sm font-medium text-on-ember transition-colors hover:bg-ember-strong"
            >
              <PlusIcon className="w-4 h-4" />
              New chat
            </button>
            <button
              onClick={() => setShowSidebar(false)}
              className="rounded-control p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
              title="Close panel"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 scrollbar-autohide">
            {conversations.length === 0 && (
              <p className="text-xs text-ink-muted text-center py-6">No conversations yet</p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`
                  group flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-sm transition-colors
                  ${conv.id === conversationId
                    ? 'bg-ember-soft font-medium text-ember'
                    : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
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
                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-control text-ink-muted hover:text-danger transition-all"
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
