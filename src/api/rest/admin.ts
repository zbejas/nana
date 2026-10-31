import { Elysia, t } from "elysia";
import { createLogger } from "../../lib/logger";
import {
    RateLimitStoreError,
    rateLimitDefaults,
    rateLimitScopes,
    readRateLimitSettings,
    saveRateLimitSettings,
    type RateLimitSettings,
} from "../rate-limiter";
import {
    listCatalogModels,
    loadModelsDevCatalog,
} from "../../lib/ai/models-dev";
import { BrowserAuthError, requireBrowserAdmin } from "./browser/auth";

const log = createLogger("Admin");

/**
 * Bun-native admin routes for instance settings the browser facade cannot own.
 * Rate-limit state lives in the limiter process, so the update and reload must
 * happen in one request instead of a settings write followed by a separate
 * reload call.
 */

function jsonError(status: number, message: string): Response {
    return Response.json(
        { error: message },
        { status, headers: { "Cache-Control": "no-store" } },
    );
}

function jsonPayload(body: unknown): Response {
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function handleRateLimitError(error: unknown): Response {
    if (error instanceof BrowserAuthError) {
        return jsonError(error.status, error.message);
    }
    if (error instanceof RateLimitStoreError) {
        const status = error.status === 400 ? 400 : 502;
        if (status === 502) {
            log.error("Rate-limit settings store failed", {
                status: error.status,
                message: error.message,
            });
        }
        return jsonError(
            status,
            status === 400 ? error.message : "Could not load or save rate-limit settings.",
        );
    }
    throw error;
}

function rateLimitPayload(rateLimits: RateLimitSettings) {
    return {
        rateLimits,
        defaults: rateLimitDefaults,
        scopes: rateLimitScopes,
    };
}

const RateLimitBody = t.Object({
    enabled: t.Boolean({
        description: "Whether the limiter rejects requests over the configured ceilings.",
    }),
    apiPerMinute: t.Integer({
        minimum: 1,
        maximum: 1_000_000,
        description: "Per-IP requests per minute for /api/v1/*.",
        examples: [600],
    }),
    otherPerMinute: t.Integer({
        minimum: 1,
        maximum: 1_000_000,
        description: "Per-IP requests per minute for every route outside /api/v1/*.",
        examples: [1200],
    }),
});

export const adminApi = new Elysia({ name: "nana-admin-api" })
    .get("/api/v1/admin/rate-limits", async ({ request }) => {
        try {
            await requireBrowserAdmin(request);
            const rateLimits = await readRateLimitSettings();
            return jsonPayload(rateLimitPayload(rateLimits));
        } catch (error) {
            return handleRateLimitError(error);
        }
    }, {
        detail: { hide: true },
    })
    .patch("/api/v1/admin/rate-limits", async ({ request, body }) => {
        try {
            await requireBrowserAdmin(request);
            const rateLimits = await saveRateLimitSettings(body);
            return jsonPayload(rateLimitPayload(rateLimits));
        } catch (error) {
            return handleRateLimitError(error);
        }
    }, {
        body: RateLimitBody,
        detail: { hide: true },
    })
    .get("/api/v1/admin/ai/models", async ({ request, query }) => {
        try {
            await requireBrowserAdmin(request);
            const catalog = await loadModelsDevCatalog();
            let models = listCatalogModels(catalog, query.q ?? "", 10_000);
            if (query.provider) {
                models = models.filter((model) => model.providerId === query.provider);
            }
            return jsonPayload({ models: models.slice(0, 500), source: "models.dev" });
        } catch (error) {
            if (error instanceof BrowserAuthError) {
                return jsonError(error.status, error.message);
            }
            log.error("models.dev catalog request failed", {
                message: error instanceof Error ? error.message : "unknown",
            });
            return jsonError(502, "The model catalog is unavailable right now.");
        }
    }, {
        query: t.Object({
            q: t.Optional(t.String({ maxLength: 120 })),
            provider: t.Optional(t.String({ maxLength: 80 })),
        }),
        detail: { hide: true },
    });
