# Architecture

Nana is a self-hosted document workspace with Markdown editing, folders, tags, version history, trash, public sharing, and AI chat with retrieval over your own documents.

The system is one deployable with two processes:

- **Bun** serves the built React SPA and the `/api/*` endpoints on port `3000`.
- **PocketBase** serves collections, auth, hooks, and admin routes on port `8090`.

The browser never reaches PocketBase directly. The Bun server proxies every `/pb/*` request to PocketBase, so the app has one public origin and one CSP surface.

## Topology

```text
Browser (same origin only)
  │
  ▼
Bun :3000 ── src/index.ts
  ├── /pb/* ──────────────▶ PocketBase :8090
  │                          ├── collections + API rules
  │                          └── pb_hooks: routes, guards, mailers, cron
  ├── /api/chat/* ────────▶ AI SDK providers + PB conversations
  ├── /api/embeddings/* ──▶ @zvec vectors + PB documents
  ├── /api/export ────────▶ PB documents/attachments → Markdown/ZIP
  ├── /api/app/version ───▶ GitHub Releases API
  └── /* ─────────────────▶ React SPA (dev: Bun HMR, prod: dist/)
```

### Process responsibilities

| Process | Owns | Entry point |
| --- | --- | --- |
| Bun | SPA serving, API routes, PocketBase proxy, auth verification, rate limiting, CSP, export, AI/embedding orchestration | `src/index.ts` |
| PocketBase | Data, auth records, API rules, schema, hooks, custom routes, mailers, cron | `pocketbase/pb_hooks/index.pb.js` |
| Browser | React UI, Jotai state, PocketBase SDK calls through `/pb`, SSE chat client | `src/frontend.tsx` |

## Request lifecycle

### Normal page load

1. Bun serves `index.html` and the built assets from `dist/` in production, or the HMR development bundle otherwise.
2. `src/frontend.tsx` mounts React inside `AuthProvider` and the Jotai `Provider`.
3. `src/App.tsx` validates the stored PocketBase token with `authRefresh()`.
4. Authenticated routes call `useDocumentData()` once at `AppContent`, which loads root documents, recents, folders, trash, and starts realtime subscriptions.

### PocketBase request

1. Browser calls the PocketBase SDK at `/pb/...`.
2. `src/api/pocketbase-proxy.ts` forwards the request to `POCKETBASE_URL` with the original headers and body.
3. PocketBase enforces collection API rules and runs hooks.
4. The proxy observes successful document and trash mutations to trigger embedding work.

### Chat request

1. Browser posts to `/api/chat/send`.
2. Bun calls `verifyAuth()` against PocketBase `auth-refresh`.
3. Bun loads `settings.ai_config` and `settings.embedding_config` using the server superuser token.
4. When explicit `documentIds` are supplied, embed the query and search `@zvec` scoped to those documents (falling back to raw content). Automatic RAG across all documents is currently disabled.
5. Bun streams the model response back as SSE and appends the exchange to the `conversations` collection.

## Data flows

| Flow | Path |
| --- | --- |
| Document save | Browser → `/pb/api/collections/documents/...` → PB hooks (word count, version snapshot) → proxy observes response → fire-and-forget embedding |
| Document delete | Browser → PB delete → proxy removes embeddings |
| Trash move | Browser → `/pb/api/trash/move-*` → PB copies to `trash_*` and deletes original → proxy removes embeddings |
| Trash restore | Browser → `/pb/api/trash/restore-*` → PB moves record back → proxy re-embeds |
| Export | Browser → `/api/export` → resolve documents/folders → download attachments → Markdown or ZIP response |
| Public share | Public page → `/pb/api/public/*` → PB validates token, expiry, privacy, attachment sharing |
| Version snapshot | Document updated with `published = true` → PB hook copies the old content into `document_versions` → flag reset |
| Version check | Browser About tab → `/api/app/version` → cached GitHub Releases lookup |

## Source map

| Path | Role |
| --- | --- |
| `src/index.ts` | Bun route registration, security headers, PWA assets, graceful shutdown |
| `src/frontend.tsx` | React root, Jotai provider, auth provider, service worker registration |
| `src/App.tsx` | Router, protected routes, layout, mobile navigation, lazy-loaded pages |
| `src/api/` | Server handlers (proxy, chat, embeddings, export, version, auth, rate limiting) |
| `src/components/` | Editor, sidebar, folder view, settings, modals, public views, PWA |
| `src/pages/` | Timeline, folders, chat, settings, auth, onboarding, public pages |
| `src/state/atoms.ts` | All Jotai UI and data atoms |
| `src/state/hooks/` | Data loading, realtime subscriptions, lazy folders, sidebar/editor hooks |
| `src/lib/` | Config, auth, logger, PocketBase client, settings, document/folder CRUD |
| `pocketbase/pb_hooks/` | JSVM hooks, custom routes, guards, mailers, templates, cron |
| `pocketbase/pb_migrations/` | Schema and data migrations |
| `tests/` | Integration tests against real services |
| `docker/` | Dockerfile, entrypoints, dev/test compose |
| `docs/` | This knowledge base |

## Runtime modes

| Mode | How it runs | Notes |
| --- | --- | --- |
| Development | `docker compose -f docker/compose.dev.yml up --build` or `bun run dev` + local PocketBase | Bun HMR, permissive CSP with `ws:` |
| Production | `NODE_ENV=production bun src/index.ts` after `bun run build`, or the production image | Requires `dist/index.html`; strict CSP |
| Test | `docker compose -f docker/compose.test.yml up --build ...` | Ephemeral PocketBase + Bun, runs the integration suite |

Production detection is deliberate: `src/index.ts` treats the app as production only when `NODE_ENV=production` **and** `dist/index.html` exists. Without the built files, it serves the development SPA.

## Design constraints

- **Single origin.** Browser code must never hardcode `:8090` or a PocketBase URL outside `/pb`.
- **Two processes, one container.** The Docker entrypoint runs PocketBase and Bun in parallel and handles shutdown for both.
- **Server-side admin reads.** Settings and AI configuration are admin-only; Bun reads them with the auto-provisioned superuser token.
- **Fire-and-forget side effects.** Embedding must never block document saves or trash responses.
- **SSE needs no timeout.** Chat and PocketBase realtime requests explicitly disable Bun's request timeout.
- **Native vector store.** Zvec holds RocksDB locks; HMR and shutdown must close collections.

## Cross-cutting utilities

| Utility | Use |
| --- | --- |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only place to read environment variables |
| `src/lib/logger.ts` | `createLogger("Module")` for browser and terminal logging |
| `src/api/auth.ts` | `verifyAuth()` for Bun API routes |
| `src/api/rate-limiter.ts` | Per-IP limits loaded from `settings.rate_limits` |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, site/sender helpers |

See [`api.md`](api.md) for route-level detail, [`pocketbase.md`](pocketbase.md) for backend conventions, and [`deployment.md`](deployment.md) for runtime packaging.
