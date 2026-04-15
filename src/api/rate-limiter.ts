import type { Server } from "bun";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { serverConfig } from "../lib/config";
import { getSuperuserToken } from "./chat/superuser";
import { createLogger } from "../lib/logger";

const log = createLogger("RateLimit");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

// ── Types ────────────────────────────────────────────────────────────

export interface RateLimitConfig {
    enabled: boolean;
    /** Max requests per minute for /pb/* routes */
    pbMaxPerMinute: number;
    /** Max requests per minute for all other routes (app / static) */
    appMaxPerMinute: number;
}

export const defaultRateLimitConfig: RateLimitConfig = {
    enabled: false,
    pbMaxPerMinute: 600,
    appMaxPerMinute: 1200,
};

// ── Internal state ───────────────────────────────────────────────────

let config: RateLimitConfig = { ...defaultRateLimitConfig };
let pbLimiter: RateLimiterMemory | null = null;
let appLimiter: RateLimiterMemory | null = null;

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
    const isPb = url.pathname.startsWith("/pb");
    const limiter = isPb ? pbLimiter : appLimiter;
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
        const token = await getSuperuserToken();

        const res = await fetch(
            `${POCKETBASE_URL}/api/collections/settings/records?filter=(key='rate_limits')&perPage=1`,
            {
                headers: { Authorization: `Bearer ${token}` },
            },
        );

        if (!res.ok) {
            log.warn(`Failed to load config from PocketBase (${res.status}), using defaults`);
            return { ...defaultRateLimitConfig };
        }

        const data = (await res.json()) as { items?: Array<{ value?: Partial<RateLimitConfig> }> };
        const record = data.items?.[0];

        if (!record?.value) {
            log.info("No rate_limits setting found, using defaults");
            return { ...defaultRateLimitConfig };
        }

        return {
            enabled: record.value.enabled === true,
            pbMaxPerMinute:
                typeof record.value.pbMaxPerMinute === "number" && record.value.pbMaxPerMinute > 0
                    ? record.value.pbMaxPerMinute
                    : defaultRateLimitConfig.pbMaxPerMinute,
            appMaxPerMinute:
                typeof record.value.appMaxPerMinute === "number" && record.value.appMaxPerMinute > 0
                    ? record.value.appMaxPerMinute
                    : defaultRateLimitConfig.appMaxPerMinute,
        };
    } catch (err) {
        log.warn("Could not load config from PocketBase, using defaults", err);
        return { ...defaultRateLimitConfig };
    }
}

/**
 * Convenience: load config from PocketBase and (re)initialise the limiters.
 */
export async function reloadRateLimiter(): Promise<RateLimitConfig> {
    const cfg = await loadRateLimitConfig();
    initRateLimiter(cfg);
    log.info(
        `${cfg.enabled ? "Enabled" : "Disabled"} — PB: ${cfg.pbMaxPerMinute} req/min, App: ${cfg.appMaxPerMinute} req/min`,
    );
    return cfg;
}
