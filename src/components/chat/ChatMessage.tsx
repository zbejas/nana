import { useState, type ReactNode } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  DocumentTextIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { MarkdownPreview } from '../MarkdownPreview';
import { NanaMark } from './NanaMark';
import { ChatSources } from './ChatSources';
import { ChatToolStrip } from './ChatToolStrip';
import { ChatEditCard } from './ChatEditCard';
import { formatChatFileSize } from '../../lib/chat/attachments';
import type { ChatUiMessage, ChatUiPart, ChatUiTool } from '../../lib/chat/types';

interface ChatMessageProps {
  message: ChatUiMessage;
  /** Shared note chats label each user message by author. */
  groupChat?: boolean;
  currentUserId?: string | null;
  /** False when a shared-chat grantee cannot undo or confirm edits. */
  canManage?: boolean;
  onUndoEdit: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: (id: string) => void;
}

function legacyParts(message: ChatUiMessage): ChatUiPart[] {
  const parts: ChatUiPart[] = [];
  if (message.reasoning) parts.push({ type: 'reasoning', text: message.reasoning });
  if (message.content) parts.push({ type: 'text', text: message.content });
  for (const tool of message.tools ?? []) {
    parts.push({ type: 'tool', ...tool });
  }
  return parts;
}

function senderLabel(
  message: ChatUiMessage,
  groupChat: boolean,
  currentUserId: string | null,
): string {
  if (!groupChat) return 'You';
  if (!message.authorId) {
    // Optimistic local messages have no author id yet; older rows may only
    // carry a label.
    return message.authorLabel?.trim() || 'You';
  }
  if (currentUserId && message.authorId === currentUserId) return 'You';
  return message.authorLabel?.trim() || 'Someone';
}

function reasoningBlock(text: string, open: boolean, key: string): ReactNode {
  return (
    <details key={key} className="group mb-3" open={open}>
      <summary className="flex h-7 cursor-pointer select-none items-center gap-1.5 text-[11.5px] font-medium text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden [&::marker]:hidden">
        <ChevronDownIcon
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        <span>{open ? 'Thinking…' : 'Reasoning'}</span>
      </summary>
      <div className="mt-1 max-h-80 overflow-y-auto border-l border-line pl-3 text-[13px] leading-relaxed text-ink-muted scrollbar-autohide">
        <MarkdownPreview
          content={text}
          className="chat-markdown !text-[13px] !leading-relaxed text-ink-muted [&_p]:my-1 [&_pre]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_code]:text-[11.5px]"
        />
      </div>
    </details>
  );
}

/** One turn. User copy is plain text; answers render sanitized Markdown. */
export function ChatMessage({
  message,
  groupChat = false,
  currentUserId = null,
  canManage = true,
  onUndoEdit,
  onConfirmDelete,
  onCancelDelete,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="mb-7 flex flex-col items-end">
        <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">
          {senderLabel(message, groupChat, currentUserId)}
        </p>
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

  const parts = message.parts?.length ? [...message.parts] : legacyParts(message);
  if (message.reasoning && !parts.some((part) => part.type === 'reasoning')) {
    parts.unshift({ type: 'reasoning', text: message.reasoning });
  }
  if (!parts.some((part) => part.type === 'text') && message.content) {
    parts.push({ type: 'text', text: message.content });
  }

  const editsById = new Map((message.edits ?? []).map((edit) => [edit.id, edit]));
  const textCount = parts.filter((part) => part.type === 'text' && part.text.trim()).length;
  const toolCount = parts.filter((part) => part.type === 'tool').length;
  const editCount = message.edits?.length ?? 0;
  const hasContent = textCount > 0;
  const hasReasoning = parts.some((part) => part.type === 'reasoning');
  const hasRunningTool = parts.some(
    (part) => part.type === 'tool' && part.status === 'running',
  );
  const hasCompletedTools = parts.some(
    (part) => part.type === 'tool' && part.status !== 'running',
  );
  const editing = message.edits?.some((edit) => edit.status === 'applying') ?? false;
  // A finished tool call with no text yet means the model is composing the
  // next step. Never show "Thinking…" alongside the running tool timer.
  const showThinking = message.streaming
    && !hasContent
    && !hasReasoning
    && !hasRunningTool
    && editCount === 0;
  const thinkingLabel = hasCompletedTools ? 'Waiting for model…' : 'Thinking…';

  const copy = () => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const displayedEdits = new Set<string>();
  const blocks: ReactNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;

    if (part.type === 'reasoning') {
      blocks.push(reasoningBlock(
        part.text,
        Boolean(message.streaming) && !hasContent && !hasRunningTool,
        `reasoning:${index}`,
      ));
      continue;
    }

    if (part.type === 'text') {
      if (!part.text.trim()) continue;
      blocks.push(
        <div key={`text:${index}`} className="chat-answer break-words text-[14.5px] leading-[1.75] text-ink">
          <MarkdownPreview
            content={part.text}
            className="chat-markdown !text-[14.5px] !leading-[1.75] [&_p]:my-1 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs"
          />
          {message.streaming && index === parts.length - 1 && (
            <span
              className="ml-0.5 inline-block h-4 w-px animate-pulse bg-signal align-text-bottom"
              aria-hidden="true"
            />
          )}
        </div>,
      );
      continue;
    }

    if (part.type === 'tool') {
      const tools: ChatUiTool[] = [];
      while (index < parts.length) {
        const toolPart = parts[index];
        if (toolPart?.type !== 'tool') break;
        tools.push({
          id: toolPart.id,
          name: toolPart.name,
          status: toolPart.status,
          ...(toolPart.title ? { title: toolPart.title } : {}),
          ...(toolPart.targetType ? { targetType: toolPart.targetType } : {}),
          ...(toolPart.targetId ? { targetId: toolPart.targetId } : {}),
          ...(toolPart.error ? { error: toolPart.error } : {}),
        });
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ChatToolStrip
          key={`tools:${index}`}
          tools={tools}
          streaming={message.streaming}
          canManage={canManage}
        />,
      );
      continue;
    }

    const edit = editsById.get(part.editId);
    if (!edit) continue;
    displayedEdits.add(edit.id);
    blocks.push(
      <div key={`edit:${part.editId}`} className="mb-1.5">
        <ChatEditCard
          edit={edit}
          canManage={canManage}
          onUndo={onUndoEdit}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      </div>,
    );
  }

  for (const edit of message.edits ?? []) {
    if (displayedEdits.has(edit.id)) continue;
    blocks.push(
      <div key={`edit:${edit.id}`} className="mb-1.5">
        <ChatEditCard
          edit={edit}
          canManage={canManage}
          onUndo={onUndoEdit}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      </div>,
    );
  }

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

      {blocks}

      {showThinking ? (
        <p className="inline-flex items-center gap-2 text-[11.5px] font-medium text-ink-muted" role="status">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" aria-hidden="true" />
          {thinkingLabel}
        </p>
      ) : message.stopped ? (
        <p className="text-[12px] font-medium text-ink-muted">Stopped.</p>
      ) : null}

      {!message.streaming && (hasContent || editCount > 0 || toolCount > 0) && (
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
