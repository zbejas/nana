import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
    bunRequest,
    expectStatus,
    readJson,
} from "../helpers/client";
import {
    createNote,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, BASE_URL, uniqueSuffix } from "../helpers/setup";

interface SyncEvent {
    type: "sync";
    clientId: string;
    update: string;
    stateVector: string;
    canEdit: boolean;
    presence: Array<Record<string, unknown>>;
}

interface LiveEvent {
    type: string;
    clientId?: string;
    update?: string;
    name?: string;
    [key: string]: unknown;
}

class LiveClient {
    readonly sync: SyncEvent = {
        type: "sync",
        clientId: "",
        update: "",
        stateVector: "",
        canEdit: false,
        presence: [],
    };
    private readonly controller = new AbortController();
    private readonly events: LiveEvent[] = [];
    private waiters: Array<() => void> = [];
    private closed = false;

    private constructor() {}

    static async open(documentId: string, token: string): Promise<LiveClient> {
        const client = new LiveClient();
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

        // The sync frame is stored on `sync`, not queued; wait for the id.
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
        timeoutMs = 5_000,
    ): Promise<T> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const found = this.events.find(predicate);
            if (found) {
                this.events.splice(this.events.indexOf(found), 1);
                return found as T;
            }
            if (this.closed) {
                const afterClose = this.events.find(predicate);
                if (afterClose) {
                    this.events.splice(this.events.indexOf(afterClose), 1);
                    return afterClose as T;
                }
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

    async waitForType(type: string): Promise<LiveEvent> {
        return this.waitForEvent((event) => event.type === type);
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
): Promise<void> {
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
}

function updateFor(content: string, edit: (text: Y.Text) => void): string {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, content);
    edit(doc.getText("content"));
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function textFromUpdate(content: string, updateBase64: string): string {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, content);
    Y.applyUpdate(doc, Buffer.from(updateBase64, "base64"));
    return doc.getText("content").toString();
}

function presence(offset: number): unknown {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "presence fixture");
    return Y.createRelativePositionFromTypeIndex(text, Math.min(offset, text.length));
}

describe("/api/v1/collab live editing", () => {
    let owner: TestUser;
    let editor: TestUser;
    let viewer: TestUser;
    let outsider: TestUser;
    let note: TestRecord;
    let noteText: string;
    const clients: LiveClient[] = [];

    beforeAll(async () => {
        owner = await createUser("collab-owner");
        editor = await createUser("collab-editor");
        viewer = await createUser("collab-viewer");
        outsider = await createUser("collab-outsider");
        note = await createNote(owner, {
            title: `Collab ${uniqueSuffix()}`,
            content: "# Shared note\n\nOne paragraph.\n\nAnother paragraph.",
        });
        noteText = String(note.content);
        await share(owner, note.id, editor.id, "edit");
        await share(owner, note.id, viewer.id, "view");
    }, 30_000);

    afterAll(() => {
        for (const client of clients) client.close();
    });

    test("requires a browser session and document access", async () => {
        const path = `/api/v1/collab/documents/${note.id}/events`;

        const missing = await fetch(`${BASE_URL}${path}`);
        await expectStatus(missing, 401, "live session without a token");

        const outsiderResponse = await fetch(`${BASE_URL}${path}`, {
            headers: authHeaders(outsider.token),
        });
        await expectStatus(outsiderResponse, 404, "live session without access");
    }, 20_000);

    test("relays Yjs updates and presence between an owner and an editor", async () => {
        const ownerClient = await LiveClient.open(note.id, owner.token);
        const editorClient = await LiveClient.open(note.id, editor.token);
        clients.push(ownerClient, editorClient);

        expect(ownerClient.sync.canEdit).toBe(true);
        expect(editorClient.sync.canEdit).toBe(true);

        const update = updateFor(noteText, (text) => {
            text.insert(text.length, "\n\nLive typing from the owner.");
        });
        const sent = await bunRequest(`/api/v1/collab/documents/${note.id}/update`, {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({ clientId: ownerClient.clientId, update }),
        });
        await expectStatus(sent, 200, "publish live update");

        const relayed = await editorClient.waitForType("update");
        expect(relayed.update).toBe(update);
        expect(textFromUpdate(noteText, String(relayed.update))).toContain("Live typing from the owner.");

        const presenceResponse = await bunRequest(`/api/v1/collab/documents/${note.id}/presence`, {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                clientId: ownerClient.clientId,
                presence: {
                    anchor: presence(8),
                    head: presence(8),
                    focused: true,
                },
            }),
        });
        await expectStatus(presenceResponse, 204, "publish presence");

        const presenceEvent = await editorClient.waitForEvent(
            (event) => event.type === "presence" && event.clientId === ownerClient.clientId,
        );
        expect(typeof presenceEvent.name).toBe("string");
        expect(String(presenceEvent.name)).toContain("collab-owner");
    }, 20_000);

    test("lets a view grantee watch but not publish text", async () => {
        const viewerClient = await LiveClient.open(note.id, viewer.token);
        clients.push(viewerClient);
        expect(viewerClient.sync.canEdit).toBe(false);

        const update = updateFor(noteText, (text) => {
            text.insert(0, "viewer edit");
        });
        const response = await bunRequest(`/api/v1/collab/documents/${note.id}/update`, {
            method: "POST",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({ clientId: viewerClient.clientId, update }),
        });
        await expectStatus(response, 403, "viewer live update");
    }, 20_000);

    test("reports a stale client after the room is gone", async () => {
        const response = await bunRequest(`/api/v1/collab/documents/${note.id}/update`, {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({ clientId: "missing-client", update: "AAA=" }),
        });
        await expectStatus(response, 409, "stale live client");
    }, 20_000);

    test("forwards the revision token through the browser facade", async () => {
        const document = await createNote(owner, {
            title: `Revision ${uniqueSuffix()}`,
            content: "Revision body.",
        });
        const first = await bunRequest(`/api/v1/records/documents/${document.id}`, {
            method: "PATCH",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                content: "Revision body changed.",
                revision: 1,
            }),
        });
        await expectStatus(first, 200, "first revision write");

        const stale = await bunRequest(`/api/v1/records/documents/${document.id}`, {
            method: "PATCH",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                content: "A stale overwrite.",
                revision: 1,
            }),
        });
        await expectStatus(stale, 400, "stale revision write");
        const body = await readJson<{ message: string }>(stale);
        expect(body.message).toContain("changed since it was loaded");
    }, 20_000);
});
