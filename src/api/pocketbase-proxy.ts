import type { Server } from "bun";
import { serverConfig } from "../lib/config";
import { createLogger } from "../lib/logger";

const log = createLogger("Proxy");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

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

        // Read the request body once and reuse it for the upstream request.
        let bodyBuffer: ArrayBuffer | undefined;

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            bodyBuffer = await req.arrayBuffer();
        }

        const pbResponse = await fetch(pbUrl, {
            method: req.method,
            headers,
            body: bodyBuffer,
        });

        const durationMs = Date.now() - startedAt;
        log.debug(`${req.method} ${url.pathname}${url.search} → ${pbResponse.status} (${durationMs}ms)`);

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
