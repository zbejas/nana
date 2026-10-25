# Architecture — topology, requests, and data flows

## Overview

Nana is a self-hosted document workspace: Markdown notes in folders, multiple task boards, version history, trash, public sharing, and an AI assistant that reads notes and boards. Notes are `documents`; tasks are separate `tasks` records grouped by author-scoped `boards`.

The system is one deployable with two processes: **Bun** serves the SPA and `/api/*` on port `3000`, and **PocketBase** serves data, auth, hooks, and admin APIs on port `8090`. The browser reaches PocketBase only through the Bun origin at `/pb/*`.

## Key files

| Path | Role |
| --- | --- |
| `src/index.ts` | Bun route registration, security headers, PWA assets, proxy mount, graceful shutdown. |
| `src/frontend.tsx` | React root, Jotai provider, `AuthProvider`, service-worker registration. |
| `src/App.tsx` | Router, protected routes, layout, mobile navigation, `useDocumentData()` call site, `AddToBoardHost`. |
| `src/api/` | Server handlers: PocketBase proxy, chat, export, version, auth, rate limiting, static files. |
| `src/api/chat/` | Chat orchestration, providers, conversation persistence, read-only workspace tools. |
| `src/api/chat/tools/` | `list_notes`, `read_note`, `list_boards`, `read_board` and their PocketBase access helper. |
| `src/lib/boards/` | Board types, CRUD, archive/restore, permanent delete, summaries, realtime subscription. |
| `src/lib/tasks/` | Task types, CRUD, position persistence, note import, realtime subscription. |
| `src/pages/` | Timeline, board index/detail/archive, chat, settings, auth, onboarding, public pages. |
| `src/components/board/` | Board state, summaries, task rows/dialog, board dialog, add-to-board host/picker, note import. |
| `src/lib/documents/` | Document and attachment CRUD, export helpers, public sharing. |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only environment-variable reader. |
| `src/index.css` | Graphite tokens, self-hosted typefaces, global styles, motion, Markdown overrides. |
| `src/assets/fonts/` | Self-hosted Geist and Geist Mono files plus the OFL licence. |
| `src/state/` | Jotai atoms and data, realtime, and lazy-loading hooks. |
| `pocketbase/pb_hooks/` | JSVM hooks, custom routes, guards, mailers, cron, bootstrap. |
| `pocketbase/pb_migrations/` | Append-only schema and data migrations. |
| `docker/` | Dockerfile stages, production/dev entrypoint, test entrypoint and compose files. |
| `tests/` | Unit tests plus integration tests against a real PocketBase and Bun server. |
| `docs/` | This knowledge base. |

## How it works

### Topology

```text
Browser (same origin only)
  │
  ▼
Bun :3000 ── src/index.ts
  ├── /pb/* ──────────────▶ PocketBase :8090
  │                          ├── collections + API rules
  │                          └── pb_hooks: routes, guards, mailers, cron
  ├── /api/chat/* ────────▶ AI SDK providers + read tools ──▶ PB REST (user token)
  ├── /api/export ────────▶ PB documents/attachments → Markdown/ZIP
  ├── /api/app/version ───▶ GitHub Releases API
  └── /* ─────────────────▶ React SPA (dev: Bun HMR, prod: dist/)
```

There is no embedding service, vector store, or background indexer in the topology. Chat reads notes and boards on demand through the tool set.

### Process responsibilities

| Process | Owns | Entry point |
| --- | --- | --- |
| Bun | SPA serving, API routes, PocketBase proxy, auth verification, rate limiting, CSP, export, chat/provider orchestration, read-only tool execution | `src/index.ts` |
| PocketBase | Data, auth records, API rules, schema, hooks, custom routes, mailers, cron | `pocketbase/pb_hooks/index.pb.js` |
| Browser | React UI, Jotai state, PocketBase SDK calls through `/pb`, SSE chat client | `src/frontend.tsx` |

### Page load

1. Bun serves `index.html` and built assets from `dist/` in production, or the HMR bundle in development.
2. `src/frontend.tsx` mounts React inside `AuthProvider` and the Jotai `Provider`.
3. `src/App.tsx` validates the stored PocketBase token with `authRefresh()`.
4. Authenticated routes call `useDocumentData()` once in `AppContent`, which loads root documents, recents, folders, trash, and starts realtime subscriptions.
5. `AddToBoardHost` mounts once at the app root and waits for a note request atom.

### PocketBase request

1. Browser calls the PocketBase SDK at `/pb/...`.
2. `src/api/pocketbase-proxy.ts` forwards method, headers, query, and body to `POCKETBASE_URL`.
3. PocketBase enforces collection rules and runs hooks.
4. The proxy returns the response unchanged. It has no embedding or indexing side effects; realtime connections get `server.timeout(req, 0)`.

### Chat request

1. Browser posts to `/api/chat/send` with the user token.
2. `verifyAuth()` validates the token; `fetchAIConfig()` reads `settings.ai_config` with the server superuser token.
3. Bun creates or appends to a `conversations` record.
4. `createChatTools()` builds `list_notes`, `read_note`, `list_boards`, and `read_board`, all using the caller's `Authorization` header.
5. `streamText()` runs with `stopWhen(stepCountIs(8))`; tools read PocketBase on demand, bounded and author-scoped.
6. `onFinish` persists the assistant text, reasoning, terminal tool names/statuses, and model name; title generation runs in the background.
7. The response is an SSE UI-message stream with `X-Conversation-Id`, `X-Is-New-Conversation`, and `X-Model-Name`.

### Board request

1. `/board` loads `boards` and `tasks` through the SDK at `/pb`, then groups tasks with `listBoardSummaries()`.
2. `/board/:boardId` loads one board and `listTasks(boardId)`, sorted by `board_order` and `created`.
3. Dragging a card writes only the changed rows through `persistTaskPositions()`: `status` and `board_order`, never `board`.
4. Realtime task events refresh the open board; board and task events refresh the index after a short debounce.
5. Archiving is a board `PATCH { archived: true }`. Permanent delete is allowed only for archived boards and cascades their tasks.

### Data flows

| Flow | Path |
| --- | --- |
| Document save | Browser → `/pb/api/collections/documents/...` → PB hooks (word count, version snapshot) → response |
| Document delete | Browser → PB delete → document and its versions removed; no external index to update |
| Trash move | Browser → `/pb/api/trash/move-*` → PB copies to `trash_*` and deletes the original |
| Trash restore | Browser → `/pb/api/trash/restore-*` → PB moves the record back |
| Task move | Browser → `/pb/api/collections/tasks/records/:id` (`status`, `board_order`) → realtime refresh |
| Board index | Browser → `boards` + `tasks` (`fields=board,status`) → per-board open/done/total counts |
| Board archive | Browser → `PATCH boards/:id { archived: true }` → active index excludes it |
| Board delete | Browser → `DELETE boards/:id` only while archived → PB cascades the board's tasks |
| Note to task | Browser → `createTaskFromDocument()` → task with `board`, optional `document`, title, excerpt, up to six tags |
| Chat | Browser → `/api/chat/send` → `streamText` + read tools → PB REST with user token → SSE |
| Export | Browser → `/api/export` → resolve documents/folders → download attachments → Markdown or ZIP |
| Public share | Public page → `/pb/api/public/*` → PB validates token, expiry, privacy, attachment sharing |
| Version check | About tab → `/api/app/version` → cached GitHub Releases lookup |

### Runtime modes

| Mode | How it runs | Notes |
| --- | --- | --- |
| Development | `docker compose -f docker/compose.dev.yml up --build`, or `bun run dev` with a local PocketBase | Bun HMR; CSP allows `ws:`/`wss:` for development. |
| Production | `NODE_ENV=production bun src/index.ts` after `bun run build`, or the production image | Requires `dist/index.html`; strict CSP. |
| Test | `bun run test:docker` | Ephemeral PocketBase and Bun; runs the unit phase and the integration phases. |

Production detection is deliberate: Bun treats the app as production only when `NODE_ENV=production` **and** `dist/index.html` exists. Without the build, it serves the development SPA.

### Design constraints

- **Single origin.** Browser code never hardcodes `:8090` or a PocketBase URL outside `/pb`.
- **Two processes, one container.** The Docker entrypoint runs PocketBase and Bun in parallel and shuts both down.
- **Server-side admin reads.** Settings and AI configuration are admin-only; Bun reads them with the auto-provisioned superuser token.
- **AI tools are read-only and user-scoped.** `src/api/chat/tools/` must never use the superuser token, and every read is author-scoped.
- **No background indexing.** Document saves and trash moves have no fire-and-forget search side effects.
- **SSE needs no timeout.** Chat and PocketBase realtime requests explicitly disable Bun's request timeout.
- **Boards archive before deletion.** PocketBase rejects deleting an active board; task creation and updates are blocked on archived boards.

### Cross-cutting utilities

| Utility | Use |
| --- | --- |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only place to read environment variables. |
| `src/lib/logger.ts` | `createLogger("Module")` for browser and terminal logging. |
| `src/api/auth.ts` | `verifyAuth()` for protected Bun API routes. |
| `src/api/rate-limiter.ts` | Per-IP limits loaded from `settings.rate_limits`. |
| `src/api/chat/tools/text.ts` | Pure bounds and escaping helpers shared by the read tools. |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, site/sender helpers. |

## Gotchas & invariants

- **Production needs both `NODE_ENV=production` and `dist/index.html`.** Missing `dist` silently serves the dev SPA.
- **`server.timeout(req, 0)` is required** on `/api/chat/send` and `/pb/api/realtime`; otherwise long streams are cut off.
- **The proxy is transparent.** It forwards auth headers and never injects a superuser token. Adding side effects or client-controlled upstream URLs breaks the trust boundary.
- **The superuser token belongs to configuration reads only.** `fetchAIConfig()` and the rate limiter use it; the chat tools must use the caller's token.
- **A task requires a board.** The `board` relation is required after migration `0000018_created_boards.js`; UI code cannot create a task without one.
- **Archived boards freeze task writes.** `createRule`/`updateRule` require `board.archived = false`. Deletion of a task on an archived board remains allowed.
- **Deleting an archived board cascades its tasks.** The `tasks.board` relation has `cascadeDelete: true`; notes linked through `tasks.document` stay in the library.
- **Board summaries count tasks from one query.** `listBoardSummaries()` includes boards with no tasks; don't replace it with per-board requests.
- **`useDocumentData()` runs once.** It is called at `AppContent` and nowhere else; board pages own their own task state.
- **Migrations run on container boot.** The entrypoint runs `PB_MIGRATING=1 pocketbase migrate up` before starting either process.

## Related docs

- [`api.md`](api.md) — route-level contracts for Bun and PocketBase.
- [`frontend.md`](frontend.md) — routes, Jotai state, board UI, chat UI.
- [`ai.md`](ai.md) — chat providers, read tools, and persistence.
- [`pocketbase.md`](pocketbase.md) — schema, rules, migrations, archive lifecycle.
- [`security.md`](security.md) — trust boundaries, tool isolation, CSP, secrets.
- [`deployment.md`](deployment.md) — build, Docker, upgrades, persistence.
