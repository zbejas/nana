import type { Server } from "bun";
import { serverConfig } from "../lib/config";
import { shouldAutoEmbed, embedDocument, deleteEmbeddings } from "./embeddings/pipeline";
import { createLogger } from "../lib/logger";

const log = createLogger("Proxy");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Extract user ID and auth header from a request's Authorization token
 * by calling PocketBase's auth-refresh.
 */
async function resolveUser(req: Request): Promise<{ userId: string; authHeader: string } | null> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return null;

    try {
        const res = await fetch(`${POCKETBASE_URL}/api/collections/users/auth-refresh`, {
            method: "POST",
            headers: { Authorization: authHeader },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { record?: { id?: string } };
        const userId = data.record?.id;
        if (!userId) return null;
        return { userId, authHeader };
    } catch {
        return null;
    }
}

/**
 * Fire-and-forget: embed a document after it's created or updated.
 * Runs asynchronously — doesn't block the proxy response.
 */
function triggerAutoEmbed(authHeader: string, documentId: string, userId: string): void {
    shouldAutoEmbed()
        .then((enabled) => {
            if (!enabled) return;
            return embedDocument(authHeader, documentId, userId);
        })
        .then((count) => {
            if (count !== undefined) {
                log.info(`AutoEmbed: embedded ${count} chunks for document ${documentId}`);
            }
        })
        .catch((err) => {
            log.error(`AutoEmbed: failed for document ${documentId}`, err);
        });
}

/**
 * Fire-and-forget: delete embeddings when a document is deleted.
 */
function triggerAutoDelete(userId: string, documentId: string): void {
    deleteEmbeddings(userId, documentId).catch((err) => {
        log.error(`AutoEmbed: failed to delete embeddings for document ${documentId}`, err);
    });
}

/**
 * Proxy handler for PocketBase requests
 * Forwards all /pb/* requests to the PocketBase backend
 */
export async function handlePocketBaseProxy(req: Request, server: Server<any>): Promise<Response> {
    const url = new URL(req.url);
    const pbPath = url.pathname.replace('/pb', '');
    const pbUrl = `${POCKETBASE_URL}${pbPath}${url.search}`;
    const startedAt = Date.now();

    // Forward the request to PocketBase with all headers
    const headers = new Headers(req.headers);
    // Update the host header to match PocketBase
    headers.set('host', new URL(POCKETBASE_URL).host);

    try {
        // Disable timeout for SSE connections to prevent disconnections
        if (pbPath.startsWith('/api/realtime')) {
            server.timeout(req, 0);
        }

        // Read the request body once and reuse it for both proxying and trash
        // endpoint inspection (move-document needs the documentId from the body).
        let bodyBuffer: ArrayBuffer | undefined;
        let parsedBody: Record<string, unknown> | null = null;

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            bodyBuffer = await req.arrayBuffer();

            // Pre-parse JSON body for trash endpoints so we can inspect it later
            if (pbPath.startsWith('/api/trash/')) {
                try {
                    parsedBody = JSON.parse(new TextDecoder().decode(bodyBuffer));
                } catch { /* not JSON – ignore */ }
            }
        }

        const pbResponse = await fetch(pbUrl, {
            method: req.method,
            headers,
            body: bodyBuffer,
        });

        const durationMs = Date.now() - startedAt;
        log.debug(`${req.method} ${url.pathname}${url.search} → ${pbResponse.status} (${durationMs}ms)`);

        // ── Auto-embed on document mutations ─────────────────────────
        const isDocumentsEndpoint = pbPath.startsWith('/api/collections/documents/records');

        if (isDocumentsEndpoint && pbResponse.ok) {
            const method = req.method;

            // POST = create, PATCH = update → trigger embedding
            if (method === "POST" || method === "PATCH") {
                // Clone the response so we can read the body without consuming it
                const cloned = pbResponse.clone();
                cloned.json().then(async (data: any) => {
                    if (data?.id) {
                        const user = await resolveUser(req);
                        if (user) {
                            triggerAutoEmbed(user.authHeader, data.id, user.userId);
                        }
                    }
                }).catch(() => { /* non-critical */ });
            }

            // DELETE → remove embeddings
            if (method === "DELETE") {
                // Extract document ID from the path: /api/collections/documents/records/{id}
                const pathParts = pbPath.split("/");
                const docId = pathParts[pathParts.length - 1];
                if (docId && docId !== "records") {
                    resolveUser(req).then((user) => {
                        if (user) {
                            triggerAutoDelete(user.userId, docId);
                        }
                    }).catch(() => { /* non-critical */ });
                }
            }
        }

        // ── Embedding sync on trash operations ───────────────────────
        if (pbResponse.ok && pbPath.startsWith('/api/trash/')) {
            const cloned = pbResponse.clone();
            cloned.json().then(async (data: any) => {
                const user = await resolveUser(req);
                if (!user) return;

                // Move document to trash → delete its embeddings
                if (pbPath === '/api/trash/move-document' && parsedBody?.documentId) {
                    triggerAutoDelete(user.userId, String(parsedBody.documentId));
                }

                // Move folder to trash → delete embeddings for all documents in the folder tree
                if (pbPath === '/api/trash/move-folder' && Array.isArray(data?.movedDocumentIds)) {
                    for (const docId of data.movedDocumentIds) {
                        triggerAutoDelete(user.userId, String(docId));
                    }
                }

                // Restore document from trash → re-embed it
                if (pbPath === '/api/trash/restore-document' && data?.documentId) {
                    triggerAutoEmbed(user.authHeader, String(data.documentId), user.userId);
                }

                // Restore folder from trash → re-embed all restored documents
                if (pbPath === '/api/trash/restore-folder' && Array.isArray(data?.restoredDocumentIds)) {
                    for (const docId of data.restoredDocumentIds) {
                        triggerAutoEmbed(user.authHeader, String(docId), user.userId);
                    }
                }
            }).catch(() => { /* non-critical */ });
        }

        // Return the PocketBase response
        return new Response(pbResponse.body, {
            status: pbResponse.status,
            statusText: pbResponse.statusText,
            headers: pbResponse.headers,
        });
    } catch (error) {
        log.error("PocketBase proxy error", error);
        return new Response('Proxy request failed', { status: 502 });
    }
}
