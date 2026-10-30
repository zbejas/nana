import type { ChatEditDto, ChatSource } from "../types";

/**
 * Per-request collection of evidence:
 *
 * - `sources` are records a read tool actually returned, so the UI never has
 *   to trust model-invented links.
 * - `edits` are applied writes, drained by the SSE pump to emit `edit` cards.
 */
export class ChatRunRecorder {
    private readonly sources = new Map<string, ChatSource>();
    private readonly pendingEdits: ChatEditDto[] = [];
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

    addEdit(edit: ChatEditDto): void {
        this.pendingEdits.push(edit);
        this.appliedEditIds.push(edit.id);
    }

    /** Drains edits since the last call, in application order. */
    drainEdits(): ChatEditDto[] {
        return this.pendingEdits.splice(0, this.pendingEdits.length);
    }

    listSources(): ChatSource[] {
        return [...this.sources.values()];
    }

    editIds(): string[] {
        return [...this.appliedEditIds];
    }
}
