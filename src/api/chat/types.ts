/**
 * Types for the chat API — request/response shapes and PocketBase record interfaces.
 */

import type { AIChatAttachmentSettings, AIChatModelOption } from "../../lib/ai/types";

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

/** The server-classified attachment kind. SVG and other formats are rejected. */
export type ChatAttachmentKind = "image" | "pdf" | "text";

/**
 * Safe attachment metadata returned by the chat API. Extracted text and the
 * stored file name are deliberately absent; both stay server-side.
 */
export interface ChatAttachmentRef {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    kind: ChatAttachmentKind;
}

const ATTACHMENT_KINDS = new Set<ChatAttachmentKind>(["image", "pdf", "text"]);

/**
 * Reduce a stored/PocketBase attachment shape to the safe client DTO. Unknown
 * fields, the protected file name, and extracted text are always dropped.
 */
export function sanitizeAttachmentRef(value: unknown): ChatAttachmentRef | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;

    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return null;

    const kind = source.kind;
    if (typeof kind !== "string" || !ATTACHMENT_KINDS.has(kind as ChatAttachmentKind)) return null;

    const rawName = typeof source.name === "string" ? source.name : "";
    const name = rawName
        .replace(/[\\/\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 255) || "Attachment";

    const rawMime = typeof source.mimeType === "string"
        ? source.mimeType
        : typeof source.mime_type === "string"
            ? source.mime_type
            : "";
    const mimeType = rawMime.trim().toLowerCase().slice(0, 120);
    if (!mimeType) return null;

    const rawSize = source.size;
    const size = typeof rawSize === "number" ? rawSize : Number(rawSize);
    if (!Number.isFinite(size) || size < 0) return null;

    return { id, name, mimeType, size, kind: kind as ChatAttachmentKind };
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

/** One tool call as it appeared in the assistant turn. */
export interface ChatToolPart extends ChatToolActivity {
    type: "tool";
    /** Optional resolved record title, kept only for display. */
    title?: string;
    targetType?: ChatContextType;
    targetId?: string;
}

/**
 * One ordered piece of an assistant turn. Text and tool calls interleave so the
 * transcript can show what Nana did at the point it happened instead of
 * collecting every call at the top of the answer.
 */
export type ChatPart =
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
    | ChatToolPart
    | { type: "edit"; editId: string };

/**
 * Token accounting for one completed assistant turn. `inputTokens` is the
 * final model step's prompt size, so `totalTokens` approximates the context
 * carried into the next turn. This is deliberately not the sum of every tool
 * step, which would count the same history repeatedly.
 */
export interface ChatUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
}

const MAX_USAGE_TOKENS = 100_000_000;

function usageToken(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const token = Math.trunc(value);
    if (token < 0 || token > MAX_USAGE_TOKENS) return null;
    return token;
}

/** Reduce provider/stored usage to a bounded, optional assistant message field. */
export function sanitizeChatUsage(value: unknown): ChatUsage | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const inputTokens = usageToken(source.inputTokens);
    const outputTokens = usageToken(source.outputTokens);
    const totalTokens = usageToken(source.totalTokens);

    if (inputTokens === null && outputTokens === null && totalTokens === null) return null;

    const input = inputTokens ?? 0;
    const output = outputTokens ?? 0;
    const total = Math.max(totalTokens ?? 0, input + output);
    const reasoningTokens = usageToken(source.reasoningTokens);
    const cachedInputTokens = usageToken(source.cachedInputTokens);

    return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        ...(reasoningTokens !== null ? { reasoningTokens } : {}),
        ...(cachedInputTokens !== null ? { cachedInputTokens } : {}),
    };
}

/** POST /api/chat/send request body */
export interface ChatSendRequest {
    /** Existing conversation ID, or omit to create a new one */
    conversationId?: string;
    /** The user's message text. May be empty when attachments are present. */
    message: string;
    /** Uploaded draft attachment ids, in display order. */
    attachmentIds?: string[];
    /** Enabled model id from `GET /api/chat/status`; omitted uses the default. */
    modelId?: string;
    /** `ask` (read-only, default) or `edit` (note/board write tools) */
    mode?: ChatMode;
    /** The page the user is viewing. Title and content are resolved server-side. */
    context?: ChatContextInput;
    /** When true, removes the previous assistant+user message pair before re-sending */
    regenerate?: boolean;
}

/** A single chat message shape returned by the chat API. */
export interface ChatMessage {
    /** PocketBase message id when loaded from storage. */
    id?: string;
    role: "user" | "assistant";
    content: string;
    /** Reasoning/thinking tokens from models that support extended thinking */
    reasoning?: string;
    /** Names/statuses of tools used for this response. No inputs or outputs. */
    tools?: ChatToolActivity[];
    /** Ordered text, reasoning, tool, and edit parts for chronological rendering. */
    parts?: ChatPart[];
    /** The AI model that generated this message, e.g. "gpt-4o" or "gemma-4:e4b" */
    model?: string;
    /** Page context attached to a user message. */
    context?: ChatContext;
    /** Server-validated file metadata attached to a user message. */
    attachments?: ChatAttachmentRef[];
    /** Server-collected note/board links attached to an assistant message. */
    sources?: ChatSource[];
    /** Token usage for the final model step that produced this answer. */
    usage?: ChatUsage;
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
    parts?: ChatPart[] | null;
    context?: ChatContext | null;
    attachments?: ChatAttachmentRef[] | null;
    sources?: ChatSource[] | null;
    usage?: ChatUsage | null;
    stopped?: boolean;
    position: number;
    created: string;
}

/** PocketBase chat_attachments record. `text` and `file` never leave the server. */
export interface PBChatAttachment {
    id: string;
    collectionId?: string;
    collectionName?: string;
    author: string;
    conversation?: string;
    message?: string;
    file?: string | string[];
    name: string;
    mime_type: string;
    size: number;
    kind: ChatAttachmentKind;
    text?: string;
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

/** GET /api/chat/status response. Never contains credentials, base URLs, or model connection internals. */
export interface ChatStatusResponse {
    configured: boolean;
    model: string | null;
    provider: string | null;
    local: boolean;
    /** New multi-model fields stay optional so older clients keep compiling. */
    defaultModelId?: string | null;
    models?: AIChatModelOption[];
    limits?: AIChatAttachmentSettings;
}
