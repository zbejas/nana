import { Elysia } from "elysia";
import { createLogger } from "../../../lib/logger";
import { BrowserAuthError, jsonError, requireBrowserAuth } from "../browser/auth";
import { loadCollabDocumentAccess } from "./access";
import {
    CollabPermissionError,
    CollabSessionError,
    decodeUpdate,
    getOrCreateRoom,
    getRoom,
    isRelativePosition,
    type CollabPresenceInput,
} from "./room";

const log = createLogger("Collab");

const MAX_BODY_BYTES = 9 * 1024 * 1024;
const MAX_PRESENCE_BYTES = 4 * 1024;

function parsePresence(value: unknown): CollabPresenceInput | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (!isRelativePosition(input.anchor) || !isRelativePosition(input.head)) return null;
    const presence: CollabPresenceInput = {
        anchor: input.anchor,
        head: input.head,
        focused: input.focused === true,
    };
    try {
        if (JSON.stringify(presence).length > MAX_PRESENCE_BYTES) return null;
    } catch {
        return null;
    }
    return presence;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
    const text = await request.text();
    if (!text || text.length > MAX_BODY_BYTES) return null;
    try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function sseFrame(payload: unknown): string {
    return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export const collabApi = new Elysia({ name: "nana-collab" })
    .get("/api/v1/collab/documents/:id/events", async ({ request, params }) => {
        let access;
        try {
            access = await loadCollabDocumentAccess(request, params.id);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            log.warn("Live session authorization failed", {
                documentId: params.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return jsonError(502, "The live session is unavailable right now.");
        }
        if (!access) return jsonError(404, "Not found.");

        const room = getOrCreateRoom(params.id, access.content);
        const client = room.addClient(access.identity);
        const encoder = new TextEncoder();

        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let cleanup = () => undefined as void;

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const write = (chunk: string) => {
                    if (closed) return;
                    controller.enqueue(encoder.encode(chunk));
                };
                cleanup = () => {
                    if (closed) return;
                    closed = true;
                    if (heartbeat) clearInterval(heartbeat);
                    heartbeat = null;
                    room.removeClient(client.clientId);
                    try {
                        controller.close();
                    } catch {
                        // The consumer already closed the stream.
                    }
                };

                write(": connected\n\n");
                room.subscribe(client.clientId, (event) => {
                    try {
                        write(sseFrame(event));
                    } catch {
                        cleanup();
                    }
                });
                heartbeat = setInterval(() => {
                    try {
                        write(": ping\n\n");
                    } catch {
                        cleanup();
                    }
                }, 15_000);

                request.signal.addEventListener("abort", cleanup, { once: true });
            },
            cancel() {
                cleanup();
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            },
        });
    }, { detail: { hide: true } })
    .post("/api/v1/collab/documents/:id/update", async ({ request, params }) => {
        let auth;
        try {
            auth = requireBrowserAuth(request);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }

        const body = await readJsonBody(request);
        if (!body || typeof body.clientId !== "string" || !body.clientId) {
            return jsonError(400, "Invalid live update.");
        }
        const update = decodeUpdate(body.update);
        if (!update) return jsonError(400, "Invalid live update.");

        const room = getRoom(params.id);
        if (!room) return jsonError(409, "Reconnect to the live session.");
        try {
            const seq = room.applyUpdate(body.clientId, auth.userId, update);
            if (seq === null) return jsonError(409, "Reconnect to the live session.");
            return Response.json({ ok: true, seq });
        } catch (error) {
            if (error instanceof CollabPermissionError) return jsonError(403, error.message);
            if (error instanceof CollabSessionError) return jsonError(409, error.message);
            log.warn("Failed to apply a live update", {
                documentId: params.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return jsonError(400, "Invalid live update.");
        }
    }, { detail: { hide: true } })
    .post("/api/v1/collab/documents/:id/presence", async ({ request, params }) => {
        let auth;
        try {
            auth = requireBrowserAuth(request);
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }

        const body = await readJsonBody(request);
        if (!body || typeof body.clientId !== "string" || !body.clientId) {
            return jsonError(400, "Invalid presence update.");
        }
        const presence = parsePresence(body.presence);
        if (!presence) return jsonError(400, "Invalid presence update.");

        const room = getRoom(params.id);
        if (!room) return jsonError(409, "Reconnect to the live session.");
        try {
            if (!room.setPresence(body.clientId, auth.userId, presence)) {
                return jsonError(409, "Reconnect to the live session.");
            }
        } catch (error) {
            if (error instanceof CollabSessionError) return jsonError(409, error.message);
            throw error;
        }
        return new Response(null, { status: 204 });
    }, { detail: { hide: true } });
