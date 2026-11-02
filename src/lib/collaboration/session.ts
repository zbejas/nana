/**
 * Ephemeral live-editing session.
 *
 * Yjs owns convergence. The server keeps one in-memory room per open note and
 * relays binary updates plus cursor presence over the existing same-origin
 * HTTP surface. The room owns content persistence and acknowledges durable
 * updates; this client never writes PocketBase content while the room is
 * connected.
 */

import * as Y from "yjs";
import { createLogger } from "../logger";
import { normalizeCollabMarkdown } from "./normalize";
import { applyOps, type CanonicalOp } from "./ops";
import { caretAssocForMarkdown, minimalTextChange } from "./text";
import { mergeConcurrentMarkdown } from "./merge";
import type {
    CollabAckFrame,
    CollabConflictFrame,
    CollabPersistencePhase,
    CollabStatusFrame,
} from "./protocol";

const logger = createLogger("Collab");

/** Transaction origins shared by the session, bindings, and tests. */
export const COLLAB_LOCAL_ORIGIN = "nana-collab-local";
export const COLLAB_REMOTE_ORIGIN = "nana-collab-remote";
export const COLLAB_RESET_ORIGIN = "nana-collab-reset";
const UPDATE_FLUSH_MS = 70;
const PRESENCE_FLUSH_MS = 120;
const HEARTBEAT_MS = 15_000;
const RECONNECT_MAX_MS = 10_000;
// A long-suspended tab can keep a dead SSE reader without ever firing an error.
// Re-open the stream on resume so the room's current Yjs state wins over the
// stale local replica. Short tab switches keep the existing connection.
const RESUME_RECONNECT_MS = 30_000;

export type CollabStatus = "connecting" | "connected" | "offline";

export interface CollabPresenceWire {
    clientId: string;
    userId: string;
    name: string;
    avatar: string;
    color: string;
    anchor: unknown;
    head: unknown;
    focused: boolean;
    updatedAt: number;
}

export interface CollabSelection {
    anchor: number;
    head: number;
    focused: boolean;
    /** Split mode has two editors; only the active one owns presence. */
    pane?: "source" | "wysiwyg";
}

export interface CollabPersistenceSnapshot {
    phase: CollabPersistencePhase;
    durableSeq: number;
    revision: number;
    conflict: CollabConflictFrame | null;
}

export interface CollabPersistenceContext {
    /** The room sequence last acknowledged by this client's own update POST. */
    lastLocalSeq: number;
    /** Local updates are queued or in flight and have not reached the room yet. */
    pendingLocalUpdates: boolean;
}

export interface CollabSessionOptions {
    documentId: string;
    initialContent: string;
    initialRevision?: number;
    getToken: () => string;
    onRemoteText: (text: string) => void;
    onPresence: (presence: CollabPresenceWire[]) => void;
    onStatus: (status: CollabStatus) => void;
    onPermission: (canEdit: boolean) => void;
    onPersistence?: (state: CollabPersistenceSnapshot) => void;
    onAck?: (frame: CollabAckFrame) => void;
    onConflict?: (frame: CollabConflictFrame) => void;
}

export function isCollabPersistencePhase(value: unknown): value is CollabPersistencePhase {
    return value === "clean"
        || value === "dirty"
        || value === "saving"
        || value === "error"
        || value === "conflict";
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Apply an acknowledgement. A stale ack (older than the last update this
 * client sent) leaves the note dirty; an ack that covers every local update
 * returns it to clean.
 */
export function reduceCollabAck(
    state: CollabPersistenceSnapshot,
    ack: CollabAckFrame,
    context: CollabPersistenceContext,
): CollabPersistenceSnapshot {
    const durableSeq = Math.max(state.durableSeq, ack.durableSeq);
    const revision = Math.max(state.revision, ack.revision);
    const unackedLocal = context.pendingLocalUpdates
        || context.lastLocalSeq > ack.durableSeq;
    if (unackedLocal) {
        return {
            phase: state.phase === "conflict" ? "conflict" : "dirty",
            durableSeq,
            revision,
            conflict: state.conflict,
        };
    }
    return { phase: "clean", durableSeq, revision, conflict: null };
}

/** Apply a server status frame, never letting a premature clean hide local work. */
export function reduceCollabStatus(
    state: CollabPersistenceSnapshot,
    status: CollabStatusFrame,
    context: CollabPersistenceContext,
): CollabPersistenceSnapshot {
    const revision = Math.max(state.revision, status.revision);
    const localStillPending = context.pendingLocalUpdates
        || context.lastLocalSeq > state.durableSeq;
    const phase = status.persistence === "clean" && localStillPending
        ? (state.phase === "conflict" ? "conflict" : "dirty")
        : status.persistence;
    return {
        phase,
        durableSeq: state.durableSeq,
        revision,
        conflict: phase === "clean" ? null : state.conflict,
    };
}

export function reduceCollabConflict(
    state: CollabPersistenceSnapshot,
    conflict: CollabConflictFrame,
): CollabPersistenceSnapshot {
    return {
        phase: "conflict",
        durableSeq: state.durableSeq,
        revision: Math.max(state.revision, conflict.revision),
        conflict,
    };
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Coarse origin of one canonical text transaction. */
export type CollabContentOrigin = "local" | "remote" | "reset";

/** One content transaction observed on the canonical `Y.Text`. */
export interface CollabContentChange {
    /** Canonical Markdown after the transaction. */
    readonly markdown: string;
    readonly origin: CollabContentOrigin;
    /** Raw Yjs origin, preserved for bindings that tag their own transactions. */
    readonly rawOrigin: unknown;
}

/** Classify a Yjs transaction origin without losing the original value. */
export function classifyCollabContentOrigin(origin: unknown): CollabContentOrigin {
    if (origin === COLLAB_REMOTE_ORIGIN) return "remote";
    if (origin === COLLAB_RESET_ORIGIN) return "reset";
    return "local";
}

export class CollabSession {
    readonly doc = new Y.Doc();
    readonly text: Y.Text;

    private clientId = "";
    private canEdit = false;
    private status: CollabStatus = "connecting";
    private destroyed = false;
    private abortController: AbortController | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private presenceTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private queuedUpdates: Uint8Array[] = [];
    private presence: CollabPresenceWire[] = [];
    private lastSelection: CollabSelection | null = null;
    private lastFocusedPane: "source" | "wysiwyg" | undefined;
    private lastRelativeSelection: {
        anchor: unknown;
        head: unknown;
        focused: boolean;
    } | null = null;
    private lastText = "";
    private synced = false;
    private applyingSync = false;
    private roomEpoch = "";
    private pendingLocalMarkdown: string;
    private persistenceState: CollabPersistenceSnapshot;
    private inflightUpdates = 0;
    private lastLocalSeq = 0;
    private pendingAck: CollabAckFrame | null = null;
    private hiddenAt: number | null = null;

    constructor(private readonly options: CollabSessionOptions) {
        this.text = this.doc.getText("content");
        this.pendingLocalMarkdown = normalizeCollabMarkdown(options.initialContent);
        const initialRevision = finiteNumber(options.initialRevision) ?? 0;
        this.persistenceState = {
            phase: "clean",
            durableSeq: 0,
            revision: initialRevision,
            conflict: null,
        };
        this.doc.on("update", this.handleUpdate);
    }

    get documentId(): string {
        return this.options.documentId;
    }

    get sessionId(): string {
        return this.clientId;
    }

    get editPermission(): boolean {
        return this.canEdit;
    }

    get currentStatus(): CollabStatus {
        return this.status;
    }

    get persistence(): CollabPersistencePhase {
        return this.persistenceState.phase;
    }

    get durableSeq(): number {
        return this.persistenceState.durableSeq;
    }

    get revision(): number {
        return this.persistenceState.revision;
    }

    get conflict(): CollabConflictFrame | null {
        return this.persistenceState.conflict;
    }

    get persistenceSnapshot(): CollabPersistenceSnapshot {
        return { ...this.persistenceState };
    }

    get markdown(): string {
        return this.text.toString();
    }

    get collaborators(): CollabPresenceWire[] {
        return this.presence;
    }

    start(): void {
        if (this.destroyed) return;
        void this.connect();
        this.heartbeatTimer = setInterval(() => this.flushPresence(), HEARTBEAT_MS);
        globalThis.addEventListener?.("blur", this.handleWindowBlur);
        globalThis.addEventListener?.("pagehide", this.handlePageHide);
        globalThis.addEventListener?.("pageshow", this.handlePageShow);
        globalThis.document?.addEventListener?.("visibilitychange", this.handleVisibilityChange);
    }

    /**
     * Re-open the room after a long suspension. The local replica is kept and
     * any unsent update is reconciled by the normal reconnect sync; this only
     * replaces a possibly dead SSE reader.
     */
    resume(): void {
        if (this.destroyed || !this.synced) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clientId = "";
        this.abortController?.abort();
        this.abortController = null;
        this.reconnectAttempt = 0;
        void this.connect();
    }

    /**
     * Fold a value that did not come from Yjs into the shared text. This covers
     * local typing, split-pane synchronization, and external writes such as an
     * AI edit or a PocketBase refresh.
     */
    applyLocalMarkdown(markdown: string): void {
        if (this.destroyed) return;
        const next = normalizeCollabMarkdown(markdown);
        if (!this.synced) {
            // The server owns the initial Yjs state. Applying the loaded note
            // before the first sync would create a second independent insert
            // and duplicate the whole document when the states merge.
            this.pendingLocalMarkdown = next;
            return;
        }
        // Viewers can watch the room but their local keystrokes must not enter
        // the shared replica. The editor shell also treats a non-edit grant as
        // read-only once the server has reported the permission.
        if (!this.canEdit) return;
        const current = this.text.toString();
        if (next === current) return;
        const change = minimalTextChange(current, next);
        if (!change) return;
        this.doc.transact(() => {
            if (change.to > change.from) {
                this.text.delete(change.from, change.to - change.from);
            }
            if (change.insert) {
                this.text.insert(change.from, change.insert);
            }
        }, COLLAB_LOCAL_ORIGIN);
    }

    /**
     * Apply ordered canonical operations directly to the shared text.
     *
     * Editor bindings use this instead of diffing a full Markdown snapshot.
     * Operations stay in the one canonical `Y.Text`; local transactions are
     * queued and acknowledged by the same persistence path as
     * `applyLocalMarkdown()`. Before the first sync the operations are folded
     * into the pending local draft, which the server sync then reconciles.
     */
    applyLocalOps(ops: readonly CanonicalOp[], origin: unknown = COLLAB_LOCAL_ORIGIN): void {
        if (this.destroyed || !Array.isArray(ops) || ops.length === 0) return;
        if (!this.synced) {
            this.pendingLocalMarkdown = applyOps(this.pendingLocalMarkdown, ops);
            return;
        }
        if (!this.canEdit) return;
        this.doc.transact(() => {
            applyOps(this.text, ops);
        }, origin);
    }

    /**
     * Subscribe to canonical text transactions. The listener receives the
     * post-transaction Markdown and the transaction origin, so a binding can
     * ignore changes it applied itself without diffing the whole document.
     * Returns an idempotent unsubscribe function.
     */
    observeContent(listener: (change: CollabContentChange) => void): () => void {
        if (this.destroyed || typeof listener !== "function") return () => {};
        const handler = (_update: Uint8Array, origin: unknown): void => {
            if (this.destroyed) return;
            listener({
                markdown: this.text.toString(),
                origin: classifyCollabContentOrigin(origin),
                rawOrigin: origin,
            });
        };
        this.doc.on("update", handler);
        return () => {
            this.doc.off("update", handler);
        };
    }

    sendSelection(selection: CollabSelection): void {
        if (this.destroyed) return;
        // Split mode has two editors. The inactive pane also reports a
        // selection whenever the shared value changes; only the pane the user
        // actually focused may own presence. Without this, a remote apply in
        // the other pane can move the peer's caret to the wrong place.
        if (!selection.focused) {
            if (selection.pane && this.lastFocusedPane && selection.pane !== this.lastFocusedPane) {
                return;
            }
            if (!selection.pane && this.lastSelection?.focused && globalThis.document?.hasFocus?.()) {
                return;
            }
        } else if (selection.pane) {
            this.lastFocusedPane = selection.pane;
        }

        this.lastSelection = selection;
        this.lastRelativeSelection = this.relativeSelectionFor(selection);
        if (!this.clientId) return;
        if (this.presenceTimer) return;
        this.presenceTimer = setTimeout(() => {
            this.presenceTimer = null;
            this.flushPresence();
        }, PRESENCE_FLUSH_MS);
    }

    private relativeSelectionFor(selection: CollabSelection): {
        anchor: unknown;
        head: unknown;
        focused: boolean;
    } | null {
        const max = Math.max(0, this.text.length);
        const anchor = Math.max(0, Math.min(selection.anchor, max));
        const head = Math.max(0, Math.min(selection.head, max));
        const collapsed = anchor === head;
        // A collapsed caret at a line end uses left affinity, so a peer
        // insertion at that boundary lands after the caret instead of pushing
        // it onto the inserted newline. Ranges keep a left anchor and a right
        // head, the conventional selection association.
        const assoc = collapsed ? caretAssocForMarkdown(this.text.toString(), head) : null;
        try {
            return {
                anchor: Y.createRelativePositionFromTypeIndex(
                    this.text,
                    anchor,
                    collapsed ? assoc! : -1,
                ),
                head: Y.createRelativePositionFromTypeIndex(
                    this.text,
                    head,
                    collapsed ? assoc! : 1,
                ),
                focused: selection.focused,
            };
        } catch {
            return null;
        }
    }

    /**
     * Re-resolve the cached relative selection after remote text changes it.
     * Yjs already tracks the position; rebuilding it refreshes the affinity
     * against the new line boundaries so a peer newline cannot leave a cached
     * right-associated caret at the old line end.
     */
    private reanchorPresence(): void {
        const previous = this.lastRelativeSelection;
        if (!previous) return;
        const resolve = (relative: unknown): number | null => {
            try {
                const absolute = Y.createAbsolutePositionFromRelativePosition(
                    relative as Y.RelativePosition,
                    this.doc,
                );
                return absolute ? absolute.index : null;
            } catch {
                return null;
            }
        };
        const anchor = resolve(previous.anchor);
        const head = resolve(previous.head);
        if (anchor === null || head === null) {
            this.lastRelativeSelection = null;
            return;
        }
        const collapsed = anchor === head;
        const assoc = collapsed
            ? caretAssocForMarkdown(this.text.toString(), head)
            : null;
        this.lastRelativeSelection = {
            anchor: Y.createRelativePositionFromTypeIndex(
                this.text,
                anchor,
                collapsed ? assoc! : -1,
            ),
            head: Y.createRelativePositionFromTypeIndex(
                this.text,
                head,
                collapsed ? assoc! : 1,
            ),
            focused: previous.focused,
        };
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.doc.off("update", this.handleUpdate);
        this.abortController?.abort();
        this.abortController = null;
        for (const timer of [this.reconnectTimer, this.updateTimer, this.presenceTimer]) {
            if (timer) clearTimeout(timer);
        }
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        globalThis.removeEventListener?.("blur", this.handleWindowBlur);
        globalThis.removeEventListener?.("pagehide", this.handlePageHide);
        globalThis.removeEventListener?.("pageshow", this.handlePageShow);
        globalThis.document?.removeEventListener?.("visibilitychange", this.handleVisibilityChange);
        this.reconnectTimer = null;
        this.updateTimer = null;
        this.presenceTimer = null;
        this.heartbeatTimer = null;
        this.queuedUpdates = [];
        this.inflightUpdates = 0;
        this.pendingAck = null;
        this.doc.destroy();
    }

    private handleWindowBlur = (): void => {
        if (!this.lastSelection) return;
        this.lastSelection = { ...this.lastSelection, focused: false };
        if (this.lastRelativeSelection) {
            this.lastRelativeSelection = { ...this.lastRelativeSelection, focused: false };
        }
        void this.flushPresence();
    };

    private handleVisibilityChange = (): void => {
        const doc = globalThis.document;
        if (!doc) return;
        if (doc.hidden) {
            this.hiddenAt = Date.now();
            return;
        }
        this.resumeAfterHidden();
    };

    private handlePageHide = (): void => {
        this.hiddenAt = Date.now();
    };

    private handlePageShow = (): void => {
        this.resumeAfterHidden();
    };

    private resumeAfterHidden(): void {
        const hiddenAt = this.hiddenAt;
        this.hiddenAt = null;
        if (hiddenAt === null || Date.now() - hiddenAt < RESUME_RECONNECT_MS) return;
        this.resume();
    }

    private handleUpdate = (update: Uint8Array, origin: unknown): void => {
        const next = this.text.toString();
        const changed = next !== this.lastText;
        this.lastText = next;

        if (origin === COLLAB_REMOTE_ORIGIN) {
            if (changed && !this.applyingSync && this.synced) {
                this.options.onRemoteText(next);
            }
            this.reanchorPresence();
            return;
        }
        if (origin === COLLAB_RESET_ORIGIN) return;

        this.queueUpdate(update);
    };

    private queueUpdate(update: Uint8Array): void {
        if (this.destroyed || !this.canEdit) return;
        this.queuedUpdates.push(update);
        this.markLocalDirty();
        if (this.updateTimer) return;
        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            void this.flushUpdates();
        }, UPDATE_FLUSH_MS);
    }

    private async flushUpdates(): Promise<void> {
        if (this.destroyed || !this.clientId || this.queuedUpdates.length === 0) return;
        const merged = Y.mergeUpdates(this.queuedUpdates);
        this.queuedUpdates = [];
        this.inflightUpdates += 1;
        try {
            const response = await fetch(
                `/api/v1/collab/documents/${encodeURIComponent(this.options.documentId)}/update`,
                {
                    method: "POST",
                    headers: {
                        Authorization: this.options.getToken(),
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({
                        clientId: this.clientId,
                        update: bytesToBase64(merged),
                    }),
                },
            );
            if (response.status === 409) {
                this.pendingAck = null;
                this.disconnectForRetry();
                return;
            }
            if (!response.ok) {
                // Keep the work locally; a later sync resends the state diff.
                this.pendingAck = null;
                this.queuedUpdates.unshift(merged);
                return;
            }
            try {
                const payload = (await response.json()) as unknown;
                const seq = isRecord(payload) ? finiteNumber(payload.seq) : null;
                if (seq !== null && seq >= 0) {
                    this.lastLocalSeq = Math.max(this.lastLocalSeq, seq);
                }
            } catch {
                // Older rooms return no sequence; the ack itself is sufficient.
            }
        } catch {
            this.pendingAck = null;
            this.queuedUpdates.unshift(merged);
            this.disconnectForRetry();
        } finally {
            this.inflightUpdates = Math.max(0, this.inflightUpdates - 1);
            this.settlePendingAck();
        }
    }

    private markLocalDirty(): void {
        if (this.persistenceState.phase === "conflict") return;
        this.setPersistenceState({
            ...this.persistenceState,
            phase: "dirty",
        });
    }

    private setPersistenceState(next: CollabPersistenceSnapshot): void {
        const previous = this.persistenceState;
        if (
            previous.phase === next.phase
            && previous.durableSeq === next.durableSeq
            && previous.revision === next.revision
            && previous.conflict === next.conflict
        ) {
            return;
        }
        this.persistenceState = next;
        this.options.onPersistence?.({ ...next });
    }

    private persistenceContext(): CollabPersistenceContext {
        return {
            lastLocalSeq: this.lastLocalSeq,
            pendingLocalUpdates: this.queuedUpdates.length > 0 || this.inflightUpdates > 0,
        };
    }

    private settlePendingAck(): void {
        const ack = this.pendingAck;
        if (!ack) return;
        if (this.queuedUpdates.length > 0 || this.inflightUpdates > 0) return;
        this.pendingAck = null;
        this.setPersistenceState(reduceCollabAck(
            this.persistenceState,
            ack,
            this.persistenceContext(),
        ));
    }

    private handleAck(ack: CollabAckFrame): void {
        this.options.onAck?.(ack);
        const next = reduceCollabAck(
            this.persistenceState,
            ack,
            this.persistenceContext(),
        );
        this.setPersistenceState(next);
        if (next.phase === "clean") {
            this.pendingAck = null;
            return;
        }
        // A response to an in-flight update can arrive after its ack. Keep the
        // ack until the POST sequence is known, then settle it.
        this.pendingAck = ack;
    }

    private handleStatus(status: CollabStatusFrame): void {
        this.setPersistenceState(reduceCollabStatus(
            this.persistenceState,
            status,
            this.persistenceContext(),
        ));
    }

    private handleConflict(conflict: CollabConflictFrame): void {
        this.pendingAck = null;
        this.setPersistenceState(reduceCollabConflict(this.persistenceState, conflict));
        this.options.onConflict?.(conflict);
    }

    private async flushPresence(): Promise<void> {
        const selection = this.lastSelection;
        const relative = this.lastRelativeSelection ?? (selection ? this.relativeSelectionFor(selection) : null);
        if (
            this.destroyed
            || !selection
            || !relative
            || !this.clientId
            || this.status !== "connected"
        ) {
            return;
        }

        try {
            await fetch(
                `/api/v1/collab/documents/${encodeURIComponent(this.options.documentId)}/presence`,
                {
                    method: "POST",
                    headers: {
                        Authorization: this.options.getToken(),
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({
                        clientId: this.clientId,
                        presence: {
                            anchor: relative.anchor,
                            head: relative.head,
                            focused: relative.focused,
                        },
                    }),
                },
            );
        } catch {
            // Presence is best-effort and must never interrupt typing.
        }
    }

    private setStatus(status: CollabStatus): void {
        if (this.status === status) return;
        this.status = status;
        this.options.onStatus(status);
    }

    private async connect(): Promise<void> {
        if (this.destroyed) return;
        if (this.abortController) this.abortController.abort();
        const controller = new AbortController();
        this.abortController = controller;
        this.setStatus("connecting");

        try {
            const response = await fetch(
                `/api/v1/collab/documents/${encodeURIComponent(this.options.documentId)}/events`,
                {
                    headers: {
                        Authorization: this.options.getToken(),
                        Accept: "text/event-stream",
                    },
                    signal: controller.signal,
                },
            );

            if (!response.ok || !response.body) {
                throw new Error(`live session rejected (${response.status})`);
            }

            this.reconnectAttempt = 0;
            await this.readStream(response.body);
            if (!this.destroyed && !controller.signal.aborted) {
                this.disconnectForRetry();
            }
        } catch (error) {
            if (this.destroyed || controller.signal.aborted) return;
            logger.debug("Live session disconnected", {
                documentId: this.options.documentId,
                error: error instanceof Error ? error.message : String(error),
            });
            this.disconnectForRetry();
        }
    }

    private disconnectForRetry(): void {
        if (this.destroyed) return;
        this.clientId = "";
        this.setStatus("offline");
        this.abortController?.abort();
        this.abortController = null;
        if (this.reconnectTimer) return;
        const delay = Math.min(RECONNECT_MAX_MS, 750 * 2 ** this.reconnectAttempt);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, delay);
    }

    private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!this.destroyed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                this.handleFrame(frame);
                boundary = buffer.indexOf("\n\n");
            }
        }
    }

    private handleFrame(frame: string): void {
        const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
        if (!data) return;

        let event: Record<string, unknown>;
        try {
            const parsed = JSON.parse(data) as unknown;
            if (!isRecord(parsed)) return;
            event = parsed;
        } catch {
            return;
        }

        const type = event.type;
        if (type === "sync") {
            this.handleSync(event);
            return;
        }
        if (type === "ack") {
            const durableSeq = finiteNumber(event.durableSeq);
            const revision = finiteNumber(event.revision);
            if (durableSeq === null || revision === null) return;
            this.handleAck({
                type: "ack",
                durableSeq,
                revision,
                savedAt: typeof event.savedAt === "string" ? event.savedAt : "",
            });
            return;
        }
        if (type === "status") {
            if (!isCollabPersistencePhase(event.persistence)) return;
            const revision = finiteNumber(event.revision);
            if (revision === null) return;
            this.handleStatus({
                type: "status",
                persistence: event.persistence,
                revision,
                ...(typeof event.message === "string" ? { message: event.message } : {}),
            });
            return;
        }
        if (type === "conflict") {
            const revision = finiteNumber(event.revision);
            if (revision === null) return;
            const reason = event.reason === "merge" ? "merge" : "revision";
            this.handleConflict({
                type: "conflict",
                revision,
                reason,
                ...(typeof event.serverMarkdown === "string"
                    ? { serverMarkdown: event.serverMarkdown }
                    : {}),
            });
            return;
        }
        if (type === "permission") {
            if (typeof event.canEdit !== "boolean") return;
            this.canEdit = event.canEdit;
            this.options.onPermission(event.canEdit);
            return;
        }
        if (type === "update" && typeof event.update === "string") {
            try {
                Y.applyUpdate(this.doc, base64ToBytes(event.update), COLLAB_REMOTE_ORIGIN);
            } catch {
                // A malformed frame is ignored; the next sync repairs state.
            }
            return;
        }
        if (type === "presence") {
            const presence = event as unknown as CollabPresenceWire;
            if (!presence.clientId) return;
            this.presence = [
                ...this.presence.filter((entry) => entry.clientId !== presence.clientId),
                presence,
            ];
            this.options.onPresence(this.presence);
            return;
        }
        if (type === "presence-leave" && typeof event.clientId === "string") {
            this.presence = this.presence.filter((entry) => entry.clientId !== event.clientId);
            this.options.onPresence(this.presence);
        }
    }

    private handleSync(event: Record<string, unknown>): void {
        if (typeof event.clientId !== "string") return;
        const epoch = typeof event.epoch === "string" ? event.epoch : "";
        const roomChanged = Boolean(this.roomEpoch && epoch && epoch !== this.roomEpoch);
        if (epoch) this.roomEpoch = epoch;
        const syncRevision = finiteNumber(event.revision);
        const syncDurableSeq = finiteNumber(event.durableSeq);
        const syncPhase = isCollabPersistencePhase(event.persistence)
            ? event.persistence
            : null;

        const firstSync = !this.synced || roomChanged;
        const beforeSync = this.text.toString();
        const localDraft = roomChanged ? beforeSync : this.pendingLocalMarkdown;
        this.clientId = event.clientId;
        this.canEdit = event.canEdit === true;
        if (firstSync) {
            // A new room starts a new sequence space. Local drafts will be
            // queued below and immediately mark the note dirty again.
            this.lastLocalSeq = 0;
            this.pendingAck = null;
            this.setPersistenceState({
                phase: syncPhase ?? "clean",
                durableSeq: syncDurableSeq ?? 0,
                revision: syncRevision ?? this.persistenceState.revision,
                conflict: null,
            });
        } else if (syncRevision !== null || syncDurableSeq !== null || syncPhase !== null) {
            let next: CollabPersistenceSnapshot = {
                ...this.persistenceState,
                durableSeq: syncDurableSeq !== null
                    ? Math.max(this.persistenceState.durableSeq, syncDurableSeq)
                    : this.persistenceState.durableSeq,
                revision: syncRevision !== null
                    ? Math.max(this.persistenceState.revision, syncRevision)
                    : this.persistenceState.revision,
            };
            if (syncPhase !== null) {
                next = reduceCollabStatus(
                    next,
                    {
                        type: "status",
                        persistence: syncPhase,
                        revision: next.revision,
                    },
                    this.persistenceContext(),
                );
            }
            this.setPersistenceState(next);
        }
        if (Array.isArray(event.presence)) {
            this.presence = event.presence.filter(isRecord) as unknown as CollabPresenceWire[];
        } else {
            this.presence = [];
        }

        if (roomChanged) {
            // The server dropped the old room and seeded a new Y.Doc from the
            // saved note. Clear the stale replica so the two seeds cannot both
            // survive as independent insertions. Relative presence positions
            // from the old replica no longer point into this text.
            this.queuedUpdates = [];
            this.lastRelativeSelection = null;
            this.doc.transact(() => {
                if (this.text.length > 0) this.text.delete(0, this.text.length);
            }, COLLAB_RESET_ORIGIN);
        }

        this.applyingSync = true;
        if (typeof event.update === "string") {
            try {
                Y.applyUpdate(this.doc, base64ToBytes(event.update), COLLAB_REMOTE_ORIGIN);
            } catch {
                logger.warn("Live session sync was malformed", { documentId: this.options.documentId });
            }
        }
        this.applyingSync = false;

        const serverText = this.text.toString();
        if (firstSync) {
            this.synced = true;
            let target: string;
            if (roomChanged) {
                // Keep the writer's unsaved draft; the new room was seeded from
                // the last persisted body and has no shared history with the
                // replica that was just cleared.
                target = localDraft || serverText;
            } else {
                // The server seeded the document, so the local draft is folded
                // in once here instead of being inserted independently before.
                const base = normalizeCollabMarkdown(this.options.initialContent);
                target = localDraft;
                if (localDraft === base) {
                    target = serverText;
                } else if (serverText !== base) {
                    target = mergeConcurrentMarkdown(base, localDraft, serverText);
                }
            }
            this.pendingLocalMarkdown = target;
            this.applyLocalMarkdown(target);
            if (target !== localDraft) {
                this.options.onRemoteText(target);
            }
        } else if (this.canEdit && typeof event.stateVector === "string") {
            // Reconnect: push whatever the room did not have, including edits
            // made while the stream was offline.
            try {
                const diff = Y.encodeStateAsUpdate(this.doc, base64ToBytes(event.stateVector));
                if (diff.byteLength > 2) {
                    this.queuedUpdates = [diff];
                    void this.flushUpdates();
                }
            } catch {
                // A stale vector is harmless; the next local edit syncs.
            }
        }
        if (!firstSync && serverText !== beforeSync) {
            this.options.onRemoteText(serverText);
        }

        this.setStatus("connected");
        this.reconnectAttempt = 0;
        this.options.onPermission(this.canEdit);
        this.options.onPresence(this.presence);
        if (this.lastSelection) this.flushPresence();
    }
}
