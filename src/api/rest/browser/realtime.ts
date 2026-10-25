import { Elysia } from "elysia";
import { BrowserAuthError, jsonError, requireBrowserAuth } from "./auth";
import { forwardRaw, forwardToPocketBase } from "./proxy";

/**
 * PocketBase realtime relay.
 *
 * The EventSource handshake is unauthenticated, exactly like PocketBase: the
 * server sends PB_CONNECT with a client id, and the authenticated POST below
 * subscribes that client id to topics. PocketBase still applies collection
 * rules per event; Elysia only forwards the loopback stream.
 */
export const browserRealtimeRoutes = new Elysia({ name: "nana-browser-realtime" })
    .get("/api/v1/realtime", ({ request }) =>
        forwardToPocketBase(request, "/api/realtime", {
            timeoutMs: null,
            headers: { Accept: "text/event-stream" },
        }), { detail: { hide: true } })
    .post("/api/v1/realtime", async ({ request }) => {
        try {
            const auth = requireBrowserAuth(request);
            const body = await request.arrayBuffer();
            return forwardRaw(request, "/api/realtime", body, { token: auth.token });
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, {
        parse: "none",
        detail: { hide: true },
    });
