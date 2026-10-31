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
const ALLOWED_TOPICS = new Set([
    "documents",
    "folders",
    "boards",
    "board_columns",
    "tasks",
    "task_relations",
    "task_activity",
    "shares",
    "access_grants",
    "conversations",
    "messages",
    "comments",
]);

function isAllowedTopic(topic: string): boolean {
    const base = topic.split("/")[0]?.trim();
    return Boolean(base) && ALLOWED_TOPICS.has(base);
}

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

            // PocketBase still applies collection rules per event. The
            // allowlist keeps the browser relay from subscribing to auth,
            // settings, or API-key collections even if a future rule is too
            // broad.
            if (body.byteLength > 0) {
                try {
                    const payload = JSON.parse(new TextDecoder().decode(body)) as {
                        subscriptions?: unknown;
                    };
                    if (Array.isArray(payload.subscriptions)) {
                        const invalid = payload.subscriptions.find(
                            (topic) => typeof topic !== "string" || !isAllowedTopic(topic)
                        );
                        if (invalid !== undefined) {
                            return jsonError(400, "Unknown realtime topic.");
                        }
                    }
                } catch {
                    return jsonError(400, "Invalid realtime subscription.");
                }
            }

            return forwardRaw(request, "/api/realtime", body, { token: auth.token });
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, {
        parse: "none",
        detail: { hide: true },
    });
