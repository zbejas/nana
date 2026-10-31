import * as Y from "yjs";
import { createLogger } from "../../../lib/logger";
import { normalizeCollabMarkdown } from "../../../lib/collaboration/normalize";

const log = createLogger("CollabRoom");

/** A room with no viewers is kept briefly so a refresh does not lose state. */
const ROOM_IDLE_MS = 45_000;
const MAX_BASE64_UPDATE_LENGTH = 8 * 1024 * 1024;

const PRESENCE_COLORS = [
    "#ff7a54",
    "#e3b25f",
    "#74c69d",
    "#58a6ff",
    "#ab7df8",
    "#f85149",
] as const;

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

type CollabEvent =
    | {
        type: "sync";
        clientId: string;
        update: string;
        stateVector: string;
        presence: CollabPresence[];
        canEdit: boolean;
        epoch: string;
    }
    | {
        type: "update";
        clientId: string;
        update: string;
        seq: number;
    }
    | ({ type: "presence" } & CollabPresence)
    | {
        type: "presence-leave";
        clientId: string;
    };

interface ClientConnection extends CollabIdentity {
    clientId: string;
    color: string;
    send: (event: CollabEvent) => void;
}

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

/**
 * One live document. Yjs is the merge engine; the room owns the canonical
 * in-memory state while at least one editor is connected. Persistence remains
 * the editor's normal debounced save, so no second write path is introduced.
 */
export class CollabRoom {
    private readonly doc = new Y.Doc();
    private readonly text: Y.Text;
    private readonly clients = new Map<string, ClientConnection>();
    private readonly presence = new Map<string, CollabPresence>();
    /** Identifies this in-memory incarnation so clients can reset after a restart. */
    readonly epoch = crypto.randomUUID();
    private seq = 0;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        readonly documentId: string,
        initialContent: string,
    ) {
        this.text = this.doc.getText("content");
        this.text.insert(0, normalizeCollabMarkdown(initialContent));
        this.doc.on("update", (update: Uint8Array, origin: unknown) => {
            // The seed and server-side bookkeeping are not client edits.
            if (typeof origin !== "string" || !this.clients.has(origin)) return;
            this.seq += 1;
            this.broadcast({
                type: "update",
                clientId: origin,
                update: Buffer.from(update).toString("base64"),
                seq: this.seq,
            }, origin);
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
            this.broadcast({ type: "presence-leave", clientId });
        }
    }

    addClient(identity: CollabIdentity): ClientConnection {
        this.clearIdleTimer();
        const clientId = crypto.randomUUID();
        const connection: ClientConnection = {
            clientId,
            ...identity,
            color: colorForUser(identity.userId),
            send: () => undefined,
        };
        this.clients.set(clientId, connection);
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
        });
        return true;
    }

    removeClient(clientId: string): void {
        const existed = this.clients.delete(clientId);
        const hadPresence = this.presence.delete(clientId);
        if (hadPresence) {
            this.broadcast({ type: "presence-leave", clientId });
        }
        if (existed && this.clients.size === 0) {
            this.scheduleIdleDispose();
        }
    }

    applyUpdate(clientId: string, userId: string, update: Uint8Array): number | null {
        const client = this.clients.get(clientId);
        if (!client) return null;
        if (client.userId !== userId) throw new CollabSessionError();
        if (!client.canEdit) throw new CollabPermissionError();
        if (update.byteLength === 0) return this.seq;
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
        this.broadcast({ type: "presence", ...presence }, clientId);
        return true;
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
            this.presence.clear();
            rooms.delete(this.documentId);
            this.doc.destroy();
            log.debug("Disposed idle collaboration room", { documentId: this.documentId });
        }, ROOM_IDLE_MS);
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

/** Rooms are process-local; the editor still owns persistence. */
export function getOrCreateRoom(documentId: string, initialContent: string): CollabRoom {
    const existing = rooms.get(documentId);
    if (existing) return existing;
    const room = new CollabRoom(documentId, initialContent);
    rooms.set(documentId, room);
    return room;
}

export function getRoom(documentId: string): CollabRoom | undefined {
    return rooms.get(documentId);
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
