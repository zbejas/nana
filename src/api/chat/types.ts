/**
 * Types for the chat API — request/response shapes and PocketBase record interfaces.
 */

/** POST /api/chat/send request body */
export interface ChatSendRequest {
    /** Existing conversation ID, or omit to create a new one */
    conversationId?: string;
    /** The user's message text */
    message: string;
    /** Whether to use RAG (document context retrieval). Defaults to true. */
    useRag?: boolean;
    /** Explicit document IDs to use as RAG context (from # mentions) */
    documentIds?: string[];
}

/** A document source referenced by RAG */
export interface ChatSource {
    id: string;
    title: string;
}

/** A single chat message stored inline in a conversation's JSON field */
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    /** Documents used as RAG context for this assistant message */
    sources?: ChatSource[];
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
