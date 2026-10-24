/**
 * Types for the chat API — request/response shapes and PocketBase record interfaces.
 */

/** Status shown for one read-tool invocation. */
export type ChatToolStatus = "running" | "success" | "error";

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
    /** When true, removes the previous assistant+user message pair before re-sending */
    regenerate?: boolean;
}

/** A single chat message stored inline in a conversation's JSON field */
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    /** Reasoning/thinking tokens from models that support extended thinking */
    reasoning?: string;
    /** Names/statuses of read tools used for this response. No inputs or outputs. */
    tools?: ChatToolActivity[];
    /** The AI model that generated this message, e.g. "gpt-4o" or "gemma-4:e4b" */
    model?: string;
}

/** PocketBase conversations record (messages stored inline as JSON) */
export interface PBConversation {
    id: string;
    title: string;
    author: string;
    messages: ChatMessage[];
    created: string;
    updated: string;
}

/** PocketBase paginated list response */
export interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}
