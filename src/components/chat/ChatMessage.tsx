import { useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  DocumentTextIcon,
  FolderIcon,
  PhotoIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { MarkdownPreview } from '../MarkdownPreview';
import { NanaMark } from './NanaMark';
import { ChatSources } from './ChatSources';
import { ChatToolStrip } from './ChatToolStrip';
import { chatContextTypeLabel } from '../../lib/chat/context';
import { formatChatFileSize } from '../../lib/chat/attachments';
import type { ChatUiMessage } from '../../lib/chat/types';

interface ChatMessageProps {
  message: ChatUiMessage;
  onUndoEdit: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: (id: string) => void;
}

function userContextLabel(message: ChatUiMessage): string | null {
  if (!message.context?.title) return null;
  return `${chatContextTypeLabel(message.context.type)} · “${message.context.title}”`;
}

function UserContextIcon({ type }: { type: 'document' | 'board' | 'folder' }) {
  if (type === 'board') return <ViewColumnsIcon className="h-3 w-3" aria-hidden="true" />;
  if (type === 'folder') return <FolderIcon className="h-3 w-3" aria-hidden="true" />;
  return <DocumentTextIcon className="h-3 w-3" aria-hidden="true" />;
}

/** One turn. User copy is plain text; answers render sanitized Markdown. */
export function ChatMessage({
  message,
  onUndoEdit,
  onConfirmDelete,
  onCancelDelete,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    const context = userContextLabel(message);
    return (
      <div className="mb-7 flex flex-col items-end">
        <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">You</p>
        {context && (
          <span className="mb-1.5 inline-flex max-w-full items-center gap-1 text-[10.5px] text-ink-muted">
            {message.context && <UserContextIcon type={message.context.type} />}
            <span className="truncate">{context}</span>
          </span>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5 sm:max-w-[78%]">
            {message.attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-1 text-[11px] text-ink-secondary"
                title={`${attachment.name} · ${formatChatFileSize(attachment.size)}`}
              >
                {attachment.kind === 'image' ? (
                  <PhotoIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                ) : (
                  <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                )}
                <span className="max-w-[12rem] truncate">{attachment.name}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {formatChatFileSize(attachment.size)}
                </span>
              </span>
            ))}
          </div>
        )}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] rounded-br-[3px] bg-surface-raised px-4 py-3 text-[14px] leading-[1.6] text-ink sm:max-w-[78%]">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const toolCount = message.tools?.length ?? 0;
  const editCount = message.edits?.length ?? 0;
  const hasReasoning = Boolean(message.reasoning);
  const editing = message.edits?.some((edit) => edit.status === 'applying') ?? false;
  const hasContent = Boolean(message.content.trim());
  const showThinking = message.streaming
    && !hasContent
    && !hasReasoning
    && toolCount === 0
    && editCount === 0;

  const copy = () => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="mb-9 w-full min-w-0">
      <div className="mb-2.5 flex items-center gap-2">
        <NanaMark size={28} />
        <span className="text-[11.5px] font-medium text-ink-secondary">Nana</span>
        {editing && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-signal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
            Editing…
          </span>
        )}
      </div>

      {(toolCount > 0 || editCount > 0) && (
        <ChatToolStrip
          tools={message.tools ?? []}
          edits={message.edits ?? []}
          streaming={message.streaming}
          onUndoEdit={onUndoEdit}
          onConfirmDelete={onConfirmDelete}
          onCancelDelete={onCancelDelete}
        />
      )}

      {hasReasoning && (
        <details
          className="group mb-3"
          open={message.streaming && !hasContent}
        >
          <summary className="flex h-7 cursor-pointer select-none items-center gap-1.5 text-[11.5px] font-medium text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden [&::marker]:hidden">
            <ChevronDownIcon
              className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
            <span>{message.streaming && !hasContent ? 'Thinking…' : 'Reasoning'}</span>
          </summary>
          {message.reasoning && (
            <div className="mt-1 max-h-80 overflow-y-auto border-l border-line pl-3 text-[13px] leading-relaxed text-ink-muted scrollbar-autohide">
              <MarkdownPreview
                content={message.reasoning}
                className="chat-markdown !text-[13px] !leading-relaxed text-ink-muted [&_p]:my-1 [&_pre]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_code]:text-[11.5px]"
              />
            </div>
          )}
        </details>
      )}

      {hasContent ? (
        <div className="chat-answer break-words text-[14.5px] leading-[1.75] text-ink">
          <MarkdownPreview
            content={message.content}
            className="chat-markdown !text-[14.5px] !leading-[1.75] [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs"
          />
          {message.streaming && (
            <span
              className="ml-0.5 inline-block h-4 w-px animate-pulse bg-signal align-text-bottom"
              aria-hidden="true"
            />
          )}
          {message.stopped && (
            <span className="ml-2 align-middle text-[11px] font-medium text-ink-muted">Stopped</span>
          )}
        </div>
      ) : showThinking ? (
        <p className="inline-flex items-center gap-2 text-[11.5px] font-medium text-ink-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
          Thinking…
        </p>
      ) : message.stopped ? (
        <p className="text-[12px] font-medium text-ink-muted">Stopped.</p>
      ) : null}

      {!message.streaming && (hasContent || message.edits?.length || toolCount > 0) && (
        <ChatSources sources={message.sources} />
      )}

      {!message.streaming && hasContent && (
        <div className="mt-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={copy}
            className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            ) : (
              <ClipboardIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
