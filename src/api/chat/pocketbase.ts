import { serverConfig } from "../../lib/config";
import { getSuperuserToken, invalidateSuperuserToken } from "./superuser";
import { sanitizeHtml } from "../../lib/sanitize";
import type { AIConfig } from "../../lib/ai/types";
import type { PBConversation, PBMessage, ChatMessage, ChatToolActivity, PBListResponse } from "./types";
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
 * Create a new conversation and persist its initial messages.
 */
export async function createConversation(
    authHeader: string,
    title: string,
    initialMessages: ChatMessage[] = []
): Promise<PBConversation> {
    const userId = await getUserIdFromAuth(authHeader);

    const conversation = await pbFetch<PBConversation>("/api/collections/conversations/records", authHeader, {
        method: "POST",
        body: JSON.stringify({ title, author: userId }),
    });

    for (const message of initialMessages) {
        await appendMessage(authHeader, conversation.id, message);
    }

    return conversation;
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

function messageFilter(conversationId: string): string {
    return encodeURIComponent(`conversation="${conversationId}"`);
}

/**
 * Touch the conversation so `updated` (and the sidebar order) reflects the
 * latest message. Messages are separate records now, so this cannot rely on a
 * JSON field write.
 */
async function touchConversation(authHeader: string, conversationId: string): Promise<void> {
    const conversation = await getConversation(authHeader, conversationId);
    await pbFetch<PBConversation>(
        `/api/collections/conversations/records/${encodeURIComponent(conversationId)}`,
        authHeader,
        {
            method: "PATCH",
            body: JSON.stringify({ title: conversation.title }),
        }
    );
}

async function nextMessagePosition(authHeader: string, conversationId: string): Promise<number> {
    const result = await pbFetch<PBListResponse<Pick<PBMessage, "position">>>(
        `/api/collections/messages/records?filter=${messageFilter(conversationId)}&sort=-position&perPage=1&fields=position`,
        authHeader
    );
    const last = result.items[0];
    return typeof last?.position === "number" ? last.position + 1 : 0;
}

/**
 * Append one message to a conversation.
 */
export async function appendMessage(
    authHeader: string,
    conversationId: string,
    message: ChatMessage
): Promise<PBMessage> {
    const sanitizedMessage = await sanitizeMessage(message);
    const position = await nextMessagePosition(authHeader, conversationId);

    const created = await pbFetch<PBMessage>("/api/collections/messages/records", authHeader, {
        method: "POST",
        body: JSON.stringify({
            conversation: conversationId,
            role: sanitizedMessage.role,
            content: sanitizedMessage.content,
            ...(sanitizedMessage.reasoning ? { reasoning: sanitizedMessage.reasoning } : {}),
            ...(sanitizedMessage.model ? { model: sanitizedMessage.model } : {}),
            ...(sanitizedMessage.tools?.length ? { tools: sanitizedMessage.tools } : {}),
            position,
        }),
    });

    await touchConversation(authHeader, conversationId);
    return created;
}

/**
 * Get every message in a conversation in display order.
 */
export async function getConversationMessages(
    authHeader: string,
    conversationId: string
): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    let page = 1;
    let totalPages = 1;

    do {
        const result = await pbFetch<PBListResponse<PBMessage>>(
            `/api/collections/messages/records?filter=${messageFilter(conversationId)}&sort=position,created&perPage=500&page=${page}`,
            authHeader
        );

        for (const row of result.items) {
            if (row.role !== "user" && row.role !== "assistant") continue;
            const message: ChatMessage = { role: row.role, content: row.content || "" };
            if (typeof row.reasoning === "string" && row.reasoning) message.reasoning = row.reasoning;
            if (typeof row.model === "string" && row.model) message.model = row.model;
            const tools = sanitizeTools(row.tools);
            if (tools.length > 0) message.tools = tools;
            messages.push(message);
        }

        totalPages = typeof result.totalPages === "number" && result.totalPages > 0
            ? result.totalPages
            : page;
        page += 1;
    } while (page <= totalPages && page <= 100);

    return messages;
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
    const result = await pbFetch<PBListResponse<PBMessage>>(
        `/api/collections/messages/records?filter=${messageFilter(conversationId)}&sort=-position,-created&perPage=50`,
        authHeader
    );
    // Newest first: remove trailing assistant messages, then the user turn.
    const messages = [...result.items];
    let index = 0;
    while (index < messages.length && messages[index]?.role === "assistant") {
        await deleteMessage(authHeader, messages[index]!.id);
        index += 1;
    }
    if (index < messages.length && messages[index]?.role === "user") {
        await deleteMessage(authHeader, messages[index]!.id);
    }

    await touchConversation(authHeader, conversationId);
}

async function deleteMessage(authHeader: string, messageId: string): Promise<void> {
    await pbFetch<void>(
        `/api/collections/messages/records/${encodeURIComponent(messageId)}`,
        authHeader,
        { method: "DELETE" }
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
