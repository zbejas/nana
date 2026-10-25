import { serve } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import index from "./index.html";
import { serverConfig } from "./lib/config";

import { handleExport } from "./api/export/index";
import { handleChat } from "./api/chat/index";
import { APP_VERSION, handleAppVersion } from "./api/app-version";
import { createStaticFileHandler } from "./api/static-files";
import { checkRateLimit, reloadRateLimiter } from "./api/rate-limiter";
import { verifyAuth, AuthError } from "./api/auth";
import { apiApp } from "./api/rest";
import { handleMcpRequest } from "./api/mcp";
import { createLogger } from "./lib/logger";

const log = createLogger("Server");

// Determine if we're in production (built files exist)
const isProduction = serverConfig.isProduction && existsSync(resolve(import.meta.dir, "../dist/index.html"));
const distDir = resolve(import.meta.dir, "../dist");
const iconSvg = resolve(import.meta.dir, "assets/nana.svg");
const icon192 = resolve(import.meta.dir, "assets/nana-192.png");
const icon512 = resolve(import.meta.dir, "assets/nana-512.png");
const pdfWorkerScript = resolve(import.meta.dir, "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs");

const manifest = {
  name: "Nana",
  short_name: "Nana",
  start_url: "/timeline",
  scope: "/",
  display: "standalone",
  background_color: "#0c0c0d",
  theme_color: "#0c0c0d",
  icons: [
    {
      src: "/nana-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/nana-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/nana.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
};

const serviceWorkerScript = `
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
`;

if (!existsSync(pdfWorkerScript)) {
  log.warn("PDF worker script is missing; PDF previews will be unavailable", {
    path: pdfWorkerScript,
  });
}

// ── Content Security Policy ──────────────────────────────────────────
const cspPolicy = isProduction
  ? [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ")
  : [
    // Development: allow HMR websockets and inline scripts injected by Bun
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss:",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

/**
 * Append security headers to every response.
 */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", cspPolicy);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * REST/OpenAPI surface: /api/v1, /docs, and /docs/json.
 * Rate limits and security headers stay at the Bun edge.
 */
async function handleRest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === "/api/v1/realtime") {
    // EventSource stays open for the lifetime of the tab. Never apply the
    // normal JSON request timeout to the SSE relay.
    server.timeout(req, 0);
  } else {
    // Workspace writes can fan out into PocketBase calls; give the JSON
    // surface more headroom than the default request timeout.
    server.timeout(req, 60);
  }
  const blocked = await checkRateLimit(req, server);
  if (blocked) return withSecurityHeaders(blocked);
  return withSecurityHeaders(await apiApp.handle(req));
}

const server = serve({
  port: serverConfig.port,
  // Apply security headers to all responses
  async fetch(req) {
    // Bun calls this for requests that don't match any route (shouldn't happen
    // with the "/*" catch-all, but acts as a safety net).
    return withSecurityHeaders(new Response("Not Found", { status: 404 }));
  },
  routes: {
    "/manifest.webmanifest": (): Response =>
      withSecurityHeaders(
        new Response(JSON.stringify(manifest), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        })
      ),

    "/sw.js": (): Response =>
      withSecurityHeaders(
        new Response(serviceWorkerScript, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        })
      ),

    "/pdfjs/pdf.worker.min.mjs": (): Response => {
      if (!existsSync(pdfWorkerScript)) {
        return withSecurityHeaders(new Response("PDF worker not available", { status: 404 }));
      }

      return withSecurityHeaders(
        new Response(Bun.file(pdfWorkerScript), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        })
      );
    },

    "/nana.svg": (): Response => withSecurityHeaders(new Response(Bun.file(iconSvg))),
    // Scalar's page and browser defaults request this path directly.
    "/favicon.ico": (): Response =>
      withSecurityHeaders(
        new Response(Bun.file(iconSvg), {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400",
          },
        })
      ),
    "/nana-192.png": (): Response => withSecurityHeaders(new Response(Bun.file(icon192))),
    "/nana-512.png": (): Response => withSecurityHeaders(new Response(Bun.file(icon512))),

    // REST API and OpenAPI docs (public docs, authenticated /api/v1)
    "/docs": handleRest,
    "/docs/*": handleRest,
    "/api/v1": handleRest,
    "/api/v1/*": handleRest,

    // MCP Streamable HTTP API (POST only, authenticated)
    "/mcp": async (req): Promise<Response> => {
      server.timeout(req, 60);
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleMcpRequest(req));
    },

    // Server-side export API
    "/api/export": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleExport(req));
    },

    // Chat API endpoints
    "/api/chat/send": async (req): Promise<Response> => {
      server.timeout(req, 0);
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleChat(req));
    },
    "/api/chat/conversations": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleChat(req));
    },
    "/api/chat/conversations/*": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleChat(req));
    },

    "/api/app/version": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleAppVersion(req));
    },

    // Admin endpoint: reload rate-limit config at runtime
    "/api/admin/rate-limits/reload": async (req): Promise<Response> => {
      if (req.method !== "POST") {
        return withSecurityHeaders(new Response("Method Not Allowed", { status: 405 }));
      }
      try {
        await verifyAuth(req);
      } catch (err) {
        const status = err instanceof AuthError ? err.status : 401;
        return withSecurityHeaders(new Response("Unauthorized", { status }));
      }
      try {
        const cfg = await reloadRateLimiter();
        return withSecurityHeaders(
          new Response(JSON.stringify({ success: true, config: cfg }), {
            headers: { "Content-Type": "application/json" },
          }),
        );
      } catch (err: any) {
        return withSecurityHeaders(
          new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    },

    // PocketBase is loopback-only. The old public proxy is intentionally gone:
    // every browser read/write, auth, file, realtime, trash, admin, and public
    // share now goes through /api/v1 in Elysia.
    "/pb": (): Response => withSecurityHeaders(new Response("Not Found", { status: 404 })),
    "/pb/*": (): Response => withSecurityHeaders(new Response("Not Found", { status: 404 })),

    // Serve built files in production, or index.html in development
    "/*": isProduction
      ? async (req: Request): Promise<Response> => {
        const blocked = await checkRateLimit(req, server);
        if (blocked) return withSecurityHeaders(blocked);
        return withSecurityHeaders(createStaticFileHandler(distDir)(req));
      }
      : index,
  },

  development: !isProduction && {
    // Enable browser hot reloading in development
    hmr: true,

    // Disable all console echo to suppress benign ResizeObserver errors
    console: false,
  },
});

// Bootstrap rate limiter from PocketBase settings
reloadRateLimiter().catch((err) => {
  log.warn("Rate limiter failed to initialise on startup", err);
});

// ── Graceful shutdown ────────────────────────────────────────────────
function gracefulShutdown(signal: string) {
  log.info(`Received ${signal}, shutting down…`);
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

log.info(`Server running on port ${serverConfig.port} | version ${APP_VERSION}`);
