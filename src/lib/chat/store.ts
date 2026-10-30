import { useSyncExternalStore } from 'react';
import { getDefaultStore } from 'jotai';
import { CHAT_EMPTY_RESPONSE_FALLBACK } from '../../api/chat/types';
import { chatConversationIdAtom } from '../../state/atoms';
import { pb } from '../pocketbase';
import { setLastChat } from '../settings';
import { stripTitleEmoji } from '../ai/title';
import {
  ChatApiError,
  cancelEdit as cancelEditRequest,
  confirmEdit as confirmEditRequest,
  deleteConversation as deleteConversationRequest,
  getChatStatus,
  listConversations as listConversationsRequest,
  listEdits as listEditsRequest,
  loadConversation as loadConversationRequest,
  renameConversation as renameConversationRequest,
  streamChat,
  undoEdit as undoEditRequest,
} from './client';
import { getAiEditing, setAiEditing } from './presence';
import type {
  ChatContextInput,
  ChatError,
  ChatMode,
  ChatUiEdit,
  ChatUiMessage,
  ChatUiState,
  ChatUiTool,
  ChatAttachmentRef,
} from './types';

const WRITE_TOOL = /^(create|update|edit|append|move|archive|restore)_/;

function auth() {
  return { token: pb.authStore.token };
}

function initialState(): ChatUiState {
  const persistedId = typeof window !== 'undefined'
    ? getDefaultStore().get(chatConversationIdAtom) ?? null
    : null;

  return {
    conversationId: persistedId,
    conversation: null,
    messages: [],
    active: false,
    stopping: false,
    error: null,
    status: null,
    selectedModelId: null,
    statusLoading: false,
    statusError: null,
    conversations: [],
    conversationsLoading: false,
    conversationsError: null,
    edits: [],
    editsLoading: false,
    mode: 'edit',
    loadingConversation: false,
    loadedConversationId: null,
    editing: null,
    pendingEditConversationIds: [],
  };
}

function findEditing(state: ChatUiState): ChatUiState['editing'] {
  const lastAssistant = [...state.messages].reverse().find((message) => message.role === 'assistant');
  const runningWrite = lastAssistant?.tools?.find(
    (tool) => tool.status === 'running' && WRITE_TOOL.test(tool.name),
  );

  if (runningWrite) {
    return {
      ...(runningWrite.targetType ? { targetType: runningWrite.targetType } : {}),
      ...(runningWrite.targetId ? { targetId: runningWrite.targetId } : {}),
      ...(runningWrite.title ? { title: runningWrite.title } : {}),
    };
  }

  const applying = state.edits.find((edit) => edit.status === 'applying');
  if (applying) {
    return {
      ...(applying.target.type === 'task' ? {} : { targetType: applying.target.type }),
      ...(applying.target.type === 'task' ? {} : { targetId: applying.target.id }),
      title: applying.target.title,
    };
  }

  return null;
}

function convergence(state: ChatUiState): ChatUiState {
  const editing = findEditing(state);
  const pending = new Set<string>();
  for (const edit of state.edits) {
    if (
      edit.conversationId
      && (edit.status === 'applying' || (edit.status === 'applied' && edit.undo.available))
    ) {
      pending.add(edit.conversationId);
    }
  }
  for (const conversation of state.conversations) {
    if ((conversation.pending_edits ?? 0) > 0) pending.add(conversation.id);
  }
  return {
    ...state,
    editing,
    pendingEditConversationIds: [...pending],
  };
}

let state: ChatUiState = initialState();
let abortController: AbortController | null = null;
let streamToken = 0;
let loadToken = 0;
let conversationListToken = 0;
let statusToken = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<ChatUiState> | ((current: ChatUiState) => Partial<ChatUiState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = convergence({ ...state, ...next });
  emit();
}

export function subscribeChatStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatSnapshot(): ChatUiState {
  return state;
}

export function useChatStore<T>(selector: (snapshot: ChatUiState) => T): T {
  return useSyncExternalStore(
    subscribeChatStore,
    () => selector(getChatSnapshot()),
    () => selector(getChatSnapshot()),
  );
}

function rememberConversation(id: string | null): void {
  getDefaultStore().set(chatConversationIdAtom, id);
  if (id) setLastChat(id);
}

function updateLastAssistant(
  update: (message: ChatUiMessage) => ChatUiMessage,
): void {
  const index = [...state.messages].reverse().findIndex((message) => message.role === 'assistant');
  if (index === -1) return;
  const realIndex = state.messages.length - 1 - index;
  const messages = state.messages.slice();
  const message = messages[realIndex];
  if (!message) return;
  messages[realIndex] = update(message);
  setState({ messages });
}

function upsertTool(tool: ChatUiTool): void {
  updateLastAssistant((message) => {
    const tools = [...(message.tools ?? [])];
    const byId = tool.id
      ? tools.findIndex((candidate) => candidate.id === tool.id)
      : -1;
    const byName = byId === -1
      ? tools.findIndex((candidate) => candidate.name === tool.name && candidate.status === 'running')
      : -1;
    const index = byId !== -1 ? byId : byName;
    if (index === -1) {
      tools.push({ ...tool });
    } else {
      const previous = tools[index];
      tools[index] = {
        ...previous,
        ...tool,
        id: previous?.id ?? tool.id,
        name: tool.name || previous?.name || '',
        title: tool.title ?? previous?.title,
      };
    }
    return { ...message, tools };
  });
}

function attachEdit(edit: ChatUiEdit): void {
  const edits = [...state.edits];
  const index = edits.findIndex((candidate) => candidate.id === edit.id);
  if (index === -1) edits.push(edit);
  else edits[index] = { ...edits[index], ...edit };

  const messages = state.messages.slice();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    const messageEdits = message.edits ?? [];
    const existing = messageEdits.findIndex((candidate) => candidate.id === edit.id);
    if (existing !== -1 || !edit.messageId || edit.messageId === message.id || message.streaming) {
      const nextEdits = [...messageEdits];
      if (existing === -1) nextEdits.push(edit);
      else nextEdits[existing] = { ...nextEdits[existing], ...edit };
      messages[i] = { ...message, edits: nextEdits };
      break;
    }
  }

  setState({ edits, messages });
}

function clearPresence(): void {
  setAiEditing(null);
}

function finalizeStopped(partial?: string): void {
  if (!state.active && !state.stopping) return;
  const messages = state.messages.map((message) => {
    if (message.role !== 'assistant' || !message.streaming) return message;
    return {
      ...message,
      content: partial ?? message.content,
      streaming: false,
      stopped: true,
    };
  });
  setState({ messages, active: false, stopping: false, error: null });
  clearPresence();
}

function finalizeError(error: ChatError, retryText: string): void {
  const messages = state.messages.slice();
  const last = messages[messages.length - 1];
  if (
    last
    && last.role === 'assistant'
    && !last.content
    && !last.reasoning
    && !last.tools?.length
    && !last.edits?.length
  ) {
    messages.pop();
  } else if (last && last.role === 'assistant') {
    messages[messages.length - 1] = { ...last, streaming: false };
  }

  setState({
    messages,
    active: false,
    stopping: false,
    error: { ...error, retryText },
  });
  clearPresence();
}

function finalizeDone(meta: { messageId?: string; stopped?: boolean; model?: string }, model?: string): void {
  const messages = state.messages.map((message) => {
    if (message.role !== 'assistant' || !message.streaming) return message;
    return {
      ...message,
      ...(meta.messageId ? { id: meta.messageId } : {}),
      content: message.content.trim()
        ? message.content
        : meta.stopped
          ? ''
          : CHAT_EMPTY_RESPONSE_FALLBACK,
      ...(meta.model || model ? { model: meta.model ?? model } : {}),
      streaming: false,
      ...(meta.stopped ? { stopped: true } : {}),
    };
  });

  setState({ messages, active: false, stopping: false, error: null });

  // Keep the "Nana is editing" banner for the section animation window after
  // the final SSE frame; the timed presence update clears it.
  const recentEdit = getAiEditing();
  if (!recentEdit?.targetId || Date.now() - recentEdit.startedAt > 2800) {
    clearPresence();
  }

  if (state.conversationId) {
    void refreshEdits(state.conversationId);
    void refreshConversations(true);
    window.setTimeout(() => void refreshConversations(true), 4000);
  }
}

/**
 * Start, load, and reset conversations. The dock and the full-page chat share
 * this single store so a reply can finish while the dock is closed or the
 * route changes.
 */
export function setActiveConversation(id: string | null): void {
  if (
    id === state.conversationId
    && (
      id === null
      || state.loadedConversationId === id
      || state.loadingConversation
      || state.messages.length > 0
    )
  ) {
    return;
  }

  if (state.active) {
    abortController?.abort();
    abortController = null;
    streamToken += 1;
  }

  loadToken += 1;
  state = convergence({
    ...state,
    conversationId: id,
    conversation: null,
    messages: [],
    active: false,
    stopping: false,
    error: null,
    loadingConversation: Boolean(id),
    loadedConversationId: null,
    edits: [],
  });
  rememberConversation(id);
  emit();

  if (id) void loadConversationById(id);
}

async function loadConversationById(id: string): Promise<void> {
  const token = ++loadToken;
  setState({ loadingConversation: true });
  try {
    const data = await loadConversationRequest(auth(), id);
    if (token !== loadToken || state.conversationId !== id) return;
    setState({
      conversation: data.conversation,
      messages: data.messages,
      edits: data.edits,
      loadedConversationId: id,
      loadingConversation: false,
      error: null,
    });
    void refreshEdits(id);
  } catch (error) {
    if (token !== loadToken || state.conversationId !== id) return;
    if (error instanceof ChatApiError && error.status === 404) {
      startNewConversation();
      return;
    }
    setState({
      loadingConversation: false,
      error: {
        message: error instanceof Error ? error.message : 'Could not load that conversation.',
      },
    });
  }
}

export function startNewConversation(): void {
  if (state.active) {
    abortController?.abort();
    abortController = null;
    streamToken += 1;
  }
  loadToken += 1;
  state = convergence({
    ...state,
    conversationId: null,
    conversation: null,
    messages: [],
    active: false,
    stopping: false,
    error: null,
    loadingConversation: false,
    loadedConversationId: null,
    edits: [],
    editsLoading: false,
  });
  rememberConversation(null);
  clearPresence();
  emit();
}

export function setChatMode(mode: ChatMode): void {
  if (state.mode === mode) return;
  setState({ mode });
}

export async function refreshStatus(): Promise<void> {
  const token = ++statusToken;
  setState({ statusLoading: true, statusError: null });
  try {
    const status = await getChatStatus(auth());
    if (token !== statusToken) return;
    setState((current) => {
      const models = status.models ?? [];
      const previous = current.selectedModelId;
      const valid = previous && models.some((model) => model.id === previous);
      return {
        status,
        selectedModelId: valid
          ? previous
          : status.defaultModelId ?? models[0]?.id ?? null,
        statusLoading: false,
        statusError: null,
      };
    });
  } catch (error) {
    if (token !== statusToken) return;
    if (error instanceof ChatApiError && error.status === 404) {
      // The status endpoint may land after the dock. Treat it as unknown
      // rather than blocking the composer or showing a false setup state.
      setState({ status: null, statusLoading: false, statusError: null });
      return;
    }
    setState({
      statusLoading: false,
      statusError: error instanceof Error ? error.message : 'Status unavailable.',
    });
  }
}

export function setChatModel(modelId: string | null): void {
  if (modelId && !state.status?.models?.some((model) => model.id === modelId)) return;
  if (state.selectedModelId === modelId) return;
  setState({ selectedModelId: modelId });
}

export async function refreshConversations(silent = false): Promise<void> {
  const token = ++conversationListToken;
  if (!silent) setState({ conversationsLoading: true, conversationsError: null });
  try {
    const conversations = await listConversationsRequest(auth());
    if (token !== conversationListToken) return;
    const current = state.conversationId
      ? conversations.find((conversation) => conversation.id === state.conversationId)
      : undefined;
    setState({
      conversations,
      conversationsLoading: false,
      conversationsError: null,
      conversation: current
        ? { ...(state.conversation ?? current), ...current, title: current.title }
        : state.conversation,
    });
  } catch (error) {
    if (token !== conversationListToken) return;
    setState({
      conversationsLoading: false,
      ...(silent ? {} : {
        conversationsError: error instanceof Error ? error.message : 'Could not load conversations.',
      }),
    });
  }
}

async function refreshEdits(conversationId: string): Promise<void> {
  setState({ editsLoading: true });
  try {
    const edits = await listEditsRequest(auth(), conversationId);
    if (state.conversationId !== conversationId) return;
    const orphans = edits.filter((edit) => !edit.messageId);
    let orphanAttached = false;
    const messages = state.messages.map((message) => {
      const messageEdits = edits.filter((edit) =>
        edit.messageId
          ? edit.messageId === message.id
          : false
      );
      if (
        message.role === 'assistant'
        && !orphanAttached
        && message.id
        && message.id === [...state.messages].reverse().find((item) => item.role === 'assistant')?.id
      ) {
        messageEdits.push(...orphans);
        orphanAttached = true;
      }
      return messageEdits.length ? { ...message, edits: messageEdits } : message;
    });
    setState({ edits, editsLoading: false, messages });
  } catch {
    setState({ editsLoading: false });
  }
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const clean = title.trim();
  if (!clean) return;
  const previous = state.conversations;
  const previousConversation = state.conversation;
  setState({
    conversations: previous.map((conversation) =>
      conversation.id === id ? { ...conversation, title: clean } : conversation
    ),
    conversation: state.conversation?.id === id
      ? { ...state.conversation, title: clean }
      : state.conversation,
  });

  try {
    const updated = await renameConversationRequest(auth(), id, clean);
    setState({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, ...updated, title: updated.title || clean } : conversation
      ),
      conversation: state.conversation?.id === id
        ? { ...state.conversation, ...updated, title: updated.title || clean }
        : state.conversation,
    });
  } catch (error) {
    setState({ conversations: previous, conversation: previousConversation });
    throw error;
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await deleteConversationRequest(auth(), id);
  const conversations = state.conversations.filter((conversation) => conversation.id !== id);
  if (state.conversationId === id) {
    startNewConversation();
    setState({ conversations });
  } else {
    setState({ conversations });
  }
  setState({ pendingEditConversationIds: state.pendingEditConversationIds.filter((value) => value !== id) });
}

export async function undoEdit(id: string): Promise<void> {
  const previous = state.edits.find((edit) => edit.id === id);
  if (!previous) return;

  const mark = (edit: ChatUiEdit) => {
    const edits = state.edits.map((candidate) => candidate.id === id ? edit : candidate);
    const messages = state.messages.map((message) => {
      if (!message.edits?.some((candidate) => candidate.id === id)) return message;
      return {
        ...message,
        edits: message.edits.map((candidate) => candidate.id === id ? edit : candidate),
      };
    });
    setState({ edits, messages });
  };

  mark({ ...previous, undoing: true, undoError: undefined });

  try {
    const updated = await undoEditRequest(auth(), id);
    mark(updated
      ? { ...updated, undoing: false }
      : {
        ...previous,
        status: 'undone',
        undo: { ...previous.undo, available: false },
        undoing: false,
      });
  } catch (error) {
    mark({
      ...previous,
      undoing: false,
      undoError: error instanceof Error ? error.message : 'Undo failed.',
    });
  }
}

function markEditState(id: string, edit: ChatUiEdit): void {
  const edits = state.edits.map((candidate) => candidate.id === id ? edit : candidate);
  const messages = state.messages.map((message) => {
    if (!message.edits?.some((candidate) => candidate.id === id)) return message;
    return {
      ...message,
      edits: message.edits.map((candidate) => candidate.id === id ? edit : candidate),
    };
  });
  setState({ edits, messages });
}

async function resolvePendingDelete(
  id: string,
  action: 'confirm' | 'cancel',
): Promise<void> {
  const previous = state.edits.find((edit) => edit.id === id);
  if (!previous || previous.status !== 'pending') return;

  markEditState(id, { ...previous, undoing: true, undoError: undefined });

  try {
    const updated = action === 'confirm'
      ? await confirmEditRequest(auth(), id)
      : await cancelEditRequest(auth(), id);
    markEditState(id, updated
      ? { ...updated, undoing: false }
      : {
        ...previous,
        status: action === 'confirm' ? 'applied' : 'cancelled',
        undo: { ...previous.undo, available: false },
        undoing: false,
      });
  } catch (error) {
    markEditState(id, {
      ...previous,
      undoing: false,
      undoError: error instanceof Error ? error.message : `Could not ${action} the delete.`,
    });
  }
}

export async function confirmDelete(id: string): Promise<void> {
  return resolvePendingDelete(id, 'confirm');
}

export async function cancelDelete(id: string): Promise<void> {
  return resolvePendingDelete(id, 'cancel');
}

export interface SendOptions {
  mode?: ChatMode;
  modelId?: string;
  attachments?: ChatAttachmentRef[];
  context?: ChatContextInput;
  /** Display only; never sent to the server. */
  contextTitle?: string;
}

export async function sendMessage(text: string, options: SendOptions = {}): Promise<void> {
  const content = text.trim();
  const attachments = options.attachments ?? [];
  if ((!content && attachments.length === 0) || state.active) return;

  const mode = options.mode ?? state.mode;
  const modelId = options.modelId ?? state.selectedModelId ?? undefined;
  const token = ++streamToken;
  const controller = new AbortController();
  abortController = controller;

  const userMessage: ChatUiMessage = {
    role: 'user',
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(options.context
      ? {
        context: {
          ...options.context,
          title: options.contextTitle ?? '',
        },
      }
      : {}),
  };
  const assistantMessage: ChatUiMessage = {
    role: 'assistant',
    content: '',
    streaming: true,
  };

  state = convergence({
    ...state,
    messages: [...state.messages, userMessage, assistantMessage],
    active: true,
    stopping: false,
    error: null,
  });
  emit();

  let retryText = content || attachments[0]?.name || 'Attachment';
  let errored = false;
  let done = false;
  let stopped = false;

  const current = () => token === streamToken;

  try {
    await streamChat({
      conversationId: state.conversationId ?? undefined,
      message: content,
      mode,
      ...(modelId ? { modelId } : {}),
      ...(attachments.length > 0 ? { attachmentIds: attachments.map((attachment) => attachment.id) } : {}),
      context: options.context,
      signal: controller.signal,
      auth: auth(),
    }, {
      onConversation: ({ conversationId, isNew }) => {
        if (!current()) return;
        if (conversationId && conversationId !== state.conversationId) {
          rememberConversation(conversationId);
          setState({
            conversationId,
            conversation: state.conversation ?? {
              id: conversationId,
              title: stripTitleEmoji(content.length > 60 ? `${content.slice(0, 57)}…` : content, 'New chat'),
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            },
          });
        }
        if (isNew) {
          window.setTimeout(() => void refreshConversations(true), 1200);
        }
      },
      onText: (delta) => {
        if (!current()) return;
        updateLastAssistant((message) => ({ ...message, content: message.content + delta }));
      },
      onReasoning: (delta) => {
        if (!current()) return;
        updateLastAssistant((message) => ({
          ...message,
          reasoning: (message.reasoning ?? '') + delta,
        }));
      },
      onTool: (tool) => {
        if (!current()) return;
        upsertTool(tool);
      },
      onSources: (sources) => {
        if (!current()) return;
        updateLastAssistant((message) => ({ ...message, sources }));
      },
      onEdit: (edit) => {
        if (!current()) return;
        attachEdit(edit);

        if (edit.status === 'applied' && edit.target.type !== 'task') {
          const startedAt = Date.now();
          setAiEditing({
            targetType: edit.target.type,
            targetId: edit.target.id,
            title: edit.target.title,
            ...(state.conversationId ? { conversationId: state.conversationId } : {}),
            startedAt,
          });
          window.setTimeout(() => {
            const active = getAiEditing();
            if (
              active
              && active.targetType === edit.target.type
              && active.targetId === edit.target.id
              && active.startedAt === startedAt
            ) {
              setAiEditing(null);
            }
          }, 3200);
        }

        if (edit.target.type === 'document' && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nana:ai-edit', { detail: { edit } }));
        }
      },
      onDone: (meta) => {
        if (!current()) return;
        done = true;
        stopped = meta.stopped === true;
        finalizeDone(meta, meta.model);
      },
      onError: (error) => {
        if (!current()) return;
        errored = true;
        finalizeError(error, retryText);
        controller.abort();
      },
    });

    if (!current()) return;
    if (!done && !errored) {
      finalizeDone({ stopped });
    }
  } catch (error) {
    if (!current()) return;
    if (errored) return;

    const aborted = controller.signal.aborted
      || (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError');

    if (aborted) {
      finalizeStopped();
      return;
    }

    if (error instanceof ChatApiError) {
      finalizeError({
        message: error.message,
        code: error.code,
        status: error.status,
      }, retryText);
      return;
    }

    finalizeError({
      message: error instanceof Error ? error.message : 'Nana could not finish that answer.',
    }, retryText);
  } finally {
    if (current()) {
      abortController = null;
    }
  }
}

/** Stop the stream but keep the partial answer. */
export function stopStream(): void {
  if (!state.active) return;
  setState({ stopping: true });
  if (abortController) {
    abortController.abort();
    return;
  }
  finalizeStopped();
}

/** Resend the failed user text without duplicating it in the local thread. */
export function retryLastMessage(context?: ChatContextInput): void {
  const text = state.error?.retryText;
  if (!text || state.active) return;

  const messages = state.messages.slice();
  // Drop any partial assistant answer plus the failed user turn. The retry
  // re-adds the user message through the normal send path exactly once.
  let index = messages.length - 1;
  while (index >= 0 && messages[index]?.role === 'assistant') index -= 1;
  if (index >= 0 && messages[index]?.role === 'user' && messages[index]?.content === text) {
    messages.splice(index, messages.length - index);
  }
  setState({ messages, error: null });
  void sendMessage(text, { context });
}

/** Used by sign-out to drop the previous account's conversation. */
export function resetChatStore(): void {
  ++streamToken;
  ++loadToken;
  ++conversationListToken;
  ++statusToken;
  abortController?.abort();
  abortController = null;
  state = initialState();
  state = { ...state, conversationId: null };
  rememberConversation(null);
  clearPresence();
  emit();
}

/** Convenience for the history dot. */
export function conversationHasPendingEdit(conversationId: string): boolean {
  return state.pendingEditConversationIds.includes(conversationId);
}
