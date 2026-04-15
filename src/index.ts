import { serve } from "bun";
import { existsSync } from "fs";
import { resolve } from "path";
import index from "./index.html";
import { serverConfig } from "./lib/config";
import { handlePocketBaseProxy } from "./api/pocketbase-proxy";
import { handleExport } from "./api/export/index";
import { handleChat } from "./api/chat/index";
import { handleEmbeddings } from "./api/embeddings/index";
import { closeAll as closeAllZvecCollections } from "./api/embeddings/zvec";
import { createStaticFileHandler } from "./api/static-files";
import { checkRateLimit, reloadRateLimiter } from "./api/rate-limiter";
import { verifyAuth, AuthError } from "./api/auth";
import { createLogger } from "./lib/logger";

const log = createLogger("Server");

// Determine if we're in production (built files exist)
const isProduction = serverConfig.isProduction && existsSync(resolve(import.meta.dir, "../dist/index.html"));
const distDir = resolve(import.meta.dir, "../dist");
const iconSvg = resolve(import.meta.dir, "assets/nana.svg");
const icon192 = resolve(import.meta.dir, "assets/nana-192.png");
const icon512 = resolve(import.meta.dir, "assets/nana-512.png");

const manifest = {
  name: "Nana",
  short_name: "Nana",
  start_url: "/timeline",
  scope: "/",
  display: "standalone",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
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

// ── Content Security Policy ──────────────────────────────────────────
const cspPolicy = isProduction
  ? [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ")
  : [
    // Development: allow HMR websockets and inline scripts injected by Bun
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
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

    "/nana.svg": (): Response => withSecurityHeaders(new Response(Bun.file(iconSvg))),
    "/nana-192.png": (): Response => withSecurityHeaders(new Response(Bun.file(icon192))),
    "/nana-512.png": (): Response => withSecurityHeaders(new Response(Bun.file(icon512))),

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

    // Embeddings API endpoints
    "/api/embeddings/embed": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleEmbeddings(req));
    },
    "/api/embeddings/embed-all": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleEmbeddings(req));
    },
    "/api/embeddings/search": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleEmbeddings(req));
    },
    "/api/embeddings/status": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleEmbeddings(req));
    },
    "/api/embeddings/delete": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handleEmbeddings(req));
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

    // Proxy all PocketBase requests through our server
    "/pb/*": async (req): Promise<Response> => {
      const blocked = await checkRateLimit(req, server);
      if (blocked) return withSecurityHeaders(blocked);
      return withSecurityHeaders(await handlePocketBaseProxy(req, server));
    },

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

// ── Graceful shutdown: flush & close Zvec collections ────────────────
function gracefulShutdown(signal: string) {
  log.info(`Received ${signal}, shutting down…`);
  try {
    closeAllZvecCollections();
  } catch (err) {
    log.error("Error closing Zvec collections during shutdown", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

log.info(`🚀 Server running at ${server.url}`);
