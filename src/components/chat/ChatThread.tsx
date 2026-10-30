import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { ChatComposer } from './ChatComposer';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatErrorCard } from './ChatErrorCard';
import { ChatMessage } from './ChatMessage';
import {
  dismissChatContext,
  restoreChatContext,
  toContextInput,
  useChatContextDismissed,
  useChatContextTarget,
} from '../../lib/chat/context';
import {
  retryLastMessage,
  sendMessage,
  setActiveConversation,
  stopStream,
  undoEdit,
  useChatStore,
} from '../../lib/chat/store';
import { Spinner } from '../ui';

interface ChatThreadProps {
  variant: 'dock' | 'page';
  onOpenSettings: () => void;
  /** Increment to focus the composer (dock open, prompt card). */
  focusSignal?: number;
  /** Increment to clear the local draft when the conversation changes. */
  resetSignal?: number;
  autoFocus?: boolean;
}

export function ChatThread({
  variant,
  onOpenSettings,
  focusSignal = 0,
  resetSignal = 0,
  autoFocus = false,
}: ChatThreadProps) {
  const messages = useChatStore((snapshot) => snapshot.messages);
  const active = useChatStore((snapshot) => snapshot.active);
  const stopping = useChatStore((snapshot) => snapshot.stopping);
  const error = useChatStore((snapshot) => snapshot.error);
  const mode = useChatStore((snapshot) => snapshot.mode);
  const status = useChatStore((snapshot) => snapshot.status);
  const loadingConversation = useChatStore((snapshot) => snapshot.loadingConversation);
  const conversationId = useChatStore((snapshot) => snapshot.conversationId);
  const editing = useChatStore((snapshot) => snapshot.editing);

  const target = useChatContextTarget();
  const dismissed = useChatContextDismissed(target);
  const contextInput = toContextInput(target, dismissed);

  const [input, setInput] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLElement>(null);
  const autoScroll = useRef(true);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (focusSignal > 0) focusComposer();
  }, [focusSignal, focusComposer]);

  useEffect(() => {
    if (resetSignal > 0) setInput('');
  }, [resetSignal]);

  useEffect(() => {
    if (!autoFocus || isMobile) return;
    focusComposer();
  }, [autoFocus, focusComposer, isMobile]);

  useEffect(() => {
    if (autoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: active ? 'auto' : 'smooth' });
    }
  }, [messages, active]);

  const handleScroll = useCallback(() => {
    const element = messagesContainerRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    autoScroll.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    autoScroll.current = true;
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || active) return;
    setInput('');
    autoScroll.current = true;
    setShowScrollButton(false);
    void sendMessage(text, {
      mode,
      context: contextInput,
      contextTitle: target?.title,
    });
  }, [input, active, mode, contextInput, target?.title]);

  const prompt = useCallback((value: string) => {
    setInput(value);
    focusComposer();
  }, [focusComposer]);

  const retry = useCallback(() => {
    if (messages.length === 0 && error) {
      setActiveConversation(conversationId);
      return;
    }
    retryLastMessage(contextInput);
  }, [messages.length, error, conversationId, contextInput]);

  const loadError = Boolean(error && messages.length === 0);
  const isEmpty = messages.length === 0 && !loadingConversation && !loadError;
  const widthClass = variant === 'page' ? 'mx-auto w-full max-w-[800px]' : 'w-full';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <main
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className={`absolute inset-0 overflow-y-auto scrollbar-autohide px-3 py-3 sm:px-4 ${
            variant === 'page' ? 'sm:px-2' : ''
          }`}
        >
          <div className={`${widthClass} ${loadingConversation || isEmpty || loadError ? 'flex min-h-full flex-col justify-center' : ''}`}>
            {loadingConversation ? (
              <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-ink-muted">
                <Spinner label="Opening conversation" />
                <p className="text-[12.5px]">Opening conversation…</p>
              </div>
            ) : loadError && error ? (
              <div className="mx-auto my-6 max-w-[32rem]">
                <ChatErrorCard error={error} onRetry={retry} onOpenSettings={onOpenSettings} />
              </div>
            ) : isEmpty ? (
              <ChatEmptyState
                target={target}
                configured={status?.configured ?? null}
                onPrompt={prompt}
                onOpenSettings={onOpenSettings}
              />
            ) : (
              <>
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id ?? `${message.role}:${index}`}
                    message={message}
                    onUndoEdit={(id) => void undoEdit(id)}
                  />
                ))}
                {error && (
                  <div className="mb-8">
                    <ChatErrorCard error={error} onRetry={retry} onOpenSettings={onOpenSettings} />
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

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

      <footer
        className={`shrink-0 border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4 ${
          variant === 'page' ? 'pb-3 sm:pb-4' : ''
        }`}
      >
        <div className={widthClass}>
          {editing && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-signal">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
              Nana is editing…
              {editing.title && (
                <span className="max-w-[16rem] truncate font-normal text-ink-muted">“{editing.title}”</span>
              )}
            </p>
          )}

          {target?.isPrivate && !dismissed && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-warning">
              <LockClosedIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Private page — context stays off.
            </p>
          )}

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stopStream}
            mode={mode}
            streaming={active}
            stopping={stopping}
            target={target}
            contextDismissed={dismissed}
            onRemoveContext={() => dismissChatContext(target)}
            onRestoreContext={() => restoreChatContext(target)}
            textareaRef={inputRef}
          />
        </div>
      </footer>
    </div>
  );
}
