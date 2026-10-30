import {
    sanitizeChatUsage,
    type ChatEditDto,
    type ChatSource,
    type ChatToolActivity,
    type ChatToolStatus,
    type ChatUsage,
} from "./types";

/**
 * SSE encoding for the chat stream.
 *
 * Every logical event is written twice:
 *
 * 1. `event: <name>` + `data: { type, ... }` for the dock/agent client.
 * 2. A legacy AI-SDK UI chunk (`data: { type: "text-delta", ... }`) so the
 *    existing full-page chat keeps working without changes.
 *
 * The two clients ignore each other's shapes.
 */

export type ChatSseEventType =
    | "text"
    | "reasoning"
    | "tool"
    | "sources"
    | "edit"
    | "done"
    | "error";

export function sseEvent(type: ChatSseEventType, payload: Record<string, unknown>): string {
    return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

/** A legacy AI-SDK chunk with no `event:` name. */
export function legacyEvent(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

export function textEvent(delta: string, legacy = true): string {
    if (!delta) return "";
    return sseEvent("text", { delta })
        + (legacy ? legacyEvent({ type: "text-delta", id: "text", delta }) : "");
}

export function reasoningEvent(delta: string, legacy = true): string {
    if (!delta) return "";
    return sseEvent("reasoning", { delta })
        + (legacy ? legacyEvent({ type: "reasoning-delta", id: "reasoning", delta }) : "");
}

export interface ToolEventPayload {
    id: string;
    name: string;
    status: ChatToolStatus;
    error?: string;
}

export function toolEvent(payload: ToolEventPayload, legacy = true): string {
    const custom = sseEvent("tool", {
        id: payload.id,
        name: payload.name,
        status: payload.status,
        ...(payload.error ? { error: payload.error } : {}),
    });
    if (!legacy) return custom;

    if (payload.status === "running") {
        return custom + legacyEvent({
            type: "tool-input-start",
            toolCallId: payload.id,
            toolName: payload.name,
        });
    }
    if (payload.status === "error") {
        return custom + legacyEvent({
            type: "tool-output-error",
            toolCallId: payload.id,
            errorText: payload.error || "The tool failed.",
        });
    }
    return custom + legacyEvent({
        type: "tool-output-available",
        toolCallId: payload.id,
        output: { ok: true },
    });
}

export function sourcesEvent(sources: ChatSource[]): string {
    return sseEvent("sources", { sources });
}

interface StepUsageLike {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number };
    outputTokenDetails?: { reasoningTokens?: number };
}

/** Map one AI SDK step's usage into the persisted/client shape. */
export function stepUsage(usage: StepUsageLike | null | undefined): ChatUsage | null {
    if (!usage) return null;
    return sanitizeChatUsage({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
    });
}

export function editEvent(edit: ChatEditDto): string {
    return sseEvent("edit", { edit });
}

export function doneEvent(payload: {
    conversationId: string;
    messageId: string | null;
    stopped: boolean;
    model: string;
    sources: ChatSource[];
    usage?: ChatUsage | null;
}, legacy = true): string {
    const { usage, ...rest } = payload;
    const custom = sseEvent("done", {
        ...rest,
        ...(usage ? { usage } : {}),
    });
    if (!legacy) return custom;
    return custom
        + legacyEvent({ type: "finish" })
        + "data: [DONE]\n\n";
}

export function errorEvent(message: string, legacy = true): string {
    const custom = sseEvent("error", { message, errorText: message });
    if (!legacy) return custom;
    return custom + legacyEvent({ type: "error", errorText: message });
}

/**
 * Accumulates the streamed answer. The pump persists this state on normal
 * completion and on abort, so a stopped answer is never lost.
 */
export class ChatStreamState {
    text = "";
    reasoning = "";
    private readonly order: string[] = [];
    private readonly tools = new Map<string, { id: string; name: string; status: ChatToolStatus; error?: string }>();

    addText(delta: string): void {
        this.text += delta;
    }

    addReasoning(delta: string): void {
        this.reasoning += delta;
    }

    addToolStart(id: string, name: string): void {
        if (!id || !name) return;
        const existing = this.tools.get(id);
        if (existing) {
            existing.name = name;
            return;
        }
        this.order.push(id);
        this.tools.set(id, { id, name, status: "running" });
    }

    addToolResult(id: string, name: string, ok: boolean, error?: string): void {
        if (!id) return;
        this.addToolStart(id, name);
        const entry = this.tools.get(id);
        if (!entry) return;
        if (entry.status === "error") return;
        entry.status = ok ? "success" : "error";
        if (error) entry.error = error;
    }

    addToolError(id: string, name: string, error: string): void {
        if (!id) return;
        this.addToolStart(id, name);
        const entry = this.tools.get(id);
        if (!entry) return;
        entry.status = "error";
        entry.error = error;
    }

    toolEvents(): ToolEventPayload[] {
        return this.order
            .map((id) => this.tools.get(id))
            .filter((entry): entry is ToolEventPayload => Boolean(entry))
            .map(({ id, name, status, error }) => ({
                id,
                name,
                status,
                ...(error ? { error } : {}),
            }));
    }

    /** Collapse per-call statuses to the persisted name/status contract. */
    toolActivity(): ChatToolActivity[] {
        const byName = new Map<string, ChatToolActivity>();
        for (const event of this.toolEvents()) {
            const existing = byName.get(event.name);
            if (!existing || event.status === "error") {
                byName.set(event.name, {
                    name: event.name,
                    status: event.status === "running" ? "error" : event.status,
                });
            }
        }
        return [...byName.values()];
    }
}
