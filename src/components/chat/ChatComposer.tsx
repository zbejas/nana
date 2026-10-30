import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { PaperClipIcon, PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { ChatContextChip } from './ChatContextChip';
import { ChatAttachmentTray } from './ChatAttachmentTray';
import { CHAT_ATTACHMENT_ACCEPT } from '../../lib/chat/attachments';
import type { ChatContextTarget } from '../../lib/chat/context';
import type { ChatMode, PendingChatAttachment } from '../../lib/chat/types';

export const CHAT_MESSAGE_LIMIT = 12_000;
const WARN_AT = CHAT_MESSAGE_LIMIT - 1_500;

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode: ChatMode;
  streaming: boolean;
  stopping: boolean;
  target: ChatContextTarget | null;
  contextDismissed: boolean;
  onRemoveContext: () => void;
  onRestoreContext: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Model selector or other compact control in the composer toolbar. */
  modelControl?: ReactNode;
  attachments?: PendingChatAttachment[];
  attachmentsEnabled?: boolean;
  uploadingAttachments?: boolean;
  attachmentError?: string | null;
  attachmentWarning?: string | null;
  onAddFiles?: (files: FileList | null) => void;
  onRemoveAttachment?: (localId: string) => void;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  mode,
  streaming,
  stopping,
  target,
  contextDismissed,
  onRemoveContext,
  onRestoreContext,
  textareaRef,
  modelControl,
  attachments = [],
  attachmentsEnabled = false,
  uploadingAttachments = false,
  attachmentError = null,
  attachmentWarning = null,
  onAddFiles,
  onRemoveAttachment,
}: ChatComposerProps) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = textareaRef ?? localRef;
  const id = useId();
  const tooLong = value.length > CHAT_MESSAGE_LIMIT;
  const nearLimit = value.length >= WARN_AT;
  const hasReadyAttachments = attachments.some(
    (attachment) => attachment.status === 'ready' && attachment.ref,
  );
  const canSend = (value.trim().length > 0 || hasReadyAttachments)
    && !tooLong
    && !streaming
    && !uploadingAttachments
    && !attachmentWarning;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value, ref]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <div className="w-full">
      <div className="rounded-panel border border-line bg-surface p-1.5 transition-colors focus-within:border-signal/50 focus-within:ring-4 focus-within:ring-signal/10">
        {target && !contextDismissed && (
          <div className="px-2 pb-1 pt-1.5">
            <ChatContextChip target={target} onRemove={onRemoveContext} />
          </div>
        )}

        {attachmentsEnabled && (
          <ChatAttachmentTray
            attachments={attachments}
            error={attachmentError}
            warning={attachmentWarning}
            onRemove={(localId) => onRemoveAttachment?.(localId)}
          />
        )}

        <label htmlFor={id} className="sr-only">
          Message Nana
        </label>
        <textarea
          id={id}
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'edit' ? 'Ask anything, or tell Nana what to change…' : 'Ask about your notes…'}
          rows={1}
          className="max-h-48 w-full resize-none overflow-y-auto scrollbar-autohide bg-transparent px-3 pb-1 pt-2.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
          style={{ minHeight: '2.75rem' }}
        />

        <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {target && contextDismissed && (
              <button
                type="button"
                onClick={onRestoreContext}
                className="text-[11px] font-medium text-ink-muted transition-colors hover:text-ink-secondary"
              >
                Attach page
              </button>
            )}
            {attachmentsEnabled && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  className="sr-only"
                  onChange={(event) => {
                    onAddFiles?.(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={streaming || uploadingAttachments}
                  aria-label="Attach files"
                  title="Attach files"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
                >
                  <PaperClipIcon className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
                </button>
              </>
            )}
            {modelControl}
            {nearLimit ? (
              <span
                className={`select-none text-[11px] tabular-nums ${tooLong ? 'text-danger' : 'text-warning'}`}
                aria-live="polite"
              >
                {value.length.toLocaleString()} / {CHAT_MESSAGE_LIMIT.toLocaleString()} characters
              </span>
            ) : (
              <span className="hidden select-none text-[11.5px] text-ink-muted sm:block">
                Enter to send · Shift+Enter for a new line
              </span>
            )}
          </div>

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              aria-label="Stop response"
              title="Stop response"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface-raised text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
            >
              <StopIcon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send message"
              title="Send message"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-signal-bright text-on-signal transition-colors hover:bg-signal-bright-strong disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
            >
              <PaperAirplaneIcon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
