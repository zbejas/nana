import { serverConfig } from "../../../lib/config";

/**
 * Small PocketBase transport used only by the browser facade.
 *
 * The public browser contract lives under /api/v1. PocketBase is a loopback
 * implementation detail: every call here carries the caller's own token (or is
 * an explicitly public route), and no superuser token is ever injected.
 */
const POCKETBASE_URL = serverConfig.pocketbaseUrl;
const DEFAULT_TIMEOUT_MS = 45_000;

const RESPONSE_HEADERS = [
    "content-type",
    "content-disposition",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "set-cookie",
];

export interface ForwardOptions {
    token?: string;
    body?: BodyInit;
    contentType?: string;
    /** Set to null for streaming endpoints that must stay open. */
    timeoutMs?: number | null;
    signal?: AbortSignal;
    headers?: HeadersInit;
}

function upstreamHeaders(req: Request, options: ForwardOptions): Headers {
    const headers = new Headers(options.headers);
    const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
    const contentType = isForm ? undefined : (options.contentType ?? req.headers.get("content-type"));
    if (contentType) headers.set("content-type", contentType);
    headers.set("accept", req.headers.get("accept") ?? "application/json");

    // PocketBase file routes use these for range requests and client caches.
    for (const name of ["range", "if-none-match", "if-modified-since", "last-event-id"]) {
        const value = req.headers.get(name);
        if (value) headers.set(name, value);
    }

    if (options.token) headers.set("authorization", options.token);
    return headers;
}

function copyResponseHeaders(upstream: Response): Headers {
    const headers = new Headers();
    for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

/** Forward one request to a PocketBase path, preserving query and body. */
export async function forwardToPocketBase(
    req: Request,
    path: string,
    options: ForwardOptions = {},
): Promise<Response> {
    const requestUrl = new URL(req.url);
    const target = `${POCKETBASE_URL}${path}${requestUrl.search}`;
    const method = req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : options.body;

    const timeout = options.timeoutMs === null ? undefined : (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal ?? (timeout === undefined ? undefined : AbortSignal.timeout(timeout));

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method,
            headers: upstreamHeaders(req, options),
            body,
            redirect: "manual",
            signal,
        });
    } catch {
        return Response.json(
            { code: 502, message: "The workspace is unavailable right now.", data: {} },
            { status: 502 },
        );
    }

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: copyResponseHeaders(upstream),
    });
}

/** Read the raw request body once so it can be forwarded without re-encoding. */
export async function readRawBody(req: Request): Promise<ArrayBuffer> {
    return req.arrayBuffer();
}

/** Forward a JSON-shaped request after optionally transforming its body. */
export async function forwardJson(
    req: Request,
    path: string,
    options: ForwardOptions & { body?: unknown } = {},
): Promise<Response> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return forwardToPocketBase(req, path, {
        ...options,
        body,
        contentType: "application/json",
    });
}

/** Forward a raw body with the request's original content type. */
export async function forwardRaw(
    req: Request,
    path: string,
    body: BodyInit | undefined,
    options: ForwardOptions = {},
): Promise<Response> {
    return forwardToPocketBase(req, path, {
        ...options,
        body,
        contentType: req.headers.get("content-type") ?? undefined,
    });
}
