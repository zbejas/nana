import { Elysia } from "elysia";
import { browserAuthRoutes } from "./auth";
import { browserExtraRoutes } from "./extras";
import { browserFileRoutes } from "./files";
import { browserRealtimeRoutes } from "./realtime";
import { browserRecordRoutes } from "./records";
import { browserSharingRoutes } from "./sharing";

/**
 * The browser-facing /api/v1 surface.
 *
 * These routes replace the old /pb proxy. They are intentionally shaped like
 * PocketBase records/endpoints so the existing SPA data layer can migrate
 * without rewriting every screen, but the public path is Elysia, the
 * collection allowlist and write transforms live here, and PocketBase itself
 * is loopback-only.
 */
export const browserApi = new Elysia({ name: "nana-browser-api" })
    .use(browserAuthRoutes)
    .use(browserRecordRoutes)
    .use(browserFileRoutes)
    .use(browserRealtimeRoutes)
    .use(browserExtraRoutes)
    .use(browserSharingRoutes);
