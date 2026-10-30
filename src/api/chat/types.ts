/**
 * Types for the chat API — request/response shapes and PocketBase record interfaces.
 */

/** Status shown for one tool invocation. */
export type ChatToolStatus = "running" | "success" | "error";

/** Chat is either read-only (`ask`) or write-capable (`edit`). */
export type ChatMode = "ask" | "edit";

/** The page the user had open when they sent the message. Metadata only. */
export type ChatContextType = "document" | "board" | "folder";

/** Client-supplied context. Never contains a title or body. */
export interface ChatContextInput {
    type: ChatContextType;
    id: string;
}

/** Server-resolved context persisted on the user message. */
export interface ChatContext extends ChatContextInput {
    title: string;
}

/** A read-tool record the UI may link to. Titles come from PocketBase. */
export interface ChatSource {
    type: "document" | "board";
    id: string;
    title: string;
}

/** Fixed copy persisted when the model produces no final text. */
export const CHAT_EMPTY_RESPONSE_FALLBACK =
    "I couldn't finish that answer. Try asking again, or narrow it to a specific note or board.";

/** Quiet tool activity attached to an assistant message. */
export interface ChatToolActivity {
    /** Streaming-only call id; persistence keeps only name and status. */
    id?: string;
    name: string;
    status: ChatToolStatus;
}

/** POST /api/chat/send request body */
export interface ChatSendRequest {
    /** Existing conversation ID, or omit to create a new one */
    conversationId?: string;
    /** The user's message text */
    message: string;
    /** `ask` (read-only, default) or `edit` (note/board write tools) */
    mode?: ChatMode;
    /** The page the user is viewing. Title and content are resolved server-side. */
    context?: ChatContextInput;
    /** When true, removes the previous assistant+user message pair before re-sending */
    regenerate?: boolean;
}

/** A single chat message shape returned by the chat API. */
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    /** Reasoning/thinking tokens from models that support extended thinking */
    reasoning?: string;
    /** Names/statuses of tools used for this response. No inputs or outputs. */
    tools?: ChatToolActivity[];
    /** The AI model that generated this message, e.g. "gpt-4o" or "gemma-4:e4b" */
    model?: string;
    /** Page context attached to a user message. */
    context?: ChatContext;
    /** Server-collected note/board links attached to an assistant message. */
    sources?: ChatSource[];
    /** True when the user stopped the stream before it finished. */
    stopped?: boolean;
}

/** PocketBase conversations record. Messages live in the `messages` collection. */
export interface PBConversation {
    id: string;
    title: string;
    author: string;
    created: string;
    updated: string;
}

/** One persisted chat message. */
export interface PBMessage {
    id: string;
    conversation: string;
    role: "user" | "assistant";
    content: string;
    reasoning?: string;
    model?: string;
    tools?: ChatToolActivity[];
    context?: ChatContext | null;
    sources?: ChatSource[] | null;
    stopped?: boolean;
    position: number;
    created: string;
}

/** PocketBase paginated list response */
export interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}

// ── Chat edits ───────────────────────────────────────────────────────

export type ChatEditTargetType = "document" | "board" | "task" | "folder";
/** `pending` actions require an explicit user confirmation before execution. */
export type ChatEditStatus = "pending" | "applied" | "undone" | "cancelled" | "failed";
export type ChatEditUndoKind = "trash" | "restore" | "none";

/** Where an AI write landed. `url` is generated from the target type. */
export interface ChatEditTarget {
    type: ChatEditTargetType;
    id: string;
    title: string;
    url: string;
}

export interface ChatEditSection {
    heading: string | null;
    path: string[];
    op: string;
    from: number;
    to: number;
}

export interface ChatEditChanges {
    sections?: ChatEditSection[];
    fields?: string[];
}

export interface ChatEditUndoInfo {
    kind: ChatEditUndoKind;
    available: boolean;
}

/** One applied write, as persisted in `chat_edits` and rendered as a card. */
export interface ChatEditDto {
    id: string;
    conversationId: string;
    messageId: string | null;
    target: ChatEditTarget;
    tool: string;
    summary: string;
    status: ChatEditStatus;
    actorType: "ai";
    actorLabel: string;
    changed: ChatEditChanges;
    undo: ChatEditUndoInfo;
    created: string;
    updated: string;
}

/** PocketBase chat_edits record. Server-written. */
export interface PBChatEdit {
    id: string;
    conversation: string;
    message?: string;
    actor?: string;
    actor_type: "user" | "ai" | "system";
    actor_label?: string;
    target_type: ChatEditTargetType;
    target_id: string;
    tool: string;
    summary?: string;
    operations?: unknown;
    status: ChatEditStatus;
    created: string;
    updated: string;
}

/** GET /api/chat/status response. Never contains credentials or base URLs. */
export interface ChatStatusResponse {
    configured: boolean;
    model: string | null;
    provider: string | null;
    local: boolean;
}
