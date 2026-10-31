import type { Server } from "bun";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { serverConfig } from "../lib/config";
import { getSuperuserToken, invalidateSuperuserToken } from "./chat/superuser";
import { createLogger } from "../lib/logger";

const log = createLogger("RateLimit");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;
const SETTINGS_KEY = "rate_limits";
const SETTINGS_DESCRIPTION = "Rate limiting configuration for the Bun server (per-IP, in-memory)";
const MAX_REQUESTS_PER_MINUTE = 1_000_000;

// ── Types ────────────────────────────────────────────────────────────

export interface RateLimitConfig {
    enabled: boolean;
    /** Max requests per minute for /api/v1/* routes. Kept under the legacy
     * `pbMaxPerMinute` key so existing settings records keep working. */
    pbMaxPerMinute: number;
    /** Max requests per minute for all other routes (app / static) */
    appMaxPerMinute: number;
}

/** Owner-facing shape used by the admin API and settings UI. */
export interface RateLimitSettings {
    enabled: boolean;
    /** Per-IP ceiling for /api/v1/*. */
    apiPerMinute: number;
    /** Per-IP ceiling for every other route. */
    otherPerMinute: number;
}

export interface RateLimitDefaults {
    apiPerMinute: number;
    otherPerMinute: number;
}

export interface RateLimitScopes {
    api: string[];
    other: string[];
}

export const defaultRateLimitConfig: RateLimitConfig = {
    enabled: false,
    pbMaxPerMinute: 600,
    appMaxPerMinute: 1200,
};

export const rateLimitDefaults: RateLimitDefaults = {
    apiPerMinute: defaultRateLimitConfig.pbMaxPerMinute,
    otherPerMinute: defaultRateLimitConfig.appMaxPerMinute,
};

/**
 * Route groups the limiter checks. `/api/v1/*` is matched first; everything
 * else falls through to the app bucket.
 */
export const rateLimitScopes: RateLimitScopes = {
    api: ["/api/v1/*"],
    other: ["/mcp", "/api/chat/*", "/api/export", "/docs", "/*"],
};

/** PocketBase settings storage failure, with the upstream status preserved. */
export class RateLimitStoreError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
        this.name = "RateLimitStoreError";
    }
}

// ── Internal state ───────────────────────────────────────────────────

let config: RateLimitConfig = { ...defaultRateLimitConfig };
let pbLimiter: RateLimiterMemory | null = null;
let appLimiter: RateLimiterMemory | null = null;

// ── Helpers ──────────────────────────────────────────────────────────

function positiveInteger(value: unknown, fallback: number): number {
    return typeof value === "number" &&
        Number.isInteger(value) &&
        value > 0 &&
        value <= MAX_REQUESTS_PER_MINUTE
        ? value
        : fallback;
}

function normalizeSettings(value: Partial<RateLimitConfig> | null | undefined): RateLimitSettings {
    return {
        enabled: value?.enabled === true,
        apiPerMinute: positiveInteger(value?.pbMaxPerMinute, rateLimitDefaults.apiPerMinute),
        otherPerMinute: positiveInteger(value?.appMaxPerMinute, rateLimitDefaults.otherPerMinute),
    };
}

function toConfig(settings: RateLimitSettings): RateLimitConfig {
    return {
        enabled: settings.enabled,
        pbMaxPerMinute: settings.apiPerMinute,
        appMaxPerMinute: settings.otherPerMinute,
    };
}

interface SettingsRecord {
    id: string;
    value?: Partial<RateLimitConfig>;
}

interface SettingsList {
    items?: SettingsRecord[];
}

/**
 * Read or write the rate_limits record with the superuser token. The token is
 * retried once after a 401/403 so a stale cached credential heals itself.
 */
async function requestSettings<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
): Promise<T> {
    const token = await getSuperuserToken();
    const response = await fetch(`${POCKETBASE_URL}${path}`, {
        ...init,
        headers: {
            Authorization: token,
            Accept: "application/json",
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
        },
        signal: AbortSignal.timeout(8_000),
    });

    if ((response.status === 401 || response.status === 403) && retry) {
        invalidateSuperuserToken();
        return requestSettings<T>(path, init, false);
    }

    if (!response.ok) {
        throw new RateLimitStoreError(
            `PocketBase ${init.method ?? "GET"} ${path} failed (${response.status})`,
            response.status,
        );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
}

async function fetchRateLimitRecord(): Promise<SettingsRecord | null> {
    const data = await requestSettings<SettingsList>(
        `/api/collections/settings/records?filter=(key='${SETTINGS_KEY}')&perPage=1`,
    );
    return data.items?.[0] ?? null;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * (Re)create limiter instances from the given config.
 * Safe to call multiple times (old instances are discarded).
 */
export function initRateLimiter(cfg: RateLimitConfig): void {
    config = { ...cfg };

    if (!config.enabled) {
        pbLimiter = null;
        appLimiter = null;
        return;
    }

    pbLimiter = new RateLimiterMemory({
        points: config.pbMaxPerMinute,
        duration: 60, // seconds
    });

    appLimiter = new RateLimiterMemory({
        points: config.appMaxPerMinute,
        duration: 60,
    });
}

/**
 * Check rate limit for an incoming request.
 * Returns a 429 Response if the client is rate-limited, or `null` if allowed.
 */
export async function checkRateLimit(
    req: Request,
    server: Server<any>,
): Promise<Response | null> {
    if (!config.enabled) return null;

    const url = new URL(req.url);
    const isApi = url.pathname.startsWith("/api/v1");
    const limiter = isApi ? pbLimiter : appLimiter;
    if (!limiter) return null;

    // Resolve client IP
    const addr = server.requestIP(req);
    const ip = addr?.address ?? "unknown";

    try {
        await limiter.consume(ip);
        return null; // Allowed
    } catch (rlRes: any) {
        // rlRes is a RateLimiterRes when rate-limited
        const retryAfter = Math.ceil((rlRes.msBeforeNext ?? 1000) / 1000);
        return new Response("Too Many Requests", {
            status: 429,
            headers: {
                "Retry-After": String(retryAfter),
                "Content-Type": "text/plain",
            },
        });
    }
}

/**
 * Load rate limit config from PocketBase settings collection.
 * Falls back to defaults if the record doesn't exist or PocketBase is unreachable.
 */
export async function loadRateLimitConfig(): Promise<RateLimitConfig> {
    try {
        const record = await fetchRateLimitRecord();
        return toConfig(normalizeSettings(record?.value));
    } catch (err) {
        log.warn("Could not load config from PocketBase, using defaults", err);
        return { ...defaultRateLimitConfig };
    }
}

/**
 * Read the persisted rate-limit settings for the admin API. Unlike the startup
 * loader, this surfaces PocketBase failures instead of silently using defaults.
 */
export async function readRateLimitSettings(): Promise<RateLimitSettings> {
    const record = await fetchRateLimitRecord();
    return normalizeSettings(record?.value);
}

/**
 * Persist rate-limit settings and apply them immediately. Uses the superuser
 * token because `settings` is admin-only, and never trusts a caller's role.
 */
export async function saveRateLimitSettings(input: RateLimitSettings): Promise<RateLimitSettings> {
    if (
        typeof input.enabled !== "boolean" ||
        !Number.isInteger(input.apiPerMinute) ||
        input.apiPerMinute < 1 ||
        input.apiPerMinute > MAX_REQUESTS_PER_MINUTE ||
        !Number.isInteger(input.otherPerMinute) ||
        input.otherPerMinute < 1 ||
        input.otherPerMinute > MAX_REQUESTS_PER_MINUTE
    ) {
        throw new RateLimitStoreError("Request limits must be positive whole numbers.", 400);
    }

    const value = {
        enabled: input.enabled === true,
        pbMaxPerMinute: input.apiPerMinute,
        appMaxPerMinute: input.otherPerMinute,
    };
    const record = await fetchRateLimitRecord();

    if (record) {
        await requestSettings(`/api/collections/settings/records/${encodeURIComponent(record.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ value }),
        });
    } else {
        await requestSettings("/api/collections/settings/records", {
            method: "POST",
            body: JSON.stringify({
                key: SETTINGS_KEY,
                value,
                description: SETTINGS_DESCRIPTION,
            }),
        });
    }

    const settings = normalizeSettings(value);
    initRateLimiter(toConfig(settings));
    log.info(
        `${settings.enabled ? "Enabled" : "Disabled"} — API: ${settings.apiPerMinute} req/min, Other: ${settings.otherPerMinute} req/min`,
    );
    return settings;
}

/**
 * Convenience: load config from PocketBase and (re)initialise the limiters.
 */
export async function reloadRateLimiter(): Promise<RateLimitConfig> {
    const cfg = await loadRateLimitConfig();
    initRateLimiter(cfg);
    log.info(
        `${cfg.enabled ? "Enabled" : "Disabled"} — API: ${cfg.pbMaxPerMinute} req/min, Other: ${cfg.appMaxPerMinute} req/min`,
    );
    return cfg;
}
