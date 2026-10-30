import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { ChatComposer } from './ChatComposer';
import { ChatEmptyState } from './ChatEmptyState';
import { ChatErrorCard } from './ChatErrorCard';
import { ChatMessage } from './ChatMessage';
import { ChatModelPicker } from './ChatModelPicker';
import { toContextInput, useChatContextTarget } from '../../lib/chat/context';
import {
  cancelDelete,
  confirmDelete,
  retryLastMessage,
  sendMessage,
  setActiveConversation,
  setChatModel,
  stopStream,
  undoEdit,
  useChatStore,
} from '../../lib/chat/store';
import { chatModelOptions } from '../../lib/chat/models';
import { Spinner } from '../ui';
import { pb } from '../../lib/pocketbase';
import { deleteChatAttachment, uploadChatAttachment } from '../../lib/chat/client';
import { attachmentModelWarning, classifyChatFile } from '../../lib/chat/attachments';
import { findChatModel } from '../../lib/chat/models';
import type { PendingChatAttachment } from '../../lib/chat/types';

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
  const selectedModelId = useChatStore((snapshot) => snapshot.selectedModelId);
  const loadingConversation = useChatStore((snapshot) => snapshot.loadingConversation);
  const conversationId = useChatStore((snapshot) => snapshot.conversationId);
  const editing = useChatStore((snapshot) => snapshot.editing);

  const target = useChatContextTarget();
  const contextInput = toContextInput(target);
  const models = chatModelOptions(status);
  const selectedModel = findChatModel(status, selectedModelId);
  const attachmentLimits = status?.limits;
  const attachmentsEnabled = Boolean(attachmentLimits?.enabled);

  const [input, setInput] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [attachments, setAttachments] = useState<PendingChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentsRef = useRef<PendingChatAttachment[]>([]);
  const cancelledUploads = useRef(new Set<string>());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLElement>(null);
  const autoScroll = useRef(true);
  const messageCountRef = useRef(messages.length);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const setDraftAttachments = useCallback((next: PendingChatAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const discardDraft = useCallback((attachment: PendingChatAttachment) => {
    if (attachment.ref?.id) {
      void deleteChatAttachment(attachment.ref.id, { token: pb.authStore.token }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    for (const attachment of attachmentsRef.current) {
      cancelledUploads.current.add(attachment.localId);
      discardDraft(attachment);
    }
    setDraftAttachments([]);
    setAttachmentError(null);
  }, [conversationId, resetSignal, discardDraft, setDraftAttachments]);

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) {
      cancelledUploads.current.add(attachment.localId);
      discardDraft(attachment);
    }
  }, [discardDraft]);

  useEffect(() => {
    messageCountRef.current = messages.length;
  }, [messages.length]);

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
    // An empty thread (new conversation, loading, or an error state) has
    // nothing to scroll to. Scrolling it to the end also made the browser
    // report an off-bottom position, which surfaced the "New messages" pill.
    if (messages.length === 0) {
      autoScroll.current = true;
      setShowScrollButton(false);
      return;
    }
    if (autoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: active ? 'auto' : 'smooth' });
    }
  }, [messages, active]);

  const handleScroll = useCallback(() => {
    const element = messagesContainerRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    autoScroll.current = nearBottom;
    setShowScrollButton(messageCountRef.current > 0 && !nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    autoScroll.current = true;
    setShowScrollButton(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const readyAttachments = attachments.filter(
    (attachment): attachment is PendingChatAttachment & { ref: NonNullable<PendingChatAttachment['ref']> } =>
      attachment.status === 'ready' && Boolean(attachment.ref),
  );
  const uploadingAttachments = attachments.some((attachment) => attachment.status === 'uploading');
  const attachmentWarning = readyAttachments
    .map((attachment) => attachmentModelWarning(attachment.kind, selectedModel))
    .find((warning): warning is string => Boolean(warning)) ?? null;
  const contextUsage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.usage)?.usage ?? null;

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0 || !attachmentLimits?.enabled || active || uploadingAttachments) return;
    const incoming = Array.from(files);
    let next = [...attachmentsRef.current];
    let total = next.reduce((sum, attachment) => sum + attachment.size, 0);
    const added: PendingChatAttachment[] = [];
    let error: string | null = null;

    for (const file of incoming) {
      if (next.length >= attachmentLimits.maxFiles) {
        error = `You can attach up to ${attachmentLimits.maxFiles} files per message.`;
        break;
      }
      if (file.size <= 0) {
        error = `${file.name} is empty.`;
        continue;
      }
      if (file.size > attachmentLimits.maxFileBytes) {
        error = `${file.name} is larger than the ${Math.round(attachmentLimits.maxFileBytes / (1024 * 1024))} MB limit.`;
        continue;
      }
      const kind = classifyChatFile(file);
      if (!kind) {
        error = `${file.name} is not a supported file. Use PNG, JPEG, WebP, GIF, PDF, or text/Markdown.`;
        continue;
      }
      const warning = attachmentModelWarning(kind, selectedModel);
      if (warning) {
        error = warning;
        continue;
      }
      if (total + file.size > attachmentLimits.maxTotalBytes) {
        error = `Attachments can total up to ${Math.round(attachmentLimits.maxTotalBytes / (1024 * 1024))} MB per message.`;
        break;
      }

      const pending: PendingChatAttachment = {
        localId: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : kind === 'text' ? 'text/plain' : 'image/*'),
        kind,
        status: 'uploading',
      };
      added.push(pending);
      next.push(pending);
      total += file.size;
    }

    setAttachmentError(error);
    if (added.length === 0) return;
    setDraftAttachments(next);

    for (const pending of added) {
      void uploadChatAttachment(pending.file, { token: pb.authStore.token })
        .then(async (ref) => {
          if (cancelledUploads.current.has(pending.localId)) {
            await deleteChatAttachment(ref.id, { token: pb.authStore.token }).catch(() => undefined);
            return;
          }
          setDraftAttachments(attachmentsRef.current.map((attachment) =>
            attachment.localId === pending.localId
              ? { ...attachment, status: 'ready', ref, name: ref.name, mimeType: ref.mimeType }
              : attachment
          ));
        })
        .catch((uploadError: unknown) => {
          const message = uploadError instanceof Error ? uploadError.message : 'That file could not be uploaded.';
          setDraftAttachments(attachmentsRef.current.map((attachment) =>
            attachment.localId === pending.localId
              ? { ...attachment, status: 'error', error: message }
              : attachment
          ));
          setAttachmentError(message);
        });
    }
  }, [active, attachmentLimits, selectedModel, setDraftAttachments, uploadingAttachments]);

  const removeAttachment = useCallback((localId: string) => {
    cancelledUploads.current.add(localId);
    const attachment = attachmentsRef.current.find((entry) => entry.localId === localId);
    if (attachment) discardDraft(attachment);
    setDraftAttachments(attachmentsRef.current.filter((entry) => entry.localId !== localId));
  }, [discardDraft, setDraftAttachments]);

  const send = useCallback(() => {
    const text = input.trim();
    if ((!text && readyAttachments.length === 0) || active || uploadingAttachments || attachmentWarning) return;
    const refs = readyAttachments.map((attachment) => attachment.ref);
    setInput('');
    setDraftAttachments([]);
    setAttachmentError(null);
    autoScroll.current = true;
    setShowScrollButton(false);
    void sendMessage(text, {
      mode,
      ...(selectedModelId ? { modelId: selectedModelId } : {}),
      ...(refs.length > 0 ? { attachments: refs } : {}),
      context: contextInput,
    });
  }, [input, readyAttachments, active, uploadingAttachments, attachmentWarning, selectedModelId, mode, contextInput, setDraftAttachments]);

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
                mode={mode}
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
                    onConfirmDelete={(id) => void confirmDelete(id)}
                    onCancelDelete={(id) => void cancelDelete(id)}
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

        {showScrollButton && messages.length > 0 && (
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

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stopStream}
            mode={mode}
            streaming={active}
            stopping={stopping}
            textareaRef={inputRef}
            contextUsage={contextUsage}
            contextModel={selectedModel}
            modelControl={
              <ChatModelPicker
                models={models}
                selectedModelId={selectedModelId}
                onSelect={setChatModel}
                disabled={active}
              />
            }
            attachments={attachments}
            attachmentsEnabled={attachmentsEnabled}
            uploadingAttachments={uploadingAttachments}
            attachmentError={attachmentError}
            attachmentWarning={attachmentWarning}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
          />
        </div>
      </footer>
    </div>
  );
}
