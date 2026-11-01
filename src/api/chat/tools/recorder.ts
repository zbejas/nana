import type { ChatEditContentChange, ChatEditDto, ChatSource } from "../types";

/**
 * One applied write plus the event-only body pair for document body edits.
 * The pair is deliberately kept out of the persisted `ChatEditDto`.
 */
export interface RecordedChatEdit {
    edit: ChatEditDto;
    contentChange?: ChatEditContentChange;
}

/**
 * Per-request collection of evidence:
 *
 * - `sources` are records a read tool actually returned, so the UI never has
 *   to trust model-invented links.
 * - `edits` are applied writes, drained by the SSE pump to emit `edit` cards
 *   and, for document body writes, the bounded before/after flash payload.
 */
export class ChatRunRecorder {
    private readonly sources = new Map<string, ChatSource>();
    private readonly pendingEdits: RecordedChatEdit[] = [];
    private readonly appliedEditIds: string[] = [];

    addSource(source: ChatSource): void {
        if (!source || (source.type !== "document" && source.type !== "board")) return;
        if (typeof source.id !== "string" || !source.id) return;
        const key = `${source.type}:${source.id}`;
        if (this.sources.has(key) || this.sources.size >= 50) return;
        this.sources.set(key, {
            type: source.type,
            id: source.id,
            title: typeof source.title === "string" && source.title.trim()
                ? source.title.trim().slice(0, 200)
                : source.type === "document" ? "Untitled note" : "Untitled board",
        });
    }

    addEdit(edit: ChatEditDto, contentChange?: ChatEditContentChange): void {
        this.pendingEdits.push({
            edit,
            ...(contentChange ? { contentChange } : {}),
        });
        this.appliedEditIds.push(edit.id);
    }

    /** Drains edits since the last call, in application order. */
    drainEdits(): RecordedChatEdit[] {
        return this.pendingEdits.splice(0, this.pendingEdits.length);
    }

    listSources(): ChatSource[] {
        return [...this.sources.values()];
    }

    editIds(): string[] {
        return [...this.appliedEditIds];
    }
}
