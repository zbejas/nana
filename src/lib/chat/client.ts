import {
  sanitizeAttachmentRef,
  sanitizeChatUsage,
  type ChatAttachmentRef,
  type ChatUsage,
} from '../../api/chat/types';
import type {
  ChatEditChanges,
  ChatEditSection,
  ChatEditTarget,
  ChatMode,
  ChatSource,
  ChatStatusResponse,
} from '../../api/chat/types';
import type {
  AIChatAttachmentSettings,
  AIChatModelOption,
  AIProviderKind,
} from '../ai/types';
import { cleanChatTitle } from '../ai/title';
import type {
  ChatConversation,
  ChatError,
  ChatUiEdit,
  ChatUiMessage,
  ChatUiTool,
} from './types';

const CHAT_BASE = '/api/chat';

export class ChatApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ChatAuth {
  token: string;
}

export interface SendChatInput {
  conversationId?: string;
  message: string;
  mode: ChatMode;
  modelId?: string;
  attachmentIds?: string[];
  context?: { type: 'document' | 'board' | 'folder'; id: string };
  regenerate?: boolean;
  signal?: AbortSignal;
  auth: ChatAuth;
}

export interface SendChatHandlers {
  onConversation?: (meta: {
    conversationId: string;
    isNew: boolean;
    model?: string;
  }) => void;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onTool?: (tool: ChatUiTool) => void;
  onSources?: (sources: ChatSource[]) => void;
  onEdit?: (edit: ChatUiEdit) => void;
  onDone?: (meta: {
    conversationId?: string;
    messageId?: string;
    stopped?: boolean;
    model?: string;
    usage?: ChatUsage;
  }) => void;
  onError?: (error: ChatError) => void;
}

function authHeaders(auth: ChatAuth): Record<string, string> {
  return auth.token ? { Authorization: auth.token } : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function errorFromResponse(status: number, data: unknown): ChatApiError {
  const record = asRecord(data);
  const message = stringValue(record.error, record.message, record.errorText)
    || (status === 401 ? 'Your session expired. Sign in again.' : 'Chat request failed.');
  const code = stringValue(record.code, record.errorCode) || undefined;
  return new ChatApiError(message, status, code);
}

function normalizeConversation(value: unknown): ChatConversation | null {
  const record = asRecord(value);
  const id = stringValue(record.id);
  if (!id) return null;
  return {
    id,
    title: cleanChatTitle(stringValue(record.title, record.name) || 'Untitled chat', 'Untitled chat'),
    created: stringValue(record.created),
    updated: stringValue(record.updated, record.created),
    pending_edits: numberValue(record.pending_edits, record.pendingEdits),
  };
}

function normalizeSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      const key = `document:${item}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ type: 'document', id: '', title: item.trim() });
      continue;
    }
    const record = asRecord(item);
    const rawType = stringValue(record.type, record.targetType);
    const type = rawType === 'board' ? 'board' : 'document';
    const id = stringValue(record.id, record.documentId, record.noteId, record.boardId, record.targetId);
    const title = stringValue(record.title, record.name, record.label, record.heading);
    if (!title) continue;
    const key = `${type}:${id || title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ type, id, title });
  }
  return sources.slice(0, 12);
}

function normalizeSection(value: unknown, index: number): ChatEditSection | null {
  const record = asRecord(value);
  const heading = stringValue(record.heading, record.title, typeof value === 'string' ? value : '');
  const path = Array.isArray(record.path)
    ? record.path.filter((part): part is string => typeof part === 'string')
    : [];
  if (!heading && path.length === 0) return null;
  return {
    heading: heading || path[path.length - 1] || null,
    path,
    op: stringValue(record.op, record.operation) || 'replace_section',
    from: numberValue(record.from) ?? index,
    to: numberValue(record.to) ?? index,
  };
}

function normalizeChanges(value: unknown): ChatEditChanges {
  const record = asRecord(value);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  const sections = rawSections
    .map((section, index) => normalizeSection(section, index))
    .filter((section): section is ChatEditSection => Boolean(section));
  const fields = Array.isArray(record.fields)
    ? record.fields
      .map((field) => {
        if (typeof field === 'string') return field;
        return stringValue(asRecord(field).label, asRecord(field).name, asRecord(field).field);
      })
      .filter(Boolean)
    : [];
  return {
    ...(sections.length ? { sections } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

function normalizeEditStatus(value: unknown): ChatUiEdit['status'] {
  const status = stringValue(value, 'applied');
  if (status === 'applying') return 'applying';
  if (status === 'pending' || status === 'cancelled') return status;
  if (status === 'applied' || status === 'undone' || status === 'failed' || status === 'conflict') {
    return status;
  }
  return 'applied';
}

/** Normalize a live or persisted edit event into the card shape. */
export function normalizeEdit(value: unknown): ChatUiEdit | null {
  const record = asRecord(value);
  const id = stringValue(record.id, record.editId);
  if (!id) return null;

  const rawTarget = asRecord(record.target);
  const targetType = stringValue(rawTarget.type, record.targetType, record.target_type) || 'document';
  const targetId = stringValue(rawTarget.id, record.targetId, record.target_id);
  const targetTitle = stringValue(rawTarget.title, record.targetTitle, record.target_title, record.title);
  const targetUrl = stringValue(rawTarget.url, record.url)
    || (targetType === 'document' && targetId
      ? `/document/${encodeURIComponent(targetId)}`
      : targetType === 'folder' && targetId
        ? `/folders/${encodeURIComponent(targetId)}`
        : targetType === 'board' && targetId
          ? `/board/${encodeURIComponent(targetId)}`
          : '');

  if (!targetId) return null;

  const target: ChatEditTarget = {
    type: targetType === 'board'
      ? 'board'
      : targetType === 'task'
        ? 'task'
        : targetType === 'folder'
          ? 'folder'
          : 'document',
    id: targetId,
    title: targetTitle || (targetType === 'board' ? 'Board' : targetType === 'folder' ? 'Folder' : 'Note'),
    url: targetUrl,
  };

  const rawUndo = asRecord(record.undo);
  const status = normalizeEditStatus(record.status);
  const created = stringValue(record.created, record.createdAt);
  const updated = stringValue(record.updated, record.updatedAt, created);

  return {
    id,
    conversationId: stringValue(record.conversationId, record.conversation),
    messageId: stringValue(record.messageId, record.message) || null,
    target,
    tool: stringValue(record.tool) || 'edit_note',
    summary: stringValue(record.summary) || 'Nana updated this.',
    status,
    actorType: 'ai',
    actorLabel: stringValue(record.actorLabel, record.actor_label) || 'Nana',
    changed: normalizeChanges(record.changed ?? {
      sections: record.sections,
      fields: record.fields,
    }),
    undo: {
      kind: rawUndo.kind === 'trash' || rawUndo.kind === 'restore' ? rawUndo.kind : 'none',
      available: rawUndo.available !== false && status === 'applied',
    },
    created,
    updated,
  };
}

function normalizeTool(raw: Record<string, unknown>, fallbackName?: string): ChatUiTool | null {
  const type = stringValue(raw.type, raw.event, fallbackName);
  const name = stringValue(raw.name, raw.toolName, raw.tool);
  const id = stringValue(raw.id, raw.toolCallId, raw.tool_call_id);
  const input = asRecord(raw.input ?? raw.args);

  let normalizedName = name;
  if (!normalizedName && type === 'tool-input-start') normalizedName = fallbackName ?? '';
  // Result frames in the AI SDK stream carry only the call id. Keep the frame
  // so the store can merge its status into the tool it already knows.
  if (!normalizedName && !id) return null;

  let status: ChatUiTool['status'] = 'running';
  const targetTypeValue = stringValue(raw.targetType, input.targetType);
  const targetIdValue = stringValue(
    raw.targetId,
    input.noteId,
    input.documentId,
    input.boardId,
    input.taskId,
  );
  let title = stringValue(
    raw.title,
    raw.targetTitle,
    input.title,
    input.noteTitle,
    input.boardTitle,
    input.name,
  );

  if (type === 'tool-output-available' || type === 'tool-output-error' || type === 'tool-output-denied') {
    const output = asRecord(raw.output ?? raw.result);
    const failed = type !== 'tool-output-available'
      || raw.isError === true
      || output.ok === false
      || output.error !== undefined;
    status = failed ? 'error' : 'success';
    title = title || stringValue(output.title, output.name);
  } else if (type === 'tool') {
    const phase = stringValue(raw.phase, raw.status);
    if (phase === 'result' || phase === 'finish' || phase === 'done' || phase === 'success' || phase === 'error' || phase === 'failed') {
      status = phase === 'error' || phase === 'failed' ? 'error' : 'success';
    } else if (phase === 'running' || phase === 'start' || phase === 'started') {
      status = 'running';
    }
  } else if (type === 'tool-input-error') {
    status = 'error';
  }

  return {
    id: id || undefined,
    name: normalizedName,
    status,
    ...(title ? { title } : {}),
    ...(targetTypeValue === 'document' || targetTypeValue === 'board'
      ? { targetType: targetTypeValue as 'document' | 'board' }
      : input.noteId
        ? { targetType: 'document' as const }
        : input.boardId || input.taskId
          ? { targetType: 'board' as const }
          : {}),
    ...(targetIdValue ? { targetId: targetIdValue } : {}),
  };
}

function normalizeStreamError(raw: unknown): ChatError {
  if (typeof raw === 'string') {
    return { message: raw || 'Nana could not finish that answer.' };
  }
  const record = asRecord(raw);
  return {
    message: stringValue(record.message, record.errorText, record.error)
      || 'Nana could not finish that answer.',
    code: stringValue(record.code, record.errorCode) || undefined,
    status: numberValue(record.status),
  };
}

/**
 * Dispatch one parsed SSE payload. The tolerant shape handling is deliberate:
 * the current server uses the AI SDK UI message stream (`text-delta`,
 * `tool-input-*`), while the agent branch adds named `text`/`tool`/`sources`/
 * `edit`/`done` events. Unknown events are ignored.
 */
function dispatchStreamEvent(
  raw: unknown,
  eventName: string | undefined,
  handlers: SendChatHandlers,
): void {
  if (raw === '[DONE]' || raw === null || raw === undefined) return;
  const record = asRecord(raw);
  const type = stringValue(record.type, record.event, eventName);

  if (type === 'text' || type === 'text-delta' || type === 'text_delta' || type === 'delta' || type === 'content') {
    const delta = stringValue(record.delta, record.text, record.content, record.value)
      || (typeof raw === 'string' ? raw : '');
    if (delta) handlers.onText?.(delta);
    return;
  }

  if (type === 'reasoning' || type === 'reasoning-delta' || type === 'reasoning_delta') {
    const delta = stringValue(record.delta, record.text, record.reasoning, record.value)
      || (typeof raw === 'string' ? raw : '');
    if (delta) handlers.onReasoning?.(delta);
    return;
  }

  if (
    type === 'tool'
    || type === 'tool-call'
    || type === 'tool-input-start'
    || type === 'tool-input-available'
    || type === 'tool-input-error'
    || type === 'tool-output-available'
    || type === 'tool-output-error'
    || type === 'tool-output-denied'
    || type === 'tool-result'
  ) {
    const tool = normalizeTool(record, type === 'tool-call' ? stringValue(record.toolName) : undefined);
    if (tool) handlers.onTool?.(tool);
    return;
  }

  if (type === 'sources' || type === 'source') {
    const value = record.sources ?? record.source ?? raw;
    const sources = normalizeSources(value);
    if (sources.length) handlers.onSources?.(sources);
    return;
  }

  if (type === 'edit' || type === 'edit-update' || type === 'edit_update' || type === 'edit-started' || type === 'edit-applied') {
    const edit = normalizeEdit(record.edit ?? record);
    if (edit) handlers.onEdit?.(edit);
    return;
  }

  if (type === 'done' || type === 'finish' || type === 'message-finish' || type === 'end') {
    // Some streams batch the final sources/edits into the done frame.
    if (Array.isArray(record.sources)) {
      const sources = normalizeSources(record.sources);
      if (sources.length) handlers.onSources?.(sources);
    }
    if (Array.isArray(record.edits)) {
      for (const value of record.edits) {
        const edit = normalizeEdit(value);
        if (edit) handlers.onEdit?.(edit);
      }
    }
    const usage = sanitizeChatUsage(record.usage);
    handlers.onDone?.({
      conversationId: stringValue(record.conversationId, record.conversation) || undefined,
      messageId: stringValue(record.messageId, record.message) || undefined,
      stopped: record.stopped === true,
      model: stringValue(record.model, record.modelName) || undefined,
      ...(usage ? { usage } : {}),
    });
    return;
  }

  if (type === 'error' || type === 'message-error' || type === 'stream-error') {
    handlers.onError?.(normalizeStreamError(record.error ?? raw));
  }
}

/**
 * POST /api/chat/send and read the SSE response. Resolves after the stream
 * closes. Aborting the input signal rejects with an AbortError.
 */
export async function streamChat(input: SendChatInput, handlers: SendChatHandlers): Promise<void> {
  const response = await fetch(`${CHAT_BASE}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(input.auth),
    },
    body: JSON.stringify({
      conversationId: input.conversationId || undefined,
      message: input.message,
      mode: input.mode,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.regenerate ? { regenerate: true } : {}),
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Keep the status-based message.
    }
    throw errorFromResponse(response.status, data);
  }

  const conversationId = response.headers.get('X-Conversation-Id') || '';
  const isNew = response.headers.get('X-Is-New-Conversation') === 'true';
  const model = response.headers.get('X-Model-Name') || undefined;
  if (conversationId) {
    handlers.onConversation?.({ conversationId, isNew, model });
  } else if (model) {
    handlers.onConversation?.({ conversationId: input.conversationId || '', isNew: false, model });
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ChatApiError('Nana returned an empty stream.', 0);

  const decoder = new TextDecoder();
  let buffer = '';

  const consumeBlock = (block: string) => {
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim() || undefined;
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (!payload.trim()) return;
    if (payload.trim() === '[DONE]') {
      handlers.onDone?.({});
      return;
    }
    try {
      dispatchStreamEvent(JSON.parse(payload), eventName, handlers);
    } catch {
      // Tolerate non-JSON keep-alives and unknown frames.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consumeBlock(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isProviderKind(value: string): value is AIProviderKind {
  return value === 'openai' || value === 'google' || value === 'anthropic' || value === 'ollama';
}

function normalizeStatusModel(value: unknown): AIChatModelOption | null {
  const record = asRecord(value);
  const id = stringValue(record.id);
  const model = stringValue(record.model, record.modelId);
  if (!id || !model) return null;
  const rawKind = stringValue(record.providerKind, record.kind);
  return {
    id,
    label: stringValue(record.label, record.name) || model,
    model,
    provider: stringValue(record.provider, record.providerName) || 'AI',
    providerKind: isProviderKind(rawKind) ? rawKind : 'openai',
    local: record.local === true,
    contextWindow: numberValue(record.contextWindow) ?? null,
    maxOutputTokens: numberValue(record.maxOutputTokens) ?? null,
    vision: record.vision === true,
    files: record.files === true,
    tools: record.tools !== false,
    reasoning: record.reasoning === true,
  };
}

function normalizeStatusLimits(value: unknown): AIChatAttachmentSettings | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;
  return {
    enabled: record.enabled === true,
    maxFiles: numberValue(record.maxFiles) ?? 5,
    maxFileBytes: numberValue(record.maxFileBytes) ?? 10 * 1024 * 1024,
    maxTotalBytes: numberValue(record.maxTotalBytes) ?? 25 * 1024 * 1024,
    maxTextChars: numberValue(record.maxTextChars) ?? 100_000,
  };
}

export async function getChatStatus(auth: ChatAuth): Promise<ChatStatusResponse> {
  const response = await fetch(`${CHAT_BASE}/status`, { headers: authHeaders(auth) });
  if (response.status === 404) {
    throw new ChatApiError('Chat status is unavailable.', 404, 'not_found');
  }
  const data = await readJson(response);
  if (!response.ok) {
    if (response.status === 503) {
      return { configured: false, model: null, provider: null, local: false };
    }
    throw errorFromResponse(response.status, data);
  }
  const record = asRecord(data);
  const models = Array.isArray(record.models)
    ? record.models
      .map(normalizeStatusModel)
      .filter((model): model is AIChatModelOption => Boolean(model))
    : [];
  const defaultModelId = stringValue(record.defaultModelId) || null;
  const limits = normalizeStatusLimits(record.limits);
  return {
    configured: record.configured !== false && record.ready !== false,
    model: stringValue(record.model, record.modelName, record.activeModel) || null,
    provider: stringValue(record.provider, record.providerName) || null,
    local: record.local === true,
    defaultModelId,
    ...(models.length ? { models } : {}),
    ...(limits ? { limits } : {}),
  };
}

/** Upload one draft attachment; the server classifies and extracts it. */
export async function uploadChatAttachment(
  file: File,
  auth: ChatAuth,
): Promise<ChatAttachmentRef> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${CHAT_BASE}/attachments`, {
    method: 'POST',
    headers: authHeaders(auth),
    body: form,
  });
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  const record = asRecord(data);
  const attachment = sanitizeAttachmentRef(record.attachment ?? data);
  if (!attachment) throw new ChatApiError('The uploaded attachment was not readable.', 502);
  return attachment;
}

/** Delete a draft that has not been bound to a message. */
export async function deleteChatAttachment(id: string, auth: ChatAuth): Promise<void> {
  const response = await fetch(`${CHAT_BASE}/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(auth),
  });
  if (!response.ok && response.status !== 404) {
    const data = await readJson(response);
    throw errorFromResponse(response.status, data);
  }
}

export async function listConversations(auth: ChatAuth): Promise<ChatConversation[]> {
  const response = await fetch(`${CHAT_BASE}/conversations`, { headers: authHeaders(auth) });
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  const list = Array.isArray(data) ? data : asRecord(data).items;
  if (!Array.isArray(list)) return [];
  return list
    .map(normalizeConversation)
    .filter((conversation): conversation is ChatConversation => Boolean(conversation));
}

export interface LoadedConversation {
  conversation: ChatConversation;
  messages: ChatUiMessage[];
  edits: ChatUiEdit[];
}

export async function loadConversation(auth: ChatAuth, id: string): Promise<LoadedConversation> {
  const response = await fetch(`${CHAT_BASE}/conversations/${encodeURIComponent(id)}`, {
    headers: authHeaders(auth),
  });
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  const record = asRecord(data);
  const conversation = normalizeConversation(record.conversation) ?? {
    id,
    title: 'Conversation',
    created: '',
    updated: '',
  };
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const rawEdits = Array.isArray(record.edits)
    ? record.edits
    : Array.isArray(record.chatEdits)
      ? record.chatEdits
      : [];
  const edits = rawEdits
    .map(normalizeEdit)
    .filter((edit): edit is ChatUiEdit => Boolean(edit));

  const messages: ChatUiMessage[] = rawMessages
    .map((item): ChatUiMessage => {
      const message = asRecord(item);
      const role: 'assistant' | 'user' = message.role === 'assistant' ? 'assistant' : 'user';
      const idValue = stringValue(message.id);
      const usage = sanitizeChatUsage(message.usage);
      return {
        ...(idValue ? { id: idValue } : {}),
        role,
        content: stringValue(message.content),
        ...(stringValue(message.reasoning) ? { reasoning: stringValue(message.reasoning) } : {}),
        ...(Array.isArray(message.tools)
          ? {
            tools: message.tools
              .map((tool) => normalizeTool(asRecord(tool), 'tool'))
              .filter((tool): tool is ChatUiTool => Boolean(tool)),
          }
          : {}),
        ...(Array.isArray(message.sources) ? { sources: normalizeSources(message.sources) } : {}),
        ...(message.context && typeof message.context === 'object'
          ? { context: message.context as ChatUiMessage['context'] }
          : {}),
        ...(Array.isArray(message.attachments)
          ? {
            attachments: message.attachments
              .map((attachment) => sanitizeAttachmentRef(attachment))
              .filter((attachment): attachment is ChatAttachmentRef => Boolean(attachment)),
          }
          : {}),
        ...(stringValue(message.model) ? { model: stringValue(message.model) } : {}),
        ...(usage ? { usage } : {}),
        ...(message.stopped === true ? { stopped: true } : {}),
        streaming: false,
      };
    })
    .filter((message) => message.content || message.reasoning || message.tools?.length || message.attachments?.length);

  // Attach edits to their message; orphaned edits ride on the last answer so a
  // reloaded conversation never loses an undo card.
  let orphanAttached = false;
  for (const edit of edits) {
    const owner = edit.messageId
      ? messages.find((message) => message.id === edit.messageId)
      : undefined;
    if (owner) {
      owner.edits = [...(owner.edits ?? []), edit];
    } else if (!orphanAttached) {
      const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant) {
        lastAssistant.edits = [...(lastAssistant.edits ?? []), edit];
        orphanAttached = true;
      }
    }
  }

  return { conversation, messages, edits };
}

export async function renameConversation(
  auth: ChatAuth,
  id: string,
  title: string,
): Promise<ChatConversation> {
  const response = await fetch(`${CHAT_BASE}/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(auth),
    },
    body: JSON.stringify({ title }),
  });
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  return normalizeConversation(asRecord(data).conversation ?? data) ?? {
    id,
    title,
    created: '',
    updated: '',
  };
}

export async function deleteConversation(auth: ChatAuth, id: string): Promise<void> {
  const response = await fetch(`${CHAT_BASE}/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(auth),
  });
  if (!response.ok && response.status !== 404) {
    const data = await readJson(response);
    throw errorFromResponse(response.status, data);
  }
}

export async function listEdits(auth: ChatAuth, conversationId: string): Promise<ChatUiEdit[]> {
  const paths = [
    `${CHAT_BASE}/conversations/${encodeURIComponent(conversationId)}/edits`,
    `${CHAT_BASE}/edits?conversation=${encodeURIComponent(conversationId)}`,
  ];

  for (const path of paths) {
    const response = await fetch(path, { headers: authHeaders(auth) });
    if (response.status === 404 || response.status === 405) continue;
    const data = await readJson(response);
    if (!response.ok) throw errorFromResponse(response.status, data);
    const list = Array.isArray(data) ? data : asRecord(data).edits ?? asRecord(data).items;
    if (!Array.isArray(list)) return [];
    return list
      .map(normalizeEdit)
      .filter((edit): edit is ChatUiEdit => Boolean(edit));
  }

  return [];
}

export async function undoEdit(auth: ChatAuth, editId: string): Promise<ChatUiEdit | null> {
  const response = await fetch(`${CHAT_BASE}/edits/${encodeURIComponent(editId)}/undo`, {
    method: 'POST',
    headers: authHeaders(auth),
  });
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  const record = asRecord(data);
  return normalizeEdit(record.edit ?? data);
}

async function resolvePendingAction(
  auth: ChatAuth,
  editId: string,
  action: 'confirm' | 'cancel',
): Promise<ChatUiEdit | null> {
  const response = await fetch(
    `${CHAT_BASE}/edits/${encodeURIComponent(editId)}/${action}`,
    { method: 'POST', headers: authHeaders(auth) },
  );
  const data = await readJson(response);
  if (!response.ok) throw errorFromResponse(response.status, data);
  const record = asRecord(data);
  return normalizeEdit(record.edit ?? data);
}

export async function confirmEdit(auth: ChatAuth, editId: string): Promise<ChatUiEdit | null> {
  return resolvePendingAction(auth, editId, 'confirm');
}

export async function cancelEdit(auth: ChatAuth, editId: string): Promise<ChatUiEdit | null> {
  return resolvePendingAction(auth, editId, 'cancel');
}
