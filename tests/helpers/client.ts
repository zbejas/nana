/**
 * Small HTTP helpers shared by the integration suite.
 *
 * Everything here talks to the real stack: `bunRequest` hits the Bun origin
 * and `pbRequest` hits the loopback PocketBase origin for fixtures and hook/
 * route assertions. Browser-facing behavior lives under `/api/v1` and is
 * covered separately. Helpers throw with the response body attached so a
 * failing assertion shows the server's own explanation.
 */

import { BASE_URL, PB_API } from "./setup";

export type JsonObject = Record<string, unknown>;
export type QueryValue = string | number | boolean | undefined;

function absoluteUrl(base: string, path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function bunUrl(path: string): string {
    return absoluteUrl(BASE_URL, path);
}

export function pbUrl(path: string): string {
    return absoluteUrl(PB_API, path);
}

export function bunRequest(path: string, init?: RequestInit): Promise<Response> {
    return fetch(bunUrl(path), init);
}

export function pbRequest(path: string, init?: RequestInit): Promise<Response> {
    return fetch(pbUrl(path), init);
}

/**
 * Assert an HTTP status without swallowing the response body on failure.
 * The body is read from a clone so the caller can still consume the response.
 */
export async function expectStatus(
    res: Response,
    expected: number | number[],
    label = "request",
): Promise<void> {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (expectedStatuses.includes(res.status)) return;

    let body = "";
    try {
        body = await res.clone().text();
    } catch {
        body = "<unreadable body>";
    }

    throw new Error(
        `${label}: expected ${expectedStatuses.join(" or ")}, got ${res.status}${body ? `: ${body}` : ""}`,
    );
}

/** Parse JSON and fail with a useful message when the body is not JSON. */
export async function readJson<T>(res: Response, label = "response"): Promise<T> {
    const fallback = res.clone();
    try {
        return (await res.json()) as T;
    } catch {
        const body = await fallback.text().catch(() => "<unreadable>");
        throw new Error(`${label}: expected JSON, got ${body}`);
    }
}

export async function expectJsonError(
    res: Response,
    expected: number | number[],
    messageContains?: string,
): Promise<{ error?: string }> {
    await expectStatus(res, expected);
    const data = await readJson<{ error?: string }>(res, "error response");
    if (messageContains !== undefined) {
        const message = data.error ?? "";
        if (!message.includes(messageContains)) {
            throw new Error(`error message ${JSON.stringify(message)} did not contain ${JSON.stringify(messageContains)}`);
        }
    }
    return data;
}

function queryString(query?: Record<string, QueryValue>): string {
    if (!query) return "";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, String(value));
    }
    const encoded = search.toString();
    return encoded ? `?${encoded}` : "";
}

export async function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return bunRequest(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

export async function patchJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return bunRequest(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

// ── PocketBase collection helpers ────────────────────────────────────

interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}

export async function pbCreate<T extends object>(
    token: string,
    collection: string,
    body: JsonObject,
): Promise<T> {
    const res = await pbRequest(`/collections/${collection}/records`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    await expectStatus(res, 200, `create ${collection}`);
    return readJson<T>(res, `create ${collection}`);
}

export async function pbUpdate<T extends object>(
    token: string,
    collection: string,
    id: string,
    body: JsonObject,
): Promise<T> {
    const res = await pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    await expectStatus(res, 200, `update ${collection}/${id}`);
    return readJson<T>(res, `update ${collection}/${id}`);
}

export async function pbDelete(token: string, collection: string, id: string): Promise<void> {
    const res = await pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: token },
    });
    await expectStatus(res, 204, `delete ${collection}/${id}`);
}

export async function pbGetRecord<T extends object>(
    token: string,
    collection: string,
    id: string,
): Promise<T> {
    const res = await pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        headers: { Authorization: token },
    });
    await expectStatus(res, 200, `get ${collection}/${id}`);
    return readJson<T>(res, `get ${collection}/${id}`);
}

export async function pbList<T extends object>(
    token: string,
    collection: string,
    query?: Record<string, QueryValue>,
): Promise<PBListResponse<T>> {
    const res = await pbRequest(`/collections/${collection}/records${queryString(query)}`, {
        headers: { Authorization: token },
    });
    await expectStatus(res, 200, `list ${collection}`);
    return readJson<PBListResponse<T>>(res, `list ${collection}`);
}

/** Return the first matching record, or null when the filter matches nothing. */
export async function pbFindFirst<T extends object>(
    token: string,
    collection: string,
    filter: string,
): Promise<T | null> {
    const page = await pbList<T>(token, collection, { filter, perPage: 1 });
    return page.items[0] ?? null;
}

/** Record existence check through a token that is allowed to see the record. */
export async function pbRecordExists(token: string, collection: string, id: string): Promise<boolean> {
    const res = await pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        headers: { Authorization: token },
    });
    return res.ok;
}
