/**
 * Nana browser API client.
 *
 * The SPA's data layer originally used the PocketBase JS SDK against `/pb`.
 * PocketBase is now loopback-only and the public contract is Elysia `/api/v1`,
 * so this module keeps the same small client surface (`pb.collection`,
 * `pb.authStore`, `pb.files`, `pb.filter`, `pb.send`) while every request goes
 * through the first-class browser facade in `src/api/rest/browser/`.
 *
 * This is intentionally not a general PocketBase SDK. Only the methods the app
 * uses are implemented, and every write is validated again on the server.
 */

export interface RecordModel {
    id: string;
    collectionId?: string;
    collectionName?: string;
    created?: string;
    updated?: string;
    [key: string]: unknown;
}

interface AuthRecord extends RecordModel {
    email?: string;
    name?: string;
    avatar?: string;
    admin?: boolean;
    verified?: boolean;
}

interface ListResult<T> {
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    items: T[];
}

interface RequestOptions {
    method?: string;
    headers?: HeadersInit;
    body?: unknown;
    signal?: AbortSignal;
    query?: Record<string, unknown>;
    requestKey?: string | null;
    [key: string]: unknown;
}

interface QueryOptions {
    filter?: string;
    sort?: string;
    expand?: string;
    fields?: string | string[];
    page?: number;
    perPage?: number;
    skipTotal?: boolean | number;
    batch?: number;
    query?: Record<string, unknown>;
    headers?: HeadersInit;
    signal?: AbortSignal;
    requestKey?: string | null;
    [key: string]: unknown;
}

const API_BASE = "/api/v1";
const AUTH_STORAGE_KEY = "pocketbase_auth";

export class ClientResponseError extends Error {
    url = "";
    status = 0;
    response: Record<string, unknown> = {};
    isAbort = false;
    originalError: unknown = null;

    constructor(options: {
        url?: string;
        status?: number;
        data?: unknown;
        message?: string;
        isAbort?: boolean;
        originalError?: unknown;
    } = {}) {
        const response = options.data && typeof options.data === "object"
            ? options.data as Record<string, unknown>
            : {};
        const message = options.message
            ?? (typeof response.message === "string" ? response.message : undefined)
            ?? (options.isAbort ? "The request was aborted." : "Something went wrong.");
        super(message);
        this.name = `ClientResponseError ${options.status ?? 0}`;
        this.url = options.url ?? "";
        this.status = options.status ?? 0;
        this.response = response;
        this.isAbort = options.isAbort === true;
        this.originalError = options.originalError ?? null;
    }

    get data(): Record<string, unknown> {
        return this.response;
    }
}

function decodePayload(token: string): Record<string, unknown> | null {
    try {
        const part = token.split(".")[1];
        if (!part) return null;
        const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        const decoded = atob(padded);
        const payload = JSON.parse(decoded) as unknown;
        return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function tokenIsValid(token: string): boolean {
    if (!token) return false;
    const payload = decodePayload(token);
    return typeof payload?.exp === "number" && payload.exp > Date.now() / 1000;
}

function tokenUserId(token: string): string | null {
    const payload = decodePayload(token);
    return typeof payload?.id === "string" ? payload.id : null;
}

class AuthStore {
    private callbacks: Array<(token: string, record: AuthRecord | null) => void> = [];
    private storageFallback: { token?: string; record?: AuthRecord | null } = {};

    constructor(private storageKey = AUTH_STORAGE_KEY) {
        if (typeof window !== "undefined" && window.addEventListener) {
            window.addEventListener("storage", (event) => {
                if (event.key !== this.storageKey) return;
                const value = this.read();
                this.trigger(value.token ?? "", value.record ?? null);
            });
        }
    }

    private read(): { token?: string; record?: AuthRecord | null } {
        if (typeof window !== "undefined" && window.localStorage) {
            const raw = window.localStorage.getItem(this.storageKey) ?? "";
            if (!raw) return {};
            try {
                const parsed = JSON.parse(raw) as unknown;
                return parsed && typeof parsed === "object" ? parsed as { token?: string; record?: AuthRecord | null } : {};
            } catch {
                return {};
            }
        }
        return this.storageFallback;
    }

    private write(value: { token: string; record: AuthRecord | null }): void {
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem(this.storageKey, JSON.stringify(value));
        } else {
            this.storageFallback = value;
        }
    }

    get token(): string {
        return this.read().token ?? "";
    }

    get record(): AuthRecord | null {
        return this.read().record ?? null;
    }

    get isValid(): boolean {
        return tokenIsValid(this.token);
    }

    save(token: string, record: AuthRecord | null): void {
        this.write({ token: token || "", record: record || null });
        this.trigger(token || "", record || null);
    }

    clear(): void {
        if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.removeItem(this.storageKey);
        }
        this.storageFallback = {};
        this.trigger("", null);
    }

    onChange(callback: (token: string, record: AuthRecord | null) => void, fireImmediately = false): () => void {
        this.callbacks.push(callback);
        if (fireImmediately) callback(this.token, this.record);
        return () => {
            const index = this.callbacks.indexOf(callback);
            if (index >= 0) this.callbacks.splice(index, 1);
        };
    }

    private trigger(token: string, record: AuthRecord | null): void {
        for (const callback of [...this.callbacks]) {
            try {
                callback(token, record);
            } catch {
                // A listener must not break the auth transition.
            }
        }
    }
}

function serializeQuery(options: QueryOptions): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(options)) {
        if (["headers", "signal", "requestKey", "batch", "query", "fetch"].includes(key)) continue;
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            if (key === "fields") params.set(key, value.join(","));
            else for (const item of value) params.append(key, String(item));
        } else if (value !== false || key === "skipTotal") {
            params.set(key, value === true ? "1" : String(value));
        }
    }

    if (options.query) {
        for (const [key, value] of Object.entries(options.query)) {
            if (value === undefined || value === null) continue;
            if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
            else params.set(key, String(value));
        }
    }

    const query = params.toString();
    return query ? `?${query}` : "";
}

function mapLegacyPath(path: string): string {
    if (path.startsWith("/api/admin/")) return `/admin/${path.slice("/api/admin/".length)}`;
    if (path.startsWith("/api/trash/")) return `/trash/${path.slice("/api/trash/".length)}`;
    if (path.startsWith("/api/public/")) return `/public/${path.slice("/api/public/".length)}`;
    if (path === "/api/check-users") return "/check-users";
    if (path.startsWith("/api/files/")) return `/files/${path.slice("/api/files/".length)}`;
    return path;
}

class RealtimeClient {
    private eventSource: EventSource | null = null;
    private clientId = "";
    private subscriptions = new Map<string, Set<(event: unknown) => void>>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private pending = new Set<(value: void) => void>();

    get isConnected(): boolean {
        return Boolean(this.eventSource && this.clientId);
    }

    async subscribe(
        topic: string,
        callback: (event: unknown) => void,
        options?: QueryOptions,
    ): Promise<() => Promise<void>> {
        let fullTopic = topic;
        if (options) {
            // Match the PocketBase SDK: unknown subscribe options are query
            // filters, while `query` and `headers` are explicit.
            const { query: explicitQuery, headers, ...rest } = options;
            const query = { ...rest, ...(explicitQuery ?? {}) };
            if (Object.keys(query).length > 0 || headers) {
                const encoded = encodeURIComponent(JSON.stringify({ query, headers }));
                fullTopic += `${fullTopic.includes("?") ? "&" : "?"}options=${encoded}`;
            }
        }

        let listeners = this.subscriptions.get(fullTopic);
        if (!listeners) {
            listeners = new Set();
            this.subscriptions.set(fullTopic, listeners);
        }
        listeners.add(callback);

        if (this.isConnected) {
            this.eventSource?.addEventListener(fullTopic, callback as EventListener);
            await this.submitSubscriptions();
        } else {
            this.connect();
        }

        return async () => {
            const current = this.subscriptions.get(fullTopic);
            current?.delete(callback);
            this.eventSource?.removeEventListener(fullTopic, callback as EventListener);
            if (current && current.size === 0) this.subscriptions.delete(fullTopic);
            if (this.subscriptions.size === 0) this.disconnect();
            else if (this.isConnected) await this.submitSubscriptions();
        };
    }

    async unsubscribe(topic: string): Promise<void> {
        const target = topic.endsWith("?") ? topic : `${topic}?`;
        let changed = false;
        for (const key of [...this.subscriptions.keys()]) {
            if (!`${key}?`.startsWith(target)) continue;
            for (const listener of this.subscriptions.get(key) ?? []) {
                this.eventSource?.removeEventListener(key, listener as EventListener);
            }
            this.subscriptions.delete(key);
            changed = true;
        }
        if (changed) {
            if (this.subscriptions.size === 0) this.disconnect();
            else if (this.isConnected) await this.submitSubscriptions();
        }
    }

    async unsubscribeByPrefix(prefix: string): Promise<void> {
        let changed = false;
        for (const key of [...this.subscriptions.keys()]) {
            if (!`${key}?`.startsWith(prefix)) continue;
            for (const listener of this.subscriptions.get(key) ?? []) {
                this.eventSource?.removeEventListener(key, listener as EventListener);
            }
            this.subscriptions.delete(key);
            changed = true;
        }
        if (changed) {
            if (this.subscriptions.size === 0) this.disconnect();
            else if (this.isConnected) await this.submitSubscriptions();
        }
    }

    private connect(): void {
        if (typeof window === "undefined" || this.eventSource) return;

        this.eventSource = new EventSource(`${API_BASE}/realtime`);
        const timeout = setTimeout(() => {
            if (!this.clientId) this.disconnect(true);
        }, 15_000);

        this.eventSource.addEventListener("PB_CONNECT", (event: MessageEvent) => {
            this.clientId = event.lastEventId ?? "";
            clearTimeout(timeout);
            this.reconnectAttempts = 0;

            for (const [topic, listeners] of this.subscriptions) {
                for (const listener of listeners) {
                    this.eventSource?.addEventListener(topic, listener as EventListener);
                }
            }

            this.submitSubscriptions().then(() => {
                for (const resolve of this.pending) resolve();
                this.pending.clear();
            }).catch(() => {
                this.disconnect(true);
            });
        });

        this.eventSource.onerror = () => {
            clearTimeout(timeout);
            this.disconnect(true);
        };
    }

    private async submitSubscriptions(): Promise<void> {
        if (!this.clientId) {
            await new Promise<void>((resolve) => this.pending.add(resolve));
            return;
        }

        const subscriptions = [...this.subscriptions.keys()].filter((topic) =>
            (this.subscriptions.get(topic)?.size ?? 0) > 0
        );
        const response = await fetch(`${API_BASE}/realtime`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: pb.authStore.token,
            },
            body: JSON.stringify({ clientId: this.clientId, subscriptions }),
        });
        if (!response.ok) throw new Error("Realtime subscription failed.");
    }

    disconnect(shouldReconnect = false): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.eventSource?.close();
        this.eventSource = null;
        this.clientId = "";

        if (!shouldReconnect || this.subscriptions.size === 0) return;
        const intervals = [200, 300, 500, 1000, 1200, 1500, 2000];
        const delay = intervals[Math.min(this.reconnectAttempts, intervals.length - 1)];
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
}

class RecordCollection<T extends RecordModel = RecordModel> {
    constructor(
        private client: NanaClient,
        private name: string,
    ) {}

    async getList(page = 1, perPage = 30, options: QueryOptions = {}): Promise<ListResult<T>> {
        const query = serializeQuery({ ...options, page, perPage });
        return this.client.request<ListResult<T>>(`/records/${encodeURIComponent(this.name)}${query}`);
    }

    async getFullList(options: QueryOptions = {}): Promise<T[]> {
        const batch = typeof options.batch === "number" ? options.batch : 1000;
        const items: T[] = [];
        let page = 1;

        while (true) {
            const result = await this.getList(page, batch, options);
            items.push(...(result.items ?? []));
            if (!result.items || result.items.length < result.perPage) break;
            page += 1;
        }

        return items;
    }

    async getFirstListItem(filter: string, options: QueryOptions = {}): Promise<T> {
        const result = await this.getList(1, 1, { ...options, filter, skipTotal: 1 });
        const item = result.items?.[0];
        if (!item) {
            throw new ClientResponseError({
                status: 404,
                data: { code: 404, message: "The requested resource wasn't found.", data: {} },
            });
        }
        return item;
    }

    async getOne(id: string, options: QueryOptions = {}): Promise<T> {
        const query = serializeQuery(options);
        return this.client.request<T>(`/records/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}${query}`);
    }

    async create<R = T>(body: unknown, options: QueryOptions = {}): Promise<R> {
        const query = serializeQuery(options);
        return this.client.request<R>(`/records/${encodeURIComponent(this.name)}${query}`, {
            method: "POST",
            body,
        });
    }

    async update<R = T>(id: string, body: unknown, options: QueryOptions = {}): Promise<R> {
        const query = serializeQuery(options);
        const result = await this.client.request<R>(`/records/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}${query}`, {
            method: "PATCH",
            body,
        });

        const current = this.client.authStore.record;
        if (this.name === "users" && current?.id === id && result && typeof result === "object") {
            this.client.authStore.save(this.client.authStore.token, result as unknown as AuthRecord);
        }
        return result;
    }

    async delete(id: string, options: QueryOptions = {}): Promise<boolean> {
        const query = serializeQuery(options);
        await this.client.request(`/records/${encodeURIComponent(this.name)}/${encodeURIComponent(id)}${query}`, {
            method: "DELETE",
        });
        if (this.name === "users" && this.client.authStore.record?.id === id) {
            this.client.authStore.clear();
        }
        return true;
    }

    async subscribe(
        topic: string,
        callback: (event: unknown) => void,
        options?: QueryOptions,
    ): Promise<() => Promise<void>> {
        return this.client.realtime.subscribe(`${this.name}/${topic}`, callback, options);
    }

    async unsubscribe(topic?: string): Promise<void> {
        if (topic) return this.client.realtime.unsubscribe(`${this.name}/${topic}`);
        return this.client.realtime.unsubscribeByPrefix(this.name);
    }

    async listAuthMethods(options: QueryOptions = {}): Promise<Record<string, unknown>> {
        const query = serializeQuery({ fields: "mfa,otp,password,oauth2", ...options });
        return this.client.request<Record<string, unknown>>(`/auth/methods${query}`);
    }

    async authWithPassword(identity: string, password: string): Promise<{ token: string; record: AuthRecord }> {
        const result = await this.client.request<{ token: string; record: AuthRecord }>("/auth/login", {
            method: "POST",
            body: { identity, password },
        });
        return this.client.saveAuth(result);
    }

    async authRefresh(): Promise<{ token: string; record: AuthRecord }> {
        const result = await this.client.request<{ token: string; record: AuthRecord }>("/auth/refresh", {
            method: "POST",
        });
        return this.client.saveAuth(result);
    }

    async requestPasswordReset(email: string): Promise<boolean> {
        await this.client.request("/auth/password-reset/request", {
            method: "POST",
            body: { email },
        });
        return true;
    }

    async confirmPasswordReset(token: string, password: string, passwordConfirm: string): Promise<boolean> {
        await this.client.request("/auth/password-reset/confirm", {
            method: "POST",
            body: { token, password, passwordConfirm },
        });
        return true;
    }

    async requestEmailChange(newEmail: string): Promise<boolean> {
        await this.client.request("/auth/email-change/request", {
            method: "POST",
            body: { newEmail },
        });
        return true;
    }

    async confirmEmailChange(token: string, password: string): Promise<boolean> {
        await this.client.request("/auth/email-change/confirm", {
            method: "POST",
            body: { token, password },
        });
        if (this.client.authStore.record?.id === tokenUserId(token)) {
            this.client.authStore.clear();
        }
        return true;
    }

    async authWithOAuth2(options: {
        provider: string;
        scopes?: string[];
        createData?: Record<string, unknown>;
        urlCallback?: (url: string) => void | Promise<void>;
    }): Promise<{ token: string; record: AuthRecord }> {
        const methods = await this.listAuthMethods();
        const oauth2 = methods.oauth2 as { providers?: Array<{ name: string; authURL: string }> } | undefined;
        const provider = oauth2?.providers?.find((item) => item.name === options.provider);
        if (!provider) {
            throw new ClientResponseError({ message: `Missing or invalid provider "${options.provider}".` });
        }

        const redirectURL = `${window.location.origin}/api/v1/auth/oauth2/callback`;
        const state = crypto.randomUUID();
        const authURL = new URL(provider.authURL);
        authURL.searchParams.set("redirect_uri", redirectURL);
        authURL.searchParams.set("state", state);
        if (options.scopes?.length) authURL.searchParams.set("scope", options.scopes.join(" "));

        const popup = options.urlCallback
            ? await options.urlCallback(authURL.toString())
            : window.open(
                authURL.toString(),
                "popup_window",
                "width=1024,height=768,resizable,menubar=no",
            );
        if (!options.urlCallback && !popup) {
            throw new ClientResponseError({ message: "The browser blocked the sign-in popup." });
        }

        const query = await new Promise<Record<string, string>>((resolve) => {
            const handler = (event: MessageEvent) => {
                if (event.origin !== window.location.origin) return;
                const data = event.data as { type?: string; query?: Record<string, string> } | null;
                if (data?.type !== "nana-oauth2" || !data.query) return;
                window.removeEventListener("message", handler);
                resolve(data.query);
            };
            window.addEventListener("message", handler);
        });

        if (query.error) throw new ClientResponseError({ message: query.error_description ?? query.error });
        if (query.state !== state) throw new ClientResponseError({ message: "OAuth state did not match." });
        if (!query.code) throw new ClientResponseError({ message: "OAuth provider returned no code." });

        const result = await this.client.request<{ token: string; record: AuthRecord }>("/auth/oauth2", {
            method: "POST",
            body: {
                provider: provider.name,
                code: query.code,
                codeVerifier: query.code_verifier ?? "",
                redirectURL,
                createData: options.createData ?? {},
            },
        });
        return this.client.saveAuth(result);
    }
}

class NanaClient {
    readonly authStore = new AuthStore();
    readonly realtime = new RealtimeClient();
    readonly files = {
        getURL: (
            record: { id?: string; collectionId?: string; collectionName?: string },
            filename: string,
            options: Record<string, unknown> = {},
        ): string => {
            if (!filename || !record?.id || (!record.collectionId && !record.collectionName)) return "";
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options)) {
                if (value === undefined || value === null || value === false) continue;
                params.set(key, String(value));
            }
            const query = params.toString();
            // Prefer the collection name so the facade can allowlist it; PB
            // accepts either a collection id or name on file routes.
            return `${API_BASE}/files/${encodeURIComponent(record.collectionName || record.collectionId || "")}/${encodeURIComponent(record.id)}/${encodeURIComponent(filename)}${query ? `?${query}` : ""}`;
        },
        getToken: async (): Promise<string> => {
            const result = await this.request<{ token?: string }>("/files/token", { method: "POST" });
            return typeof result.token === "string" ? result.token : "";
        },
    };

    private collections = new Map<string, RecordCollection>();

    collection<T extends RecordModel = RecordModel>(name: string): RecordCollection<T> {
        const existing = this.collections.get(name);
        if (existing) return existing as RecordCollection<T>;
        const collection = new RecordCollection<T>(this, name);
        this.collections.set(name, collection as RecordCollection);
        return collection;
    }

    filter(expression: string, params?: Record<string, unknown>): string {
        if (!params) return expression;
        let out = expression;
        for (const [key, value] of Object.entries(params)) {
            let replacement: string;
            switch (typeof value) {
                case "boolean":
                case "number":
                    replacement = String(value);
                    break;
                case "string":
                    replacement = `'${value.replace(/'/g, "\\'")}'`;
                    break;
                default:
                    replacement = value === null
                        ? "null"
                        : value instanceof Date
                            ? `'${value.toISOString().replace("T", " ")}'`
                            : `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
            }
            out = out.replaceAll(`{:${key}}`, replacement);
        }
        return out;
    }

    async send<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
        return this.request<T>(mapLegacyPath(path), options);
    }

    saveAuth(result: { token: string; record: AuthRecord }): { token: string; record: AuthRecord } {
        this.authStore.save(result.token, result.record);
        return { ...result, token: result.token ?? "", record: result.record ?? {} as AuthRecord };
    }

    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
        const method = (options.method ?? "GET").toUpperCase();
        const headers = new Headers(options.headers);
        const tokenAtStart = this.authStore.token;

        if (tokenAtStart && !headers.has("authorization")) {
            headers.set("authorization", tokenAtStart);
        }

        let body: BodyInit | undefined;
        if (method !== "GET" && method !== "HEAD" && options.body !== undefined) {
            if (options.body instanceof FormData) {
                body = options.body;
            } else if (typeof options.body === "string" || options.body instanceof Blob || options.body instanceof ArrayBuffer) {
                body = options.body;
            } else {
                headers.set("content-type", "application/json");
                body = JSON.stringify(options.body);
            }
        }

        const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body,
                signal: options.signal,
            });
        } catch (error) {
            throw new ClientResponseError({
                url,
                status: 0,
                message: "Failed to connect to the server.",
                isAbort: (error as { name?: string })?.name === "AbortError",
                originalError: error,
            });
        }

        const text = await response.text();
        let data: unknown = {};
        if (text.trim()) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!response.ok) {
            if (response.status === 401 && tokenAtStart && tokenAtStart === this.authStore.token) {
                this.authStore.clear();
            }
            throw new ClientResponseError({
                url,
                status: response.status,
                data,
            });
        }

        return data as T;
    }
}

export const pb = new NanaClient();

/** Clear the local session only when the failing request used its token. */
export function invalidateAuthOnUnauthorized(status: number, requestToken?: string): void {
    if (status !== 401) return;
    if (requestToken && requestToken !== pb.authStore.token) return;
    pb.authStore.clear();
}
