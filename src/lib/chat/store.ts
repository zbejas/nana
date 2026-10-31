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
  getNoteChatStatus as getNoteChatStatusRequest,
  listConversations as listConversationsRequest,
  listEdits as listEditsRequest,
  loadConversation as loadConversationRequest,
  openNoteChat as openNoteChatRequest,
  renameConversation as renameConversationRequest,
  streamChat,
  undoEdit as undoEditRequest,
} from './client';
import { getAiEditing, setAiEditing } from './presence';
import { notifyWorkspaceChanged, removalMessage } from '../workspace-events';
import type {
  ChatContextInput,
  ChatConversation,
  ChatError,
  ChatMode,
  ChatScope,
  ChatUiEdit,
  ChatUiMessage,
  ChatUiPart,
  ChatUiState,
  ChatUiTool,
  ChatAttachmentRef,
  ChatUsage,
  NoteChatStatus,
} from './types';

type ChatParts = ChatUiPart[];

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
    scope: 'personal',
    noteChatStatus: null,
    noteChatLoading: false,
    noteChatError: null,
    noteChatDocumentId: null,
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
let noteChatToken = 0;
let refreshToken = 0;
let refreshPromise: Promise<void> | null = null;
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
  // A shared note conversation is never the personal last-chat.
  if (state.scope === 'note') return;
  getDefaultStore().set(chatConversationIdAtom, id);
  if (id) setLastChat(id);
}

function persistedPersonalConversationId(): string | null {
  return getDefaultStore().get(chatConversationIdAtom) ?? null;
}

function abortActiveStream(): void {
  if (!state.active && !state.stopping) return;
  abortController?.abort();
  abortController = null;
  streamToken += 1;
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

function appendTextPart(parts: ChatParts | undefined, delta: string): ChatParts {
  const next = [...(parts ?? [])];
  const last = next[next.length - 1];
  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: last.text + delta };
  } else {
    next.push({ type: 'text', text: delta });
  }
  return next;
}

function appendReasoningPart(parts: ChatParts | undefined, delta: string): ChatParts {
  const next = [...(parts ?? [])];
  const last = next[next.length - 1];
  if (last?.type === 'reasoning') {
    next[next.length - 1] = { ...last, text: last.text + delta };
  } else {
    next.push({ type: 'reasoning', text: delta });
  }
  return next;
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

    const parts = [...(message.parts ?? [])];
    const partIndex = tool.id
      ? parts.findIndex((part) => part.type === 'tool' && part.id === tool.id)
      : parts.findIndex((part) => part.type === 'tool' && part.name === tool.name && part.status === 'running');
    if (partIndex === -1) {
      parts.push({ type: 'tool', ...tool });
    } else {
      const previous = parts[partIndex];
      if (previous?.type === 'tool') {
        parts[partIndex] = {
          ...previous,
          ...tool,
          id: previous.id ?? tool.id,
          name: tool.name || previous.name,
          title: tool.title ?? previous.title,
        };
      }
    }

    return { ...message, tools, parts };
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
      const nextParts = [...(message.parts ?? [])];
      if (!nextParts.some((part) => part.type === 'edit' && part.editId === edit.id)) {
        nextParts.push({ type: 'edit', editId: edit.id });
      }
      messages[i] = {
        ...message,
        edits: nextEdits,
        ...(nextParts.length > 0 ? { parts: nextParts } : {}),
      };
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
    && !last.parts?.length
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

function finalizeDone(
  meta: { messageId?: string; stopped?: boolean; model?: string; usage?: ChatUsage },
  model?: string,
): void {
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
      ...(meta.usage ? { usage: meta.usage } : {}),
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

  abortActiveStream();

  loadToken += 1;
  state = convergence({
    ...state,
    // The loaded conversation decides its scope. A note conversation never
    // writes the personal last-chat atom.
    scope: id ? 'personal' : state.scope,
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
  emit();

  if (!id) {
    if (state.scope === 'personal') rememberConversation(null);
    return;
  }
  void loadConversationById(id);
}

async function loadConversationById(id: string): Promise<void> {
  const token = ++loadToken;
  setState({ loadingConversation: true });
  try {
    const data = await loadConversationRequest(auth(), id);
    if (token !== loadToken || state.conversationId !== id) return;

    const noteConversation = data.conversation.scope === 'note'
      || Boolean(data.conversation.documentId);
    if (noteConversation) {
      setState({
        scope: 'note',
        noteChatDocumentId: data.conversation.documentId ?? state.noteChatDocumentId,
        conversation: {
          ...data.conversation,
          scope: 'note',
          ...(data.conversation.documentId
            ? { documentId: data.conversation.documentId }
            : state.noteChatDocumentId
              ? { documentId: state.noteChatDocumentId }
              : {}),
        },
        messages: data.messages,
        edits: data.edits,
        loadedConversationId: id,
        loadingConversation: false,
        error: null,
        ...(state.noteChatStatus?.canEdit === false ? { mode: 'ask' as ChatMode } : {}),
      });
      if (data.conversation.documentId) void loadNoteChatStatus(data.conversation.documentId);
    } else {
      setState({
        scope: 'personal',
        conversation: data.conversation,
        messages: data.messages,
        edits: data.edits,
        loadedConversationId: id,
        loadingConversation: false,
        error: null,
      });
      rememberConversation(id);
    }
    void refreshEdits(id);
  } catch (error) {
    if (token !== loadToken || state.conversationId !== id) return;
    if (error instanceof ChatApiError && error.status === 404) {
      if (state.scope === 'note') {
        setState({
          loadingConversation: false,
          loadedConversationId: null,
          error: { message: 'This shared conversation is no longer available.' },
        });
        if (state.noteChatDocumentId) void loadNoteChatStatus(state.noteChatDocumentId);
        return;
      }
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

function activateNoteConversation(
  id: string,
  conversation?: ChatConversation | null,
): void {
  if (
    state.conversationId === id
    && (
      state.loadedConversationId === id
      || state.loadingConversation
      || state.messages.length > 0
    )
  ) {
    if (conversation) setState({ conversation });
    return;
  }
  if (state.active) return;

  loadToken += 1;
  state = convergence({
    ...state,
    scope: 'note',
    conversationId: id,
    conversation: conversation ?? null,
    messages: [],
    active: false,
    stopping: false,
    error: null,
    loadingConversation: true,
    loadedConversationId: null,
    edits: [],
  });
  emit();
  void loadConversationById(id);
}

/** Switch between the persisted personal chat and the current note's shared chat. */
export function setChatScope(scope: ChatScope): void {
  if (state.scope === scope) return;
  // Cancel any pending note status/open request from the previous scope.
  noteChatToken += 1;
  abortActiveStream();
  loadToken += 1;

  if (scope === 'personal') {
    const personalId = persistedPersonalConversationId();
    state = convergence({
      ...state,
      scope: 'personal',
      conversationId: personalId,
      conversation: null,
      messages: [],
      active: false,
      stopping: false,
      error: null,
      loadingConversation: Boolean(personalId),
      loadedConversationId: null,
      edits: [],
    });
    emit();
    if (personalId) void loadConversationById(personalId);
    return;
  }

  const documentId = state.noteChatDocumentId;
  const status = state.noteChatStatus;
  state = convergence({
    ...state,
    scope: 'note',
    conversationId: null,
    conversation: null,
    messages: [],
    active: false,
    stopping: false,
    error: null,
    loadingConversation: false,
    loadedConversationId: null,
    edits: [],
  });
  emit();

  if (status?.conversation && (!documentId || status.noteId === documentId)) {
    if (status.enabled && documentId) {
      // POST is idempotent: it refreshes access and returns the one thread.
      void openNoteChat(documentId);
    } else {
      activateNoteConversation(status.conversation.id, status.conversation);
    }
  } else if (documentId && status?.enabled) {
    void openNoteChat(documentId);
  }
}

/**
 * Refresh shared-chat availability for one note. It never switches scope on its
 * own; the dock decides whether to restore the note tab.
 */
export async function loadNoteChatStatus(documentId: string): Promise<NoteChatStatus | null> {
  const token = ++noteChatToken;
  setState((current) => ({
    noteChatDocumentId: documentId,
    ...(current.noteChatDocumentId === documentId ? {} : { noteChatStatus: null }),
    noteChatLoading: true,
    noteChatError: null,
  }));

  try {
    const status = await getNoteChatStatusRequest(auth(), documentId);
    if (token !== noteChatToken || state.noteChatDocumentId !== documentId) return null;
    setState({
      noteChatStatus: status,
      noteChatLoading: false,
      noteChatError: null,
      ...(status.enabled ? {} : { error: null }),
      ...(state.scope === 'note' && !status.canEdit ? { mode: 'ask' as ChatMode } : {}),
    });
    if (
      state.scope === 'note'
      && status.conversation
      && state.conversationId !== status.conversation.id
      && !state.active
    ) {
      activateNoteConversation(status.conversation.id, status.conversation);
    }
    return status;
  } catch (error) {
    if (token !== noteChatToken || state.noteChatDocumentId !== documentId) return null;
    if (error instanceof ChatApiError && error.status === 404) {
      setState({
        noteChatStatus: null,
        noteChatLoading: false,
        noteChatError: 'You no longer have access to this note’s shared chat.',
      });
      return null;
    }
    setState({
      noteChatLoading: false,
      noteChatError: error instanceof Error ? error.message : 'Shared chat is unavailable.',
    });
    return null;
  }
}

/** Open or create the one shared conversation for a note. */
export async function openNoteChat(documentId: string): Promise<void> {
  const token = ++noteChatToken;
  setState((current) => ({
    ...(current.noteChatDocumentId === documentId ? {} : { noteChatStatus: null }),
    noteChatDocumentId: documentId,
    noteChatLoading: true,
    noteChatError: null,
  }));

  try {
    const result = await openNoteChatRequest(auth(), documentId);
    if (token !== noteChatToken || state.noteChatDocumentId !== documentId) return;
    setState({
      scope: 'note',
      noteChatStatus: result.status,
      noteChatLoading: false,
      noteChatError: null,
      ...(!result.status.canEdit ? { mode: 'ask' as ChatMode } : {}),
    });
    if (result.conversation) {
      activateNoteConversation(result.conversation.id, result.conversation);
      void refreshConversations(true);
    }
  } catch (error) {
    if (token !== noteChatToken || state.noteChatDocumentId !== documentId) return;
    if (error instanceof ChatApiError && error.code?.startsWith('note_')) {
      setState({
        scope: 'note',
        noteChatStatus: error.code === 'note_not_shared' && state.noteChatStatus
          ? { ...state.noteChatStatus, enabled: false, reason: state.noteChatStatus.reason ?? 'not_shared' }
          : state.noteChatStatus,
        noteChatLoading: false,
        noteChatError: error.message,
      });
      // Re-read availability so private/trash/access-loss states settle into
      // the same paused or disabled UI as the GET path.
      void loadNoteChatStatus(documentId);
      return;
    }
    setState({
      noteChatLoading: false,
      noteChatError: error instanceof Error ? error.message : 'Could not open the shared chat.',
    });
  }
}

/**
 * Silently reload the open conversation after a realtime event. Never replaces
 * an in-flight local stream or clears the thread while loading.
 */
export function refreshActiveConversation(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const conversationId = state.conversationId;
  if (!conversationId || state.active || state.stopping || state.loadingConversation) {
    return Promise.resolve();
  }

  const token = ++refreshToken;
  const request = (async () => {
    try {
      const data = await loadConversationRequest(auth(), conversationId);
      if (
        token !== refreshToken
        || state.conversationId !== conversationId
        || state.active
      ) {
        return;
      }
      setState({
        conversation: data.conversation,
        messages: data.messages,
        edits: data.edits,
        loadedConversationId: conversationId,
      });
      void refreshConversations(true);
    } catch {
      // Realtime is an enhancement; the next event or manual load retries.
    }
  })();
  refreshPromise = request;
  void request.finally(() => {
    if (refreshPromise === request) refreshPromise = null;
  });
  return request;
}

export function startNewConversation(): void {
  abortActiveStream();
  loadToken += 1;
  state = convergence({
    ...state,
    // New chat always starts a personal conversation. Note scope never creates
    // a second group thread.
    scope: 'personal',
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
  const forced = state.scope === 'note' && state.noteChatStatus?.canEdit === false
    ? 'ask'
    : mode;
  if (state.mode === forced) return;
  setState({ mode: forced });
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
    if (state.scope === 'note') {
      // Deleting a shared conversation returns to the personal chat without
      // touching the persisted personal last-chat.
      setState({ conversations });
      setChatScope('personal');
    } else {
      startNewConversation();
      setState({ conversations });
    }
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
    const resolved: ChatUiEdit = updated
      ? { ...updated, undoing: false }
      : {
        ...previous,
        status: 'undone',
        undo: { ...previous.undo, available: false },
        undoing: false,
      };
    mark(resolved);
    announceRemoval(resolved);
  } catch (error) {
    mark({
      ...previous,
      undoing: false,
      undoError: error instanceof Error ? error.message : 'Undo failed.',
    });
  }
}

/** Tell cached workspace surfaces that a record left the active tree. */
function announceRemoval(edit: ChatUiEdit): void {
  const confirmedDelete = edit.status === 'applied'
    && (edit.tool === 'delete_note'
      || edit.tool === 'delete_folder'
      || edit.tool === 'delete_task'
      || edit.tool === 'delete_board');
  const undoneCreate = edit.status === 'undone' && edit.undo.kind === 'trash';
  if (!confirmedDelete && !undoneCreate) return;

  const target = {
    type: edit.target.type,
    id: edit.target.id,
    ...(edit.target.title ? { title: edit.target.title } : {}),
  };
  notifyWorkspaceChanged({
    targets: [target],
    removed: true,
    message: removalMessage(target),
  });
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
    const resolved: ChatUiEdit = updated
      ? { ...updated, undoing: false }
      : {
        ...previous,
        status: action === 'confirm' ? 'applied' : 'cancelled',
        undo: { ...previous.undo, available: false },
        undoing: false,
      };
    markEditState(id, resolved);
    announceRemoval(resolved);
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
}

export async function sendMessage(text: string, options: SendOptions = {}): Promise<void> {
  const content = text.trim();
  const noteScope = state.scope === 'note';
  if (noteScope && (!state.noteChatStatus?.enabled || !state.conversationId)) return;
  const attachments = noteScope ? [] : options.attachments ?? [];
  if ((!content && attachments.length === 0) || state.active) return;

  const mode = noteScope && !state.noteChatStatus?.canEdit
    ? 'ask'
    : options.mode ?? state.mode;
  const modelId = options.modelId ?? state.selectedModelId ?? undefined;
  const token = ++streamToken;
  const controller = new AbortController();
  abortController = controller;

  const userMessage: ChatUiMessage = {
    role: 'user',
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
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
  const refreshNoteAccess = (code?: string, status?: number) => {
    if (!noteScope) return;
    if (code?.startsWith('note_') || status === 403 || status === 409) {
      const documentId = state.noteChatDocumentId;
      if (documentId) void loadNoteChatStatus(documentId);
    }
  };

  try {
    await streamChat({
      conversationId: state.conversationId ?? undefined,
      message: content,
      mode,
      ...(modelId ? { modelId } : {}),
      ...(attachments.length > 0 ? { attachmentIds: attachments.map((attachment) => attachment.id) } : {}),
      context: noteScope ? undefined : options.context,
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
              ...(noteScope
                ? {
                  scope: 'note' as ChatScope,
                  ...(state.noteChatDocumentId ? { documentId: state.noteChatDocumentId } : {}),
                  ...(state.noteChatStatus ? { canManage: state.noteChatStatus.canManage } : {}),
                }
                : {}),
            },
          });
        }
        if (isNew) {
          window.setTimeout(() => void refreshConversations(true), 1200);
        }
      },
      onText: (delta) => {
        if (!current()) return;
        updateLastAssistant((message) => ({
          ...message,
          content: message.content + delta,
          parts: appendTextPart(message.parts, delta),
        }));
      },
      onReasoning: (delta) => {
        if (!current()) return;
        updateLastAssistant((message) => ({
          ...message,
          reasoning: (message.reasoning ?? '') + delta,
          parts: appendReasoningPart(message.parts, delta),
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

        if (
          edit.status === 'applied'
          && edit.target.type === 'document'
          && typeof window !== 'undefined'
        ) {
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
        refreshNoteAccess(error.code, error.status);
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
      refreshNoteAccess(error.code, error.status);
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
  ++noteChatToken;
  ++refreshToken;
  abortController?.abort();
  abortController = null;
  refreshPromise = null;
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
