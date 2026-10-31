import type {
  ChatContext,
  ChatContextInput,
  ChatContextType,
  ChatEditChanges,
  ChatEditDto,
  ChatEditSection,
  ChatEditStatus,
  ChatEditTarget,
  ChatMode,
  ChatSource,
  ChatStatusResponse,
  ChatToolActivity,
  ChatPart,
  ChatAttachmentRef,
  ChatAttachmentKind,
  ChatUsage,
} from '../../api/chat/types';

export type {
  ChatContext,
  ChatContextInput,
  ChatContextType,
  ChatEditChanges,
  ChatEditDto,
  ChatEditSection,
  ChatEditStatus,
  ChatEditTarget,
  ChatMode,
  ChatSource,
  ChatStatusResponse,
  ChatToolActivity,
  ChatPart,
  ChatAttachmentRef,
  ChatAttachmentKind,
  ChatUsage,
};

/** The dock either shows the caller's personal chat or a note's shared chat. */
export type ChatScope = 'personal' | 'note';

/** Why a note cannot host a shared chat right now. */
export type NoteChatReason = 'not_shared' | 'private' | 'trashed' | 'unavailable';

/** GET/POST /api/chat/notes/:id/chat. `conversation` is the one shared chat. */
export interface NoteChatStatus {
  noteId: string;
  noteTitle: string;
  enabled: boolean;
  reason: NoteChatReason | null;
  shared: boolean;
  accessRole: 'owner' | 'view' | 'comment' | 'edit';
  accessLevel: number;
  canEdit: boolean;
  canManage: boolean;
  conversation: ChatConversation | null;
}

/** UI-only statuses are layered on top of the persisted edit statuses. */
export type ChatEditUiStatus = ChatEditStatus | 'applying' | 'conflict';

/** One edit as rendered in a message card. */
export interface ChatUiEdit extends Omit<ChatEditDto, 'status'> {
  status: ChatEditUiStatus;
  /** Local undo request in flight. */
  undoing?: boolean;
  /** Local failure detail when undo fails. */
  undoError?: string;
}

/** Tool event enriched with the target title while it streams. */
export interface ChatUiTool extends ChatToolActivity {
  title?: string;
  targetType?: ChatContextType;
  targetId?: string;
  /** Bounded server-supplied failure detail, shown only for failed calls. */
  error?: string;
}

/** A UI tool part carries the optional bounded failure detail. */
export type ChatUiToolPart = ChatUiTool & { type: 'tool' };

/** UI mirror of ChatPart so tool failure text survives the stream. */
export type ChatUiPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | ChatUiToolPart
  | { type: 'edit'; editId: string };

export interface ChatUiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: ChatUiTool[];
  parts?: ChatUiPart[];
  sources?: ChatSource[];
  edits?: ChatUiEdit[];
  context?: ChatContext | null;
  attachments?: ChatAttachmentRef[];
  /** Author of a user message in a shared note chat. */
  authorId?: string;
  authorLabel?: string;
  /** Token usage from the final model step that produced this answer. */
  usage?: ChatUsage;
  model?: string;
  streaming?: boolean;
  stopped?: boolean;
}

/** One locally selected file before/while it uploads. */
export interface PendingChatAttachment {
  localId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  kind: ChatAttachmentKind;
  status: 'uploading' | 'ready' | 'error';
  ref?: ChatAttachmentRef;
  error?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  /** Server-side hint for the pending-edit dot in history. */
  pending_edits?: number;
  /** Personal chats are author-owned; note chats are shared per note. */
  scope?: ChatScope;
  /** The note that owns a shared conversation. */
  documentId?: string;
  /** False when a shared-chat grantee cannot rename, delete, or undo. */
  canManage?: boolean;
}

export interface ChatError {
  message: string;
  code?: string;
  status?: number;
  /** The user text to resend with Try again. */
  retryText?: string;
}

export interface ChatUiState {
  conversationId: string | null;
  conversation: ChatConversation | null;
  messages: ChatUiMessage[];
  /** A stream is in progress. */
  active: boolean;
  /** True between clicking Stop and the reader closing. */
  stopping: boolean;
  error: ChatError | null;
  status: ChatStatusResponse | null;
  /** Selected enabled model for the next message; null uses the server default. */
  selectedModelId: string | null;
  statusLoading: boolean;
  statusError: string | null;
  conversations: ChatConversation[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  edits: ChatUiEdit[];
  editsLoading: boolean;
  mode: ChatMode;
  loadingConversation: boolean;
  loadedConversationId: string | null;
  /** Derived target while Nana is writing, mirrored into presence. */
  editing: {
    targetType?: ChatContextType;
    targetId?: string;
    title?: string;
  } | null;
  /** Conversations with a live edit, for the history dot. */
  pendingEditConversationIds: string[];
  /** Personal chat or the active note's shared chat. */
  scope: ChatScope;
  /** Shared-chat availability for the note currently open. */
  noteChatStatus: NoteChatStatus | null;
  noteChatLoading: boolean;
  noteChatError: string | null;
  /** Note whose status the dock last requested. */
  noteChatDocumentId: string | null;
}
