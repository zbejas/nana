import { serverConfig } from "../../lib/config";
import { getSuperuserToken, invalidateSuperuserToken } from "./superuser";
import { sanitizeHtml } from "../../lib/sanitize";
import type { AIConfig } from "../../lib/ai/types";
import type { PBConversation, ChatMessage, ChatToolActivity, PBListResponse } from "./types";
import { CHAT_TOOL_NAMES } from "./tools";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

const ALLOWED_TOOLS = new Set<string>(CHAT_TOOL_NAMES);
const ALLOWED_TOOL_STATUSES = new Set(["success", "error"]);

/** PocketBase REST failure with the upstream status preserved for handlers. */
export class PocketBaseRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "PocketBaseRequestError";
        this.status = status;
    }
}

/**
 * Generic PocketBase REST fetch helper.
 * Throws on non-OK responses with the error body.
 */
async function pbFetch<T>(path: string, authHeader: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${POCKETBASE_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            ...options?.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new PocketBaseRequestError(
            response.status,
            `PocketBase ${options?.method || "GET"} ${path} failed (${response.status}): ${errorText}`,
        );
    }

    // DELETE returns 204 with no body
    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
}

// ── AI Config (uses superuser token) ─────────────────────────────────

/**
 * Fetch the AI configuration from the admin-only settings collection.
 * Uses the auto-provisioned superuser token.
 */
export async function fetchAIConfig(): Promise<AIConfig> {
    const token = await getSuperuserToken();

    try {
        const result = await pbFetch<PBListResponse<{ id: string; key: string; value: AIConfig }>>(
            `/api/collections/settings/records?filter=key="ai_config"&perPage=1`,
            token
        );

        const item = result.items[0];
        if (!item) {
            throw new Error("AI config not found in settings collection");
        }

        return item.value;
    } catch (err) {
        // If 401/403, invalidate cached token and retry once
        if (err instanceof PocketBaseRequestError && (err.status === 401 || err.status === 403)) {
            invalidateSuperuserToken();
            const freshToken = await getSuperuserToken();
            const result = await pbFetch<PBListResponse<{ id: string; key: string; value: AIConfig }>>(
                `/api/collections/settings/records?filter=key="ai_config"&perPage=1`,
                freshToken
            );
            const retryItem = result.items[0];
            if (!retryItem) {
                throw new Error("AI config not found in settings collection");
            }
            return retryItem.value;
        }
        throw err;
    }
}

// ── Conversations ────────────────────────────────────────────────────

/**
 * Allowlist persisted tool activity. Only the tool name and a terminal status
 * survive; call ids, arguments, outputs and arbitrary model fields are dropped.
 */
function sanitizeTools(value: unknown): ChatToolActivity[] {
    if (!Array.isArray(value)) return [];

    const byName = new Map<string, ChatToolActivity>();

    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const { name, status } = entry as { name?: unknown; status?: unknown };
        if (typeof name !== "string" || !ALLOWED_TOOLS.has(name)) continue;
        if (typeof status !== "string" || !ALLOWED_TOOL_STATUSES.has(status)) continue;

        const nextStatus = status as ChatToolActivity["status"];
        const existing = byName.get(name);
        if (!existing || nextStatus === "error") {
            byName.set(name, { name, status: nextStatus });
        }
    }

    return [...byName.values()];
}

/**
 * Build a safe stored message: keep only known fields and sanitize content.
 * Older stored messages may contain extra fields (for example `sources`); they
 * are tolerated on read and simply not written back.
 */
async function sanitizeMessage(msg: ChatMessage): Promise<ChatMessage> {
    const sanitized: ChatMessage = {
        role: msg.role,
        content: await sanitizeHtml(msg.content),
    };

    if (typeof msg.reasoning === "string" && msg.reasoning) {
        sanitized.reasoning = msg.reasoning;
    }
    if (typeof msg.model === "string" && msg.model) {
        sanitized.model = msg.model;
    }

    const tools = sanitizeTools(msg.tools);
    if (tools.length > 0) {
        sanitized.tools = tools;
    }

    return sanitized;
}

/**
 * Sanitize the content of each ChatMessage before persisting.
 */
async function sanitizeMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
    return Promise.all(messages.map(sanitizeMessage));
}

/**
 * Create a new conversation with initial messages.
 */
export async function createConversation(
    authHeader: string,
    title: string,
    initialMessages: ChatMessage[] = []
): Promise<PBConversation> {
    const userId = await getUserIdFromAuth(authHeader);
    const sanitizedMessages = await sanitizeMessages(initialMessages);

    return pbFetch<PBConversation>("/api/collections/conversations/records", authHeader, {
        method: "POST",
        body: JSON.stringify({ title, author: userId, messages: sanitizedMessages }),
    });
}

/**
 * List all conversations for the authenticated user, sorted by most recent first.
 */
export async function listConversations(authHeader: string): Promise<PBConversation[]> {
    const result = await pbFetch<PBListResponse<PBConversation>>(
        "/api/collections/conversations/records?sort=-updated&perPage=100",
        authHeader
    );
    return result.items;
}

/**
 * Get a single conversation by ID.
 */
export async function getConversation(authHeader: string, conversationId: string): Promise<PBConversation> {
    return pbFetch<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader
    );
}

/**
 * Update a conversation's title.
 */
export async function updateConversationTitle(
    authHeader: string,
    conversationId: string,
    title: string
): Promise<PBConversation> {
    return pbFetch<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
        {
            method: "PATCH",
            body: JSON.stringify({ title }),
        }
    );
}

/**
 * Append a message to a conversation's messages JSON array.
 */
export async function appendMessage(
    authHeader: string,
    conversationId: string,
    message: ChatMessage
): Promise<PBConversation> {
    // Sanitize the message content before persisting
    const sanitizedMessage = await sanitizeMessage(message);

    // Fetch current messages, append, and save
    const conv = await getConversation(authHeader, conversationId);
    const messages = [...(conv.messages || []), sanitizedMessage];

    return pbFetch<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
        {
            method: "PATCH",
            body: JSON.stringify({ messages }),
        }
    );
}

/**
 * Get the messages array from a conversation.
 */
export async function getConversationMessages(
    authHeader: string,
    conversationId: string
): Promise<ChatMessage[]> {
    const conv = await getConversation(authHeader, conversationId);
    return conv.messages || [];
}

/**
 * Remove the last user+assistant exchange from a conversation.
 * Used for regeneration — trims from the end until one assistant
 * and one user message have been removed.
 */
export async function trimLastExchange(
    authHeader: string,
    conversationId: string
): Promise<void> {
    const conv = await getConversation(authHeader, conversationId);
    const messages = [...(conv.messages || [])];

    // Remove trailing assistant message(s)
    while (messages.length > 0 && messages.at(-1)?.role === 'assistant') {
        messages.pop();
    }
    // Remove the last user message
    if (messages.length > 0 && messages.at(-1)?.role === 'user') {
        messages.pop();
    }

    await pbFetch<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
        {
            method: "PATCH",
            body: JSON.stringify({ messages }),
        }
    );
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(authHeader: string, conversationId: string): Promise<void> {
    await pbFetch<void>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
        { method: "DELETE" }
    );
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract user ID from an auth header by calling PocketBase's auth-refresh.
 */
async function getUserIdFromAuth(authHeader: string): Promise<string> {
    const response = await fetch(`${POCKETBASE_URL}/api/collections/users/auth-refresh`, {
        method: "POST",
        headers: { Authorization: authHeader },
    });

    if (!response.ok) {
        throw new Error("Failed to resolve user identity from auth header");
    }

    const data = (await response.json()) as { record?: { id?: string } };
    const userId = data.record?.id;

    if (!userId) {
        throw new Error("Could not extract user ID from auth response");
    }

    return userId;
}
