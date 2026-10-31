import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
    bunRequest,
    expectStatus,
    pbGetRecord,
    pbUpdate,
    readJson,
} from "../helpers/client";
import {
    createNote,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";
import { readNote } from "../../src/api/chat/tools/notes";
import { getOrCreateRoom } from "../../src/api/rest/collab/room";
import { authHeaders, BASE_URL, uniqueSuffix } from "../helpers/setup";

interface SyncEvent {
    type: "sync";
    clientId: string;
    update: string;
    stateVector: string;
    canEdit: boolean;
    epoch?: string;
    protocol?: number;
    documentId?: string;
    durableSeq?: number;
    revision?: number;
    persistence?: string;
}

interface LiveEvent {
    type: string;
    clientId?: string;
    update?: string;
    source?: string;
    durableSeq?: number;
    revision?: number;
    persistence?: string;
    protocol?: number;
    documentId?: string;
    epoch?: string;
    reason?: string;
    [key: string]: unknown;
}

interface DocumentRecord {
    id: string;
    content?: string;
    revision?: number;
    title?: string;
    last_edited_by?: string;
    last_edit_source?: string;
    [key: string]: unknown;
}

class PersistenceClient {
    readonly sync: SyncEvent = {
        type: "sync",
        clientId: "",
        update: "",
        stateVector: "",
        canEdit: false,
    };
    private readonly controller = new AbortController();
    private readonly events: LiveEvent[] = [];
    private waiters: Array<() => void> = [];
    private closed = false;

    private constructor() {}

    static async open(documentId: string, token: string): Promise<PersistenceClient> {
        const client = new PersistenceClient();
        await client.connect(documentId, token);
        return client;
    }

    private async connect(documentId: string, token: string): Promise<void> {
        const response = await fetch(
            `${BASE_URL}/api/v1/collab/documents/${encodeURIComponent(documentId)}/events`,
            {
                headers: {
                    Authorization: token,
                    Accept: "text/event-stream",
                },
                signal: this.controller.signal,
            },
        );
        await expectStatus(response, 200, "open live session");
        if (!response.body) throw new Error("Live session had no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const consume = async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.indexOf("\n\n");
                    while (boundary >= 0) {
                        const frame = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const data = frame
                            .split("\n")
                            .filter((line) => line.startsWith("data:"))
                            .map((line) => line.slice(5).trimStart())
                            .join("\n");
                        if (data) {
                            try {
                                const event = JSON.parse(data) as LiveEvent;
                                if (event.type === "sync") {
                                    Object.assign(this.sync, event);
                                } else {
                                    this.events.push(event);
                                }
                                for (const wake of this.waiters.splice(0)) wake();
                            } catch {
                                // Ignore malformed test frames.
                            }
                        }
                        boundary = buffer.indexOf("\n\n");
                    }
                }
            } catch {
                // Abort is expected when the test closes the stream.
            } finally {
                this.closed = true;
                for (const wake of this.waiters.splice(0)) wake();
            }
        };
        void consume();

        while (!this.sync.clientId) {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 100);
                this.waiters.push(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
    }

    get clientId(): string {
        return this.sync.clientId;
    }

    async waitForEvent<T extends LiveEvent = LiveEvent>(
        predicate: (event: LiveEvent) => boolean = () => true,
        timeoutMs = 10_000,
    ): Promise<T> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const found = this.events.find(predicate);
            if (found) {
                this.events.splice(this.events.indexOf(found), 1);
                return found as T;
            }
            if (this.closed) {
                throw new Error("Live session closed before the expected event");
            }
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 100);
                this.waiters.push(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        throw new Error("Timed out waiting for a live event");
    }

    close(): void {
        this.controller.abort();
    }
}

function jsonHeaders(token: string): Record<string, string> {
    return { ...authHeaders(token), "Content-Type": "application/json" };
}

async function share(
    owner: TestUser,
    targetId: string,
    userId: string,
    permission: "view" | "comment" | "edit",
): Promise<string> {
    const response = await bunRequest("/api/v1/sharing/links", {
        method: "POST",
        headers: jsonHeaders(owner.token),
        body: JSON.stringify({
            targetType: "document",
            targetId,
            userId,
            permission,
        }),
    });
    await expectStatus(response, 200, `share ${permission}`);
    const body = await readJson<{ id?: string }>(response, `share ${permission}`);
    return typeof body.id === "string" ? body.id : "";
}

function docFromSync(sync: SyncEvent): Y.Doc {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(sync.update, "base64"));
    return doc;
}

/** Build an update relative to the room state the client received. */
function editUpdate(
    doc: Y.Doc,
    edit: (text: Y.Text) => void,
): { update: string; expected: string } {
    const baseVector = Y.encodeStateVector(doc);
    edit(doc.getText("content"));
    return {
        update: Buffer.from(Y.encodeStateAsUpdate(doc, baseVector)).toString("base64"),
        expected: doc.getText("content").toString(),
    };
}

async function publish(
    documentId: string,
    token: string,
    clientId: string,
    update: string,
): Promise<void> {
    const response = await bunRequest(
        `/api/v1/collab/documents/${encodeURIComponent(documentId)}/update`,
        {
            method: "POST",
            headers: jsonHeaders(token),
            body: JSON.stringify({ clientId, update }),
        },
    );
    await expectStatus(response, 200, "publish live update");
}

async function waitForPersisted(
    documentId: string,
    token: string,
    predicate: (record: DocumentRecord) => boolean,
    timeoutMs = 10_000,
): Promise<DocumentRecord> {
    const deadline = Date.now() + timeoutMs;
    let latest: DocumentRecord | null = null;
    while (Date.now() < deadline) {
        latest = await pbGetRecord<DocumentRecord>(token, "documents", documentId);
        if (predicate(latest)) return latest;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
        `Timed out waiting for persisted content. Last record: ${JSON.stringify(latest)}`,
    );
}

function initialRevision(note: TestRecord): number {
    const revision = Number(note.revision ?? 1);
    return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

describe("collab room persistence", () => {
    let owner: TestUser;
    let editor: TestUser;
    const clients: PersistenceClient[] = [];

    beforeAll(async () => {
        owner = await createUser("collab-persist-owner");
        editor = await createUser("collab-persist-editor");
    }, 30_000);

    afterAll(() => {
        for (const client of clients) client.close();
    });

    test("writes an edit, acknowledges it, and advances the revision once", async () => {
        const note = await createNote(owner, {
            title: `Persist basic ${uniqueSuffix()}`,
            content: "hello world",
        });
        const revision = initialRevision(note);
        const client = await PersistenceClient.open(note.id, owner.token);
        clients.push(client);

        expect(client.sync.protocol).toBe(2);
        expect(client.sync.documentId).toBe(note.id);
        expect(client.sync.persistence).toBe("clean");
        expect(client.sync.durableSeq).toBe(0);

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " from live");
        });
        await publish(note.id, owner.token, client.clientId, update);

        const ack = await client.waitForEvent(
            (event) => event.type === "ack",
        );
        expect(ack.protocol).toBe(2);
        expect(ack.documentId).toBe(note.id);
        expect(typeof ack.epoch).toBe("string");
        expect(ack.durableSeq).toBeGreaterThanOrEqual(1);
        expect(ack.revision).toBe(revision + 1);
        expect(typeof ack.savedAt).toBe("string");

        const clean = await client.waitForEvent(
            (event) => event.type === "status" && event.persistence === "clean",
        );
        expect(clean.revision).toBe(revision + 1);

        const persisted = await pbGetRecord<DocumentRecord>(owner.token, "documents", note.id);
        expect(String(persisted.content)).toBe(expected);
        expect(Number(persisted.revision)).toBe(revision + 1);

        const viaFacade = await bunRequest(`/api/v1/records/documents/${note.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(viaFacade, 200, "read persisted note");
        const facadeRecord = await readJson<DocumentRecord>(viaFacade, "read persisted note");
        expect(String(facadeRecord.content)).toBe(expected);
        expect(Number(facadeRecord.revision)).toBe(revision + 1);
    }, 30_000);

    test("flushes a pending edit when the last client disconnects", async () => {
        const note = await createNote(owner, {
            title: `Persist disconnect ${uniqueSuffix()}`,
            content: "disconnect body",
        });
        const revision = initialRevision(note);
        const client = await PersistenceClient.open(note.id, owner.token);

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " saved on leave");
        });
        await publish(note.id, owner.token, client.clientId, update);
        client.close();

        const persisted = await waitForPersisted(
            note.id,
            owner.token,
            (record) => String(record.content) === expected,
        );
        expect(String(persisted.content)).toBe(expected);
        expect(Number(persisted.revision)).toBe(revision + 1);
    }, 30_000);

    test("adopts a metadata-only revision bump and retries the same revision token", async () => {
        const note = await createNote(owner, {
            title: `Persist metadata ${uniqueSuffix()}`,
            content: "metadata body",
        });
        const revision = initialRevision(note);
        const client = await PersistenceClient.open(note.id, owner.token);
        clients.push(client);

        // A title-only write bumps the revision without touching content.
        await pbUpdate(owner.token, "documents", note.id, {
            title: `Persist metadata renamed ${uniqueSuffix()}`,
        });

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " after metadata");
        });
        await publish(note.id, owner.token, client.clientId, update);

        const ack = await client.waitForEvent(
            (event) => event.type === "ack",
        );
        expect(ack.revision).toBe(revision + 2);

        const persisted = await pbGetRecord<DocumentRecord>(owner.token, "documents", note.id);
        expect(String(persisted.content)).toBe(expected);
        expect(Number(persisted.revision)).toBe(revision + 2);
    }, 30_000);

    test("merges conflicting external content instead of overwriting it", async () => {
        const note = await createNote(owner, {
            title: `Persist merge ${uniqueSuffix()}`,
            content: "one\ntwo\nthree",
        });
        const revision = initialRevision(note);
        const client = await PersistenceClient.open(note.id, owner.token);
        clients.push(client);

        // Another writer changes the last line while the room is open.
        await pbUpdate(owner.token, "documents", note.id, {
            content: "one\ntwo\nTHREE",
            revision,
        });

        const doc = docFromSync(client.sync);
        const { update } = editUpdate(doc, (text) => {
            text.delete(0, "one".length);
            text.insert(0, "ONE");
        });
        await publish(note.id, owner.token, client.clientId, update);

        const ack = await client.waitForEvent(
            (event) => event.type === "ack",
        );
        expect(ack.revision).toBe(revision + 2);

        const persisted = await pbGetRecord<DocumentRecord>(owner.token, "documents", note.id);
        expect(String(persisted.content)).toBe("ONE\ntwo\nTHREE");
        expect(Number(persisted.revision)).toBe(revision + 2);
    }, 30_000);

    test("does not overwrite when the caller loses edit access (no superuser fallback)", async () => {
        const note = await createNote(owner, {
            title: `Persist revoked ${uniqueSuffix()}`,
            content: "revoked base",
        });
        const revision = initialRevision(note);
        const shareId = await share(owner, note.id, editor.id, "edit");
        expect(shareId).not.toBe("");

        const client = await PersistenceClient.open(note.id, editor.token);
        clients.push(client);
        expect(client.sync.canEdit).toBe(true);

        // Revoke before the update: the live session keeps the permission it
        // connected with, but the room's content PATCH must use this caller's
        // token and fail rather than fall back to a superuser.
        const revoke = await bunRequest(`/api/v1/sharing/links/${encodeURIComponent(shareId)}`, {
            method: "DELETE",
            headers: authHeaders(owner.token),
        });
        await expectStatus(revoke, 200, "revoke edit share");

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " should not persist");
        });
        await publish(note.id, editor.token, client.clientId, update);

        const status = await client.waitForEvent(
            (event) => event.type === "status" && event.persistence === "error",
        );
        expect(Number(status.revision)).toBe(revision);

        const persisted = await pbGetRecord<DocumentRecord>(owner.token, "documents", note.id);
        expect(String(persisted.content)).toBe("revoked base");
        expect(Number(persisted.revision)).toBe(revision);
        expect(String(persisted.content)).not.toBe(expected);
    }, 30_000);

    test("flushes pending content on demand before a version snapshot", async () => {
        const note = await createNote(owner, {
            title: `Persist flush ${uniqueSuffix()}`,
            content: "flush base",
        });
        const revision = initialRevision(note);
        const client = await PersistenceClient.open(note.id, owner.token);
        clients.push(client);

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " before snapshot");
        });
        await publish(note.id, owner.token, client.clientId, update);

        // The debounce has not fired yet. The explicit flush must make the
        // body durable and return the revision the version route should use.
        const response = await bunRequest(
            `/api/v1/collab/documents/${encodeURIComponent(note.id)}/flush`,
            {
                method: "POST",
                headers: authHeaders(owner.token),
            },
        );
        await expectStatus(response, 200, "flush live content");
        const flushed = await readJson<{
            content: string;
            revision: number;
            durableSeq: number;
            persistence: string;
        }>(response, "flush live content");
        expect(flushed.content).toBe(expected);
        expect(flushed.revision).toBe(revision + 1);
        expect(flushed.durableSeq).toBeGreaterThanOrEqual(1);
        expect(flushed.persistence).toBe("clean");

        const persisted = await pbGetRecord<DocumentRecord>(owner.token, "documents", note.id);
        expect(String(persisted.content)).toBe(expected);
        expect(Number(persisted.revision)).toBe(revision + 1);
    }, 30_000);

    test("read_note flushes an unpersisted live update before returning the body", async () => {
        const note = await createNote(owner, {
            title: `Persist chat read ${uniqueSuffix()}`,
            content: "fresh base",
        });
        const revision = initialRevision(note);

        // Integration tests run in their own Bun process, so the server's
        // in-memory room is not visible here. Create the same room locally and
        // use its real apply/flush path; only the PocketBase write crosses
        // processes.
        const room = getOrCreateRoom(note.id, String(note.content ?? ""), {
            token: owner.token,
            revision,
        });
        const client = room.addClient({
            userId: owner.id,
            name: owner.email,
            avatar: "",
            canEdit: true,
        }, owner.token);

        const doc = new Y.Doc();
        Y.applyUpdate(doc, Buffer.from(room.fullUpdate, "base64"));
        const baseVector = Y.encodeStateVector(doc);
        const text = doc.getText("content");
        text.insert(text.length, " before chat read");
        const update = Y.encodeStateAsUpdate(doc, baseVector);
        const expected = text.toString();

        const seq = room.applyUpdate(client.clientId, owner.id, update, owner.token);
        expect(seq).not.toBeNull();

        // Do not wait for the debounce or an ack: the chat read must flush the
        // room itself and return the fresh body and revision.
        const result = await readNote(
            { authHeader: owner.token, userId: owner.id },
            { noteId: note.id, limit: 600 },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.content).toBe(expected);
        expect(result.revision).toBe(revision + 1);

        room.removeClient(client.clientId);
    }, 30_000);

    test("does not let a viewer flush the room body", async () => {
        const note = await createNote(owner, {
            title: `Persist flush viewer ${uniqueSuffix()}`,
            content: "viewer flush base",
        });
        await share(owner, note.id, editor.id, "view");

        const response = await bunRequest(
            `/api/v1/collab/documents/${encodeURIComponent(note.id)}/flush`,
            {
                method: "POST",
                headers: authHeaders(editor.token),
            },
        );
        expect(response.status).toBe(403);
    }, 30_000);

    test("persists through an edit grantee's own session token", async () => {
        const note = await createNote(owner, {
            title: `Persist grantee ${uniqueSuffix()}`,
            content: "grantee body",
        });
        const revision = initialRevision(note);
        await share(owner, note.id, editor.id, "edit");

        const client = await PersistenceClient.open(note.id, editor.token);
        clients.push(client);
        expect(client.sync.canEdit).toBe(true);

        const doc = docFromSync(client.sync);
        const { update, expected } = editUpdate(doc, (text) => {
            text.insert(text.length, " from the grantee");
        });
        await publish(note.id, editor.token, client.clientId, update);

        const ack = await client.waitForEvent(
            (event) => event.type === "ack",
        );
        expect(ack.revision).toBe(revision + 1);

        const persisted = await pbGetRecord<DocumentRecord>(editor.token, "documents", note.id);
        expect(String(persisted.content)).toBe(expected);
        expect(Number(persisted.revision)).toBe(revision + 1);
        // The revision guard stamped the caller, not a superuser identity.
        expect(String(persisted.last_edit_source)).toBe("user");
        expect(String(persisted.last_edited_by)).toContain("collab-persist-editor");
    }, 30_000);
});
