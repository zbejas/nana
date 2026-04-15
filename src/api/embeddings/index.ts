import { verifyAuth, AuthError } from "../auth";
import { createLogger } from "../../lib/logger";

const log = createLogger("Embeddings");
import {
    embedDocument,
    embedAllDocuments,
    searchDocuments,
    deleteEmbeddings,
    getEmbeddingStatus,
    shouldAutoEmbed,
} from "./pipeline";
import type {
    EmbedRequest,
    EmbeddingSearchRequest,
    EmbeddingDeleteRequest,
} from "./types";

// ── Response helpers ─────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function jsonOk(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// ── Main handler ─────────────────────────────────────────────────────

/**
 * Main embeddings API handler.
 * Dispatches based on method + URL path:
 *
 *   POST   /api/embeddings/embed       → Embed a single document
 *   POST   /api/embeddings/embed-all   → Re-embed all user documents
 *   POST   /api/embeddings/search      → Semantic search
 *   GET    /api/embeddings/status      → Get embedding stats
 *   DELETE /api/embeddings/delete      → Delete embeddings
 */
export async function handleEmbeddings(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── Auth ─────────────────────────────────────────────────────────
    let userId: string;
    try {
        userId = await verifyAuth(req);
    } catch (err) {
        const status = err instanceof AuthError ? err.status : 401;
        const message = err instanceof Error ? err.message : "Authentication failed";
        return jsonError(message, status);
    }

    const authHeader = req.headers.get("Authorization")!;

    try {
        // ── POST /api/embeddings/embed ───────────────────────────────
        if (path === "/api/embeddings/embed" && req.method === "POST") {
            let body: EmbedRequest;
            try {
                body = (await req.json()) as EmbedRequest;
            } catch {
                return jsonError("Invalid JSON body", 400);
            }

            if (!body.documentId) {
                return jsonError("documentId is required", 400);
            }

            // When triggered by auto-embed, respect the admin's auto-embed setting
            if (body.auto) {
                const enabled = await shouldAutoEmbed();
                if (!enabled) {
                    return jsonOk({ success: true, skipped: true });
                }
            }

            const chunksEmbedded = await embedDocument(authHeader, body.documentId, userId);
            return jsonOk({ success: true, chunksEmbedded });
        }

        // ── POST /api/embeddings/embed-all ───────────────────────────
        if (path === "/api/embeddings/embed-all" && req.method === "POST") {
            const result = await embedAllDocuments(authHeader, userId);
            return jsonOk({
                success: true,
                totalDocuments: result.totalDocuments,
                totalChunks: result.totalChunks,
                errors: result.errors,
            });
        }

        // ── POST /api/embeddings/search ──────────────────────────────
        if (path === "/api/embeddings/search" && req.method === "POST") {
            let body: EmbeddingSearchRequest;
            try {
                body = (await req.json()) as EmbeddingSearchRequest;
            } catch {
                return jsonError("Invalid JSON body", 400);
            }

            if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
                return jsonError("query is required", 400);
            }

            const results = await searchDocuments(body.query.trim(), userId, body.topk);
            return jsonOk({ results });
        }

        // ── GET /api/embeddings/status ───────────────────────────────
        if (path === "/api/embeddings/status" && req.method === "GET") {
            const status = await getEmbeddingStatus();
            return jsonOk(status);
        }

        // ── DELETE /api/embeddings/delete ────────────────────────────
        if (path === "/api/embeddings/delete" && req.method === "DELETE") {
            let body: EmbeddingDeleteRequest = {};
            try {
                const text = await req.text();
                if (text) {
                    body = JSON.parse(text) as EmbeddingDeleteRequest;
                }
            } catch {
                // No body = delete all user embeddings
            }

            await deleteEmbeddings(userId, body.documentId);
            return jsonOk({ success: true });
        }

        return jsonError("Not found", 404);
    } catch (err) {
        log.error("Embeddings API error", err);
        const message = err instanceof Error ? err.message : "Internal server error";
        return jsonError(message, 500);
    }
}
