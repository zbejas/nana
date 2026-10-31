import { serverConfig } from "../../lib/config";
import { createLogger } from "../../lib/logger";
import { escapeFilterString, isValidRecordId } from "../chat/tools/text";
import { getSuperuserToken, invalidateSuperuserToken } from "../chat/superuser";
import { badRequest, notFound, upstream } from "../workspace/errors";
import { generateApiKeyToken, hashApiKey, isApiKeyToken } from "./token";
import {
    isApiKeyAccess,
    isApiKeyScope,
    type ApiKeyAccess,
    type ApiKeyDto,
    type ApiKeyPermission,
    type ApiKeyScope,
    type CreatedApiKey,
    type CreateApiKeyInput,
} from "./types";

const log = createLogger("APIKeys");

const API_KEY_PREFIX_LENGTH = 16;
const MAX_KEY_NAME = 80;
const MAX_SCOPED_FOLDERS = 20;
const LOOKUP_TIMEOUT_MS = 8_000;
const MANAGEMENT_TIMEOUT_MS = 15_000;
const TOUCH_INTERVAL_MS = 60_000;
const TOKEN_CACHE_MS = 15 * 60_000;

interface PBApiKeyRecord {
    id: string;
    name?: string;
    key_prefix?: string;
    key_hash?: string;
    access?: string;
    scope?: string;
    folders?: string[];
    last_used_at?: string;
    author?: string;
    created?: string;
    updated?: string;
    expand?: {
        folders?: Array<{ id?: string; name?: string }>;
    };
}

interface PBListResponse<T> {
    items: T[];
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
}

export interface ResolvedApiKey {
    userId: string;
    permission: ApiKeyPermission;
}

interface CachedUserToken {
    token: string;
    expiresAt: number;
}

const userTokenCache = new Map<string, CachedUserToken>();
const lastTouched = new Map<string, number>();

export { generateApiKeyToken, hashApiKey, isApiKeyToken } from "./token";

// ── Superuser transport ──────────────────────────────────────────────

/**
 * Credential metadata is superuser-only in PocketBase. Bun verifies the caller
 * first, then reads or writes this collection directly; the superuser token is
 * never placed in a ToolContext or returned to a client.
 */
async function superuserRequest(
    path: string,
    init: RequestInit = {},
    timeoutMs = MANAGEMENT_TIMEOUT_MS,
): Promise<Response> {
    const url = `${serverConfig.pocketbaseUrl}${path}`;

    const send = async (token: string): Promise<Response> => {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/json");
        if (init.body !== undefined) headers.set("Content-Type", "application/json");
        headers.set("Authorization", token);
        try {
            return await fetch(url, {
                ...init,
                headers,
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch {
            throw upstream("The workspace is unavailable right now.");
        }
    };

    let token: string;
    try {
        token = await getSuperuserToken();
    } catch {
        throw upstream("The workspace is unavailable right now.");
    }

    let response = await send(token);
    if (response.status === 401) {
        invalidateSuperuserToken();
        try {
            token = await getSuperuserToken();
        } catch {
            throw upstream("The workspace is unavailable right now.");
        }
        response = await send(token);
    }
    return response;
}

async function readJson<T>(response: Response): Promise<T | null> {
    try {
        return (await response.json()) as T;
    } catch {
        return null;
    }
}

// ── Resolution ───────────────────────────────────────────────────────

function permissionFromRecord(record: PBApiKeyRecord): ApiKeyPermission | null {
    if (typeof record.id !== "string" || !record.id) return null;
    if (!isApiKeyAccess(record.access) || !isApiKeyScope(record.scope)) return null;

    const folderIds = Array.isArray(record.folders)
        ? record.folders.filter((id): id is string => typeof id === "string" && isValidRecordId(id))
        : [];

    return {
        id: record.id,
        access: record.access,
        scope: record.scope,
        folderIds: record.scope === "folders" ? folderIds : [],
    };
}

/**
 * Look up a key by its hash and return the owning user plus its permission
 * envelope. A missing or malformed record is an invalid credential, not an
 * upstream failure. The hash is the only value compared.
 */
export async function resolveApiKeyToken(token: string): Promise<ResolvedApiKey | null> {
    if (!isApiKeyToken(token)) return null;

    const hash = await hashApiKey(token);
    const filter = encodeURIComponent(`key_hash="${hash}"`);
    const response = await superuserRequest(
        `/api/collections/api_keys/records?filter=${filter}&perPage=1&fields=id,author,access,scope,folders,last_used_at`,
        { method: "GET" },
        LOOKUP_TIMEOUT_MS,
    );

    if (!response.ok) {
        throw upstream("The workspace is unavailable right now.");
    }

    const data = await readJson<PBListResponse<PBApiKeyRecord>>(response);
    const record = data?.items?.[0];
    if (!record || typeof record.author !== "string" || !record.author) return null;

    const permission = permissionFromRecord(record);
    if (!permission) return null;

    touchApiKey(record.id);
    return { userId: record.author, permission };
}

/** Read the JWT `exp` so the cache never outlives the minted token. */
function tokenExpiresAt(token: string): number | null {
    try {
        const part = token.split(".")[1];
        if (!part) return null;
        const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as {
            exp?: unknown;
        };
        return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

/**
 * Mint a short-lived-in-process PocketBase token for the key's owner. The
 * token is cached server-side and never returned to the API caller. It is a
 * normal user token, so PocketBase collection rules stay in force.
 */
export async function mintUserToken(userId: string): Promise<string> {
    const cached = userTokenCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.token;
    if (cached) userTokenCache.delete(userId);

    const response = await superuserRequest(
        `/api/collections/users/impersonate/${encodeURIComponent(userId)}`,
        { method: "POST", body: "{}" },
    );
    if (!response.ok) {
        throw upstream("The workspace is unavailable right now.");
    }

    const data = await readJson<{ token?: string }>(response);
    if (!data?.token) {
        throw upstream("The workspace is unavailable right now.");
    }

    const expiry = tokenExpiresAt(data.token);
    const expiresAt = expiry === null
        ? now + TOKEN_CACHE_MS
        : Math.min(now + TOKEN_CACHE_MS, expiry - 30_000);
    if (expiresAt > now) {
        userTokenCache.set(userId, { token: data.token, expiresAt });
    }
    return data.token;
}

/** Record usage at most once a minute per key; failures are never fatal. */
function touchApiKey(id: string): void {
    const now = Date.now();
    const previous = lastTouched.get(id) ?? 0;
    if (now - previous < TOUCH_INTERVAL_MS) return;
    lastTouched.set(id, now);

    void superuserRequest(
        `/api/collections/api_keys/records/${encodeURIComponent(id)}`,
        {
            method: "PATCH",
            body: JSON.stringify({ last_used_at: new Date().toISOString() }),
        },
        LOOKUP_TIMEOUT_MS,
    ).catch((error) => {
        log.warn("Could not record API key usage", {
            error: error instanceof Error ? error.name : "unknown",
        });
    });
}

// ── Owner management ─────────────────────────────────────────────────

function toDto(record: PBApiKeyRecord, folderNames = new Map<string, string>()): ApiKeyDto {
    const expanded = new Map<string, string>();
    for (const folder of record.expand?.folders ?? []) {
        if (typeof folder.id === "string") {
            expanded.set(folder.id, (folder.name ?? "").trim());
        }
    }

    const folders = (Array.isArray(record.folders) ? record.folders : [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({
            id,
            name: folderNames.get(id) || expanded.get(id) || "Unavailable folder",
        }));

    return {
        id: record.id,
        name: (record.name ?? "").trim() || "API key",
        prefix: record.key_prefix ?? "",
        access: isApiKeyAccess(record.access) ? record.access : "read",
        scope: isApiKeyScope(record.scope) ? record.scope : "workspace",
        folders,
        lastUsedAt: record.last_used_at || null,
        createdAt: record.created || "",
    };
}

function normalizeFolderIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of value) {
        if (!isValidRecordId(item)) {
            throw badRequest("One or more selected folders are not valid.");
        }
        if (seen.has(item)) continue;
        seen.add(item);
        result.push(item);
        if (result.length > MAX_SCOPED_FOLDERS) {
            throw badRequest(`A key can be limited to at most ${MAX_SCOPED_FOLDERS} folders.`);
        }
    }

    return result;
}

async function loadOwnedFolders(userId: string, folderIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();

    for (const id of folderIds) {
        const response = await superuserRequest(
            `/api/collections/folders/records/${encodeURIComponent(id)}?fields=id,name,author,deleted_at`,
            { method: "GET" },
        );
        if (!response.ok) {
            throw badRequest("One or more selected folders are not available.");
        }

        const record = await readJson<{ id?: string; name?: string; author?: string; deleted_at?: string }>(response);
        if (!record || record.author !== userId || record.deleted_at) {
            throw badRequest("One or more selected folders are not available.");
        }
        names.set(id, (record.name ?? "").trim() || "Untitled folder");
    }

    return names;
}

export async function listApiKeysForUser(userId: string): Promise<ApiKeyDto[]> {
    const records: PBApiKeyRecord[] = [];
    let page = 1;
    let totalPages = 1;

    do {
        const filter = encodeURIComponent(`author="${escapeFilterString(userId)}"`);
        const response = await superuserRequest(
            `/api/collections/api_keys/records?filter=${filter}&sort=-created&page=${page}&perPage=100&expand=folders`,
            { method: "GET" },
        );
        if (!response.ok) {
            throw upstream("The workspace is unavailable right now.");
        }

        const data = await readJson<PBListResponse<PBApiKeyRecord>>(response);
        const items = Array.isArray(data?.items) ? data.items : [];
        for (const item of items) {
            if (item && typeof item.id === "string") records.push(item);
        }

        totalPages = typeof data?.totalPages === "number" && data.totalPages > 0
            ? data.totalPages
            : page;
        if (items.length === 0) break;
        page += 1;
    } while (page <= totalPages);

    return records.map((record) => toDto(record));
}

export async function createApiKeyForUser(
    userId: string,
    input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw badRequest("A key name is required.");
    if (name.length > MAX_KEY_NAME) {
        throw badRequest(`Key names must be ${MAX_KEY_NAME} characters or fewer.`);
    }
    if (!isApiKeyAccess(input.access)) throw badRequest("That key access level is not valid.");
    if (!isApiKeyScope(input.scope)) throw badRequest("That key scope is not valid.");

    let folderIds = normalizeFolderIds(input.folderIds);
    if (input.scope === "folders") {
        if (folderIds.length === 0) {
            throw badRequest("Choose at least one folder for a folder-scoped key.");
        }
    } else {
        folderIds = [];
    }

    const folderNames = await loadOwnedFolders(userId, folderIds);
    const token = generateApiKeyToken();
    const keyHash = await hashApiKey(token);

    const response = await superuserRequest("/api/collections/api_keys/records", {
        method: "POST",
        body: JSON.stringify({
            name,
            key_prefix: token.slice(0, API_KEY_PREFIX_LENGTH),
            key_hash: keyHash,
            author: userId,
            access: input.access,
            scope: input.scope,
            folders: folderIds,
        }),
    });
    if (!response.ok) {
        throw upstream("The API key could not be created.");
    }

    const record = await readJson<PBApiKeyRecord>(response);
    if (!record || typeof record.id !== "string") {
        throw upstream("The API key could not be created.");
    }

    return { token, apiKey: toDto(record, folderNames) };
}

export async function revokeApiKeyForUser(userId: string, id: string): Promise<void> {
    if (!isValidRecordId(id)) throw notFound();

    const response = await superuserRequest(
        `/api/collections/api_keys/records/${encodeURIComponent(id)}?fields=id,author`,
        { method: "GET" },
    );
    if (!response.ok) throw notFound();

    const record = await readJson<{ id?: string; author?: string }>(response);
    if (!record || record.author !== userId) throw notFound();

    const deleted = await superuserRequest(
        `/api/collections/api_keys/records/${encodeURIComponent(id)}`,
        { method: "DELETE" },
    );
    if (!deleted.ok) {
        throw upstream("The API key could not be revoked.");
    }

    lastTouched.delete(id);
}

export type { ApiKeyAccess, ApiKeyDto, ApiKeyPermission, ApiKeyScope, CreatedApiKey, CreateApiKeyInput };
