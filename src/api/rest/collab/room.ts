import * as Y from "yjs";
import { serverConfig } from "../../../lib/config";
import { createLogger } from "../../../lib/logger";
import {
    COLLAB_PROTOCOL,
    type CollabAckFrame,
    type CollabConflictFrame,
    type CollabPersistencePhase,
    type CollabStatusFrame,
} from "../../../lib/collaboration/protocol";
import { normalizeCollabMarkdown } from "../../../lib/collaboration/normalize";
import { isRevisionConflict, mergeConcurrentMarkdown } from "../../../lib/collaboration/merge";
import { minimalTextChange } from "../../../lib/collaboration/text";

const log = createLogger("CollabRoom");

/** A room with no viewers is kept briefly so a refresh does not lose state. */
const ROOM_IDLE_MS = 45_000;
const MAX_BASE64_UPDATE_LENGTH = 8 * 1024 * 1024;

/** Content writes are debounced, but never postponed past this window. */
const PERSIST_DEBOUNCE_MS = 800;
const PERSIST_MAX_WAIT_MS = 5_000;
const PATCH_TIMEOUT_MS = 15_000;
const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_RECONCILE_ATTEMPTS = 3;

const PRESENCE_COLORS = [
    "#ff7a54",
    "#e3b25f",
    "#74c69d",
    "#58a6ff",
    "#ab7df8",
    "#f85149",
] as const;

/** Server-originated Yjs transactions are not attributed to a client. */
const SERVER_ORIGIN = Symbol("nana-collab-server");

export interface CollabIdentity {
    userId: string;
    name: string;
    avatar: string;
    /** Effective edit permission at connection time. */
    canEdit: boolean;
}

export interface CollabPresenceInput {
    anchor: Record<string, unknown>;
    head: Record<string, unknown>;
    focused: boolean;
}

export interface CollabPresence extends CollabPresenceInput {
    clientId: string;
    userId: string;
    name: string;
    avatar: string;
    color: string;
    updatedAt: number;
}

/** Everything the room needs to write the document body itself. */
export interface CollabRoomSeed {
    /** The caller's PocketBase session token. Never a superuser token. */
    token: string;
    revision: number;
}

interface ProtocolEnvelope {
    protocol: typeof COLLAB_PROTOCOL;
    documentId: string;
    epoch: string;
}

type CollabEvent =
    | ({
        type: "sync";
        clientId: string;
        update: string;
        stateVector: string;
        presence: CollabPresence[];
        canEdit: boolean;
        epoch: string;
        durableSeq: number;
        revision: number;
        persistence: CollabPersistencePhase;
    } & Omit<ProtocolEnvelope, "epoch">)
    | ({
        type: "update";
        clientId: string;
        update: string;
        seq: number;
        source: "user" | "system";
    } & ProtocolEnvelope)
    | ({ type: "presence" } & CollabPresence & ProtocolEnvelope)
    | ({ type: "presence-leave"; clientId: string } & ProtocolEnvelope)
    | (CollabAckFrame & ProtocolEnvelope)
    | (CollabStatusFrame & ProtocolEnvelope)
    | (CollabConflictFrame & ProtocolEnvelope);

interface ClientConnection extends CollabIdentity {
    clientId: string;
    color: string;
    /** The token supplied when this client opened or published an update. */
    token: string;
    send: (event: CollabEvent) => void;
}

interface LatestDocument {
    content: string;
    revision: number;
}

type PatchResult =
    | { ok: true; revision: number }
    | { ok: false; conflict: boolean; message: string };

function colorForUser(userId: string): string {
    let hash = 0;
    for (let index = 0; index < userId.length; index += 1) {
        hash = (hash * 31 + userId.charCodeAt(index)) | 0;
    }
    return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
}

function isRelativeId(value: unknown): boolean {
    if (value === null) return true;
    if (!value || typeof value !== "object") return false;
    const id = value as Record<string, unknown>;
    return Number.isFinite(id.client) && Number.isFinite(id.clock);
}

export function isRelativePosition(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.tname === "string"
        && Number.isFinite(candidate.assoc)
        && isRelativeId(candidate.type)
        && isRelativeId(candidate.item);
}

/** The persisted body contract matches `saveDocumentWithMerge`. */
function persistedContent(value: string): string {
    return normalizeCollabMarkdown(value).trim();
}

function recordPath(documentId: string): string {
    return `${serverConfig.pocketbaseUrl}/api/collections/documents/records/${encodeURIComponent(documentId)}`;
}

function jsonHeaders(token: string): HeadersInit {
    return {
        Authorization: token,
        Accept: "application/json",
        "Content-Type": "application/json",
    };
}

async function readErrorBody(response: Response): Promise<Record<string, unknown>> {
    try {
        const body = (await response.json()) as unknown;
        return body && typeof body === "object" && !Array.isArray(body)
            ? body as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

/**
 * One live document. Yjs is the merge engine and the room is the durable
 * content writer: clients publish updates, the room debounces a PocketBase
 * PATCH, and every writer observes an acknowledgement or a conflict.
 *
 * Title, tags, folder, and privacy stay with the normal editor save path;
 * persistence here is content-only.
 */
export class CollabRoom {
    private readonly doc = new Y.Doc();
    private readonly text: Y.Text;
    private readonly clients = new Map<string, ClientConnection>();
    private readonly presence = new Map<string, CollabPresence>();
    /** Identifies this in-memory incarnation so clients can reset after a restart. */
    readonly epoch = crypto.randomUUID();
    private seq = 0;
    private durableSeq = 0;
    private revision: number;
    private persistence: CollabPersistencePhase = "clean";
    /** The body the room knows is stored in PocketBase. */
    private lastPersistedContent: string;
    /** Token used for the next write; always the caller's own session token. */
    private persistenceToken: string;
    private flushDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private flushMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    private flushing: Promise<void> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(
        readonly documentId: string,
        initialContent: string,
        seed: CollabRoomSeed,
    ) {
        this.text = this.doc.getText("content");
        this.text.insert(0, normalizeCollabMarkdown(initialContent));
        this.revision = Number.isFinite(seed.revision) ? seed.revision : 0;
        this.lastPersistedContent = persistedContent(initialContent);
        this.persistenceToken = seed.token;
        this.doc.on("update", (update: Uint8Array, origin: unknown) => {
            if (typeof origin === "string") {
                // Client edits are relayed exactly as before and now start the
                // debounced content write.
                if (!this.clients.has(origin)) return;
                this.seq += 1;
                this.broadcast({
                    type: "update",
                    clientId: origin,
                    update: Buffer.from(update).toString("base64"),
                    seq: this.seq,
                    source: "user",
                    ...this.envelope(),
                }, origin);
                this.markDirty();
                return;
            }
            if (origin !== SERVER_ORIGIN) return;
            // A reconciliation write is visible to every client, including the
            // editor that triggered it.
            this.seq += 1;
            this.broadcast({
                type: "update",
                clientId: "",
                update: Buffer.from(update).toString("base64"),
                seq: this.seq,
                source: "system",
                ...this.envelope(),
            });
            this.markDirty();
        });
    }

    get size(): number {
        return this.clients.size;
    }

    get presenceCount(): number {
        return this.presence.size;
    }

    get fullUpdate(): string {
        return Buffer.from(Y.encodeStateAsUpdate(this.doc)).toString("base64");
    }

    get stateVector(): string {
        return Buffer.from(Y.encodeStateVector(this.doc)).toString("base64");
    }

    listPresence(): CollabPresence[] {
        this.prunePresence();
        return [...this.presence.values()];
    }

    private prunePresence(): void {
        const cutoff = Date.now() - 45_000;
        for (const [clientId, presence] of this.presence) {
            if (presence.updatedAt >= cutoff) continue;
            this.presence.delete(clientId);
            this.broadcast({ type: "presence-leave", clientId, ...this.envelope() });
        }
    }

    addClient(identity: CollabIdentity, token = ""): ClientConnection {
        this.clearIdleTimer();
        const clientId = crypto.randomUUID();
        const connection: ClientConnection = {
            clientId,
            ...identity,
            color: colorForUser(identity.userId),
            token,
            send: () => undefined,
        };
        this.clients.set(clientId, connection);
        if (identity.canEdit && token) {
            this.persistenceToken = token;
            // A fresh editor can recover a room that lost its token.
            if (this.persistence === "error" && this.needsPersist) {
                this.markDirty();
            }
        }
        return connection;
    }

    subscribe(clientId: string, send: (event: CollabEvent) => void): boolean {
        const client = this.clients.get(clientId);
        if (!client) return false;
        client.send = send;
        send({
            type: "sync",
            clientId,
            update: this.fullUpdate,
            stateVector: this.stateVector,
            presence: this.listPresence(),
            canEdit: client.canEdit,
            epoch: this.epoch,
            durableSeq: this.durableSeq,
            revision: this.revision,
            persistence: this.persistence,
            protocol: COLLAB_PROTOCOL,
            documentId: this.documentId,
        });
        return true;
    }

    removeClient(clientId: string): void {
        const existed = this.clients.delete(clientId);
        const hadPresence = this.presence.delete(clientId);
        if (hadPresence) {
            this.broadcast({ type: "presence-leave", clientId, ...this.envelope() });
        }
        if (existed && this.clients.size === 0) {
            // The last editor leaving is the last chance to write before the
            // room becomes eligible for idle disposal.
            void this.flush();
            this.scheduleIdleDispose();
        }
    }

    /**
     * Apply one client update. The Yjs update handler increments `seq`,
     * broadcasts the existing relay frame, and schedules the content write.
     */
    applyUpdate(
        clientId: string,
        userId: string,
        update: Uint8Array,
        token?: string,
    ): number | null {
        const client = this.clients.get(clientId);
        if (!client) return null;
        if (client.userId !== userId) throw new CollabSessionError();
        if (!client.canEdit) throw new CollabPermissionError();
        if (update.byteLength === 0) return this.seq;

        if (token) {
            client.token = token;
            this.persistenceToken = token;
        }

        Y.applyUpdate(this.doc, update, clientId);
        return this.seq;
    }

    setPresence(clientId: string, userId: string, input: CollabPresenceInput): boolean {
        const client = this.clients.get(clientId);
        if (!client) return false;
        if (client.userId !== userId) throw new CollabSessionError();
        this.prunePresence();
        const presence: CollabPresence = {
            clientId,
            userId: client.userId,
            name: client.name,
            avatar: client.avatar,
            color: client.color,
            anchor: input.anchor,
            head: input.head,
            focused: input.focused,
            updatedAt: Date.now(),
        };
        this.presence.set(clientId, presence);
        this.broadcast({ type: "presence", ...presence, ...this.envelope() }, clientId);
        return true;
    }

    /**
     * Drain pending content. Used for the last disconnect and shutdown; timers
     * use the single in-flight write path instead of starting a second one.
     */
    async flush(): Promise<void> {
        this.clearFlushTimers();
        if (this.disposed || !this.needsPersist) return;

        let attempts = 0;
        while (
            !this.disposed
            && this.needsPersist
            && this.persistence !== "conflict"
            && attempts < MAX_RECONCILE_ATTEMPTS
        ) {
            if (this.flushing) {
                await this.flushing;
            } else {
                await this.runFlush();
            }
            attempts += 1;
        }

        if (
            !this.disposed
            && this.needsPersist
            && this.persistence !== "conflict"
            && this.persistence !== "error"
        ) {
            this.scheduleFlush();
        }
    }

    private get needsPersist(): boolean {
        return this.seq > this.durableSeq;
    }

    private envelope(): ProtocolEnvelope {
        return {
            protocol: COLLAB_PROTOCOL,
            documentId: this.documentId,
            epoch: this.epoch,
        };
    }

    private markDirty(): void {
        if (this.persistence === "conflict") return;
        if (this.persistence !== "saving") {
            this.setPersistence("dirty");
        }
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.disposed || this.persistence === "conflict" || !this.needsPersist) return;

        if (this.flushDebounceTimer) clearTimeout(this.flushDebounceTimer);
        this.flushDebounceTimer = setTimeout(() => {
            this.flushDebounceTimer = null;
            this.runScheduledFlush();
        }, PERSIST_DEBOUNCE_MS);

        if (this.flushMaxWaitTimer) return;
        this.flushMaxWaitTimer = setTimeout(() => {
            this.flushMaxWaitTimer = null;
            this.runScheduledFlush();
        }, PERSIST_MAX_WAIT_MS);
    }

    private runScheduledFlush(): void {
        this.clearFlushTimers();
        void this.runFlush().finally(() => {
            if (
                !this.disposed
                && this.needsPersist
                && this.persistence !== "conflict"
                && this.persistence !== "error"
            ) {
                this.scheduleFlush();
            }
        });
    }

    private async runFlush(): Promise<void> {
        if (this.flushing) {
            await this.flushing;
            return;
        }
        if (this.disposed || !this.needsPersist || this.persistence === "conflict") return;

        const task = this.persistOnce();
        this.flushing = task;
        try {
            await task;
        } finally {
            if (this.flushing === task) this.flushing = null;
        }
    }

    private async persistOnce(): Promise<void> {
        const token = this.persistenceToken;
        if (!token) {
            this.failPersistence("The live session cannot save this note.");
            return;
        }

        let content = persistedContent(this.text.toString());
        if (content === this.lastPersistedContent) {
            // The sequence moved but the body did not (an update that cancelled
            // itself out). Treat it as durable without a needless PATCH.
            this.durableSeq = this.seq;
            this.broadcastAck();
            this.setPersistence("clean");
            return;
        }

        this.setPersistence("saving");
        let lastServerMarkdown: string | undefined;

        for (let attempt = 0; attempt < MAX_RECONCILE_ATTEMPTS; attempt += 1) {
            content = persistedContent(this.text.toString());
            const seqAtWrite = this.seq;
            const result = await this.patchDocument(token, content, this.revision);

            if (result.ok) {
                this.revision = result.revision;
                this.durableSeq = Math.max(this.durableSeq, seqAtWrite);
                this.lastPersistedContent = content;
                this.broadcastAck();
                this.setPersistence(this.needsPersist ? "dirty" : "clean");
                return;
            }

            if (!result.conflict) {
                this.failPersistence(result.message);
                return;
            }

            const latest = await this.loadLatest(token);
            if (!latest) {
                this.reportConflict(
                    "revision",
                    "The note changed outside this live session and could not be reconciled.",
                    lastServerMarkdown,
                );
                return;
            }
            lastServerMarkdown = latest.content;
            const remoteContent = persistedContent(latest.content);

            if (remoteContent === this.lastPersistedContent) {
                // Metadata-only write elsewhere: adopt the fresh revision and
                // retry the same body without touching the room.
                this.revision = latest.revision;
                continue;
            }

            const base = this.lastPersistedContent;
            const local = persistedContent(this.text.toString());
            let merged: string;
            try {
                merged = persistedContent(
                    mergeConcurrentMarkdown(base, local, remoteContent),
                );
            } catch (error) {
                log.warn("Live note merge failed", {
                    documentId: this.documentId,
                    error: error instanceof Error ? error.message : String(error),
                });
                this.reportConflict(
                    "merge",
                    "The note changed outside this live session and could not be merged.",
                    latest.content,
                );
                return;
            }

            if (merged !== this.text.toString()) {
                this.applyServerContent(merged);
            }
            this.revision = latest.revision;
        }

        this.reportConflict(
            "merge",
            "The note kept changing while this live session tried to save.",
            lastServerMarkdown,
        );
    }

    private async patchDocument(
        token: string,
        content: string,
        revision: number,
    ): Promise<PatchResult> {
        let response: Response;
        try {
            response = await fetch(recordPath(this.documentId), {
                method: "PATCH",
                headers: jsonHeaders(token),
                body: JSON.stringify({ content, revision }),
                signal: AbortSignal.timeout(PATCH_TIMEOUT_MS),
            });
        } catch (error) {
            return {
                ok: false,
                conflict: false,
                message: error instanceof Error && error.name === "TimeoutError"
                    ? "Saving the note timed out. Your changes are still here."
                    : "The workspace is unavailable right now. Your changes are still here.",
            };
        }

        if (response.ok) {
            let revision = this.revision + 1;
            try {
                const record = (await response.json()) as Record<string, unknown>;
                const stored = Number(record.revision);
                if (Number.isFinite(stored)) revision = stored;
            } catch {
                // The write succeeded; the next conflict will resync the token.
            }
            return { ok: true, revision };
        }

        const body = await readErrorBody(response);
        const message = typeof body.message === "string"
            ? body.message
            : "This note could not be saved.";
        return {
            ok: false,
            conflict: isRevisionConflict({
                status: response.status,
                message,
                data: body.data as { message?: unknown } | undefined,
            }),
            message,
        };
    }

    private async loadLatest(token: string): Promise<LatestDocument | null> {
        try {
            const response = await fetch(recordPath(this.documentId), {
                headers: {
                    Authorization: token,
                    Accept: "application/json",
                },
                signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
            });
            if (!response.ok) return null;
            const record = (await response.json()) as Record<string, unknown>;
            return {
                content: typeof record.content === "string" ? record.content : "",
                revision: Number.isFinite(Number(record.revision)) ? Number(record.revision) : 0,
            };
        } catch {
            return null;
        }
    }

    private applyServerContent(next: string): void {
        const current = this.text.toString();
        const change = minimalTextChange(current, next);
        if (!change) return;
        this.doc.transact(() => {
            if (change.to > change.from) this.text.delete(change.from, change.to - change.from);
            if (change.insert) this.text.insert(change.from, change.insert);
        }, SERVER_ORIGIN);
    }

    private broadcastAck(): void {
        this.broadcast({
            type: "ack",
            durableSeq: this.durableSeq,
            revision: this.revision,
            savedAt: new Date().toISOString(),
            ...this.envelope(),
        });
    }

    private setPersistence(phase: CollabPersistencePhase, message?: string): void {
        const changed = this.persistence !== phase;
        this.persistence = phase;
        // Repeated error/conflict reports are worth sending; routine dirty
        // keystrokes are not.
        if (!changed && phase !== "error" && phase !== "conflict") return;
        this.broadcast({
            type: "status",
            persistence: phase,
            revision: this.revision,
            ...(message ? { message } : {}),
            ...this.envelope(),
        });
    }

    private failPersistence(message: string): void {
        log.warn("Live note save failed", {
            documentId: this.documentId,
            revision: this.revision,
            message,
        });
        this.setPersistence("error", message);
    }

    private reportConflict(
        reason: CollabConflictFrame["reason"],
        message: string,
        serverMarkdown?: string,
    ): void {
        log.warn("Live note save conflicted", {
            documentId: this.documentId,
            revision: this.revision,
            reason,
        });
        this.setPersistence("conflict", message);
        this.broadcast({
            type: "conflict",
            revision: this.revision,
            reason,
            ...(serverMarkdown !== undefined ? { serverMarkdown } : {}),
            ...this.envelope(),
        });
    }

    private broadcast(event: CollabEvent, exceptClientId?: string): void {
        for (const client of this.clients.values()) {
            if (exceptClientId && client.clientId === exceptClientId) continue;
            try {
                client.send(event);
            } catch {
                this.removeClient(client.clientId);
            }
        }
    }

    private scheduleIdleDispose(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.clients.size > 0) return;
            void this.flush().finally(() => this.disposeIfIdle());
        }, ROOM_IDLE_MS);
    }

    private disposeIfIdle(): void {
        if (this.clients.size > 0) return;
        this.disposed = true;
        this.clearFlushTimers();
        this.presence.clear();
        rooms.delete(this.documentId);
        this.doc.destroy();
        log.debug("Disposed idle collaboration room", { documentId: this.documentId });
    }

    private clearFlushTimers(): void {
        if (this.flushDebounceTimer) {
            clearTimeout(this.flushDebounceTimer);
            this.flushDebounceTimer = null;
        }
        if (this.flushMaxWaitTimer) {
            clearTimeout(this.flushMaxWaitTimer);
            this.flushMaxWaitTimer = null;
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer === null) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }
}

export class CollabPermissionError extends Error {
    constructor() {
        super("You can view this note but not edit it.");
        this.name = "CollabPermissionError";
    }
}

export class CollabSessionError extends Error {
    constructor() {
        super("That live editing session is no longer active.");
        this.name = "CollabSessionError";
    }
}

const rooms = new Map<string, CollabRoom>();

/** Rooms are process-local; each room writes its own note content. */
export function getOrCreateRoom(
    documentId: string,
    initialContent: string,
    seed: CollabRoomSeed,
): CollabRoom {
    const existing = rooms.get(documentId);
    if (existing) return existing;
    const room = new CollabRoom(documentId, initialContent, seed);
    rooms.set(documentId, room);
    return room;
}

export function getRoom(documentId: string): CollabRoom | undefined {
    return rooms.get(documentId);
}

/** Flush every live room before shutdown. Errors are logged, never fatal. */
export async function flushAllRooms(): Promise<void> {
    const results = await Promise.allSettled(
        [...rooms.values()].map((room) => room.flush()),
    );
    for (const result of results) {
        if (result.status === "rejected") {
            log.warn("Failed to flush a collaboration room", result.reason);
        }
    }
}

export function decodeUpdate(value: unknown): Uint8Array | null {
    if (typeof value !== "string" || value.length === 0) return null;
    if (value.length > MAX_BASE64_UPDATE_LENGTH) return null;
    try {
        const bytes = Buffer.from(value, "base64");
        return bytes.byteLength > 0 ? bytes : null;
    } catch {
        return null;
    }
}
