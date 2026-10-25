# Architecture — topology, requests, and data flows

## Overview

Nana is a self-hosted document workspace: Markdown notes in folders, multiple task boards, version history, trash, public sharing, a read-only AI assistant, a JSON API, and an MCP server for external AI clients. Notes are `documents`; tasks are separate `tasks` records grouped by author-scoped `boards`. Boards can be filed in the same folder tree as notes and can be marked private.

The system is one deployable with two processes: **Bun** serves the SPA, the application API, the Elysia REST API at `/api/v1`, the public OpenAPI docs at `/docs`, and the MCP endpoint at `/mcp` on port `3000`; **PocketBase** serves data, auth, hooks, and admin APIs on port `8090`. The browser reaches PocketBase only through the Bun origin at `/pb/*`.

## Key files

| Path | Role |
| --- | --- |
| `src/index.ts` | Bun route registration, security headers, PWA assets, proxy mount, graceful shutdown. |
| `src/frontend.tsx` | React root, Jotai provider, `AuthProvider`, service-worker registration. |
| `src/App.tsx` | Router, protected routes, layout, mobile navigation, `useDocumentData()` call site, `AddToBoardHost`. |
| `src/api/` | Server handlers: PocketBase proxy, chat, export, version, auth, rate limiting, static files. |
| `src/api/rest/` | Elysia `/api/v1` routes, PocketBase token auth, TypeBox request/response schemas, public OpenAPI and Swagger UI. |
| `src/api/mcp/` | Stateless Streamable HTTP MCP server, tool registration, and per-request transport handling. |
| `src/api/workspace/` | Shared folder, note, board, and task services used by REST and MCP; `Surface` selection and the AI visibility lock. |
| `src/api/pocketbase/` | Caller-token PocketBase REST client shared by chat tools, REST services, and MCP. Never accepts the superuser token. |
| `src/api/chat/` | Chat orchestration, providers, conversation persistence, read-only workspace tools. |
| `src/api/chat/tools/` | `list_notes`, `read_note`, `list_boards`, `read_board` with bounds, author checks, and the private lock. |
| `src/lib/boards/` | Board types, CRUD, archive/restore, permanent delete, folder/privacy fields, summaries, realtime subscription. |
| `src/lib/tasks/` | Task types, CRUD, position persistence, note import, realtime subscription. |
| `src/pages/` | Timeline, board index/detail/archive, chat, settings, auth, onboarding, public pages. |
| `src/components/board/` | Board state, summaries, task rows/dialog, board dialog, add-to-board host/picker, note import. |
| `src/components/folder-view/` | Folder contents grid/list, folder state, board rows beside notes, drag targets, board create/edit entry points. |
| `src/components/file-folder-handling/` | Note, folder, and board drag-and-drop plus the folder/document/board context menus. |
| `src/lib/documents/` | Document and attachment CRUD, export helpers, public sharing. |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only environment-variable reader. |
| `src/index.css` | Graphite tokens, self-hosted typefaces, global styles, motion, Markdown overrides. |
| `src/assets/fonts/` | Self-hosted Geist and Geist Mono files plus the OFL licence. |
| `src/state/` | Jotai atoms and data, realtime, and lazy-loading hooks. |
| `pocketbase/pb_hooks/` | JSVM hooks, custom routes, guards (including board folder ownership), mailers, cron, bootstrap. |
| `pocketbase/pb_migrations/` | Append-only schema and data migrations. |
| `docker/` | Dockerfile stages, production/dev entrypoint, test entrypoint and compose files. |
| `tests/` | Unit tests plus integration tests against a real PocketBase and Bun server. |
| `docs/` | This knowledge base. |

## How it works

### Topology

```text
Browser / API client / MCP client (same origin; no CORS)
  │
  ▼
Bun :3000 ── src/index.ts
  ├── /pb/* ──────────────▶ PocketBase :8090
  │                          ├── collections + API rules
  │                          └── pb_hooks: routes, guards, mailers, cron
  ├── /api/v1/* ──────────▶ Elysia REST ──▶ workspace services ──▶ PB REST (user token)
  ├── /docs, /docs/json ──▶ OpenAPI spec + self-hosted Swagger UI (public)
  ├── /mcp ───────────────▶ MCP Streamable HTTP ──▶ workspace services ──▶ PB REST (user token)
  ├── /api/chat/* ────────▶ AI SDK providers + read tools ──▶ PB REST (user token)
  ├── /api/export ────────▶ PB documents/attachments → Markdown/ZIP
  ├── /api/app/version ───▶ GitHub Releases API
  └── /* ─────────────────▶ React SPA (dev: Bun HMR, prod: dist/)
```

There is no embedding service, vector store, or background indexer in the topology. Chat reads notes and boards on demand through its tool set; MCP reads and writes folders, notes, boards, and tasks through the shared workspace services.

### Process responsibilities

| Process | Owns | Entry point |
| --- | --- | --- |
| Bun | SPA serving, application API routes, Elysia `/api/v1`, public OpenAPI docs, MCP endpoint, PocketBase proxy, auth verification, rate limiting, CSP, export, chat/provider orchestration, workspace services, read-only chat tools | `src/index.ts` |
| PocketBase | Data, auth records, API rules, schema, hooks, custom routes, mailers, cron | `pocketbase/pb_hooks/index.pb.js` |
| Browser | React UI, Jotai state, PocketBase SDK calls through `/pb`, SSE chat client | `src/frontend.tsx` |
| API / MCP clients | JSON requests to `/api/v1` or `/mcp` with a PocketBase user token; no browser session required | `src/api/rest/`, `src/api/mcp/` |

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

### REST request

1. A client calls `/api/v1/...` with a PocketBase user token, sent raw or as `Authorization: Bearer <token>`.
2. `authenticateApiRequest()` validates it against PocketBase `auth-refresh` and keeps the refreshed token for downstream calls.
3. Elysia validates paths, query strings, and JSON bodies with TypeBox. Validation failures return `422`, malformed JSON returns `400`.
4. The handler calls a workspace service with `surface: "user"` and the caller's `ToolContext`.
5. The service calls PocketBase REST with the caller's token, adds author filters and author checks, and maps upstream `403`/`404` to one generic `not_found`.
6. The response is JSON. Errors are `{ "error": "message" }` with the status from the `ApiError`.

`GET /docs` serves Swagger UI and `GET /docs/json` serves the OpenAPI document. Both are public and use self-hosted assets; `/api/v1` itself is authenticated. See [`api.md`](api.md) for the endpoint table.

### MCP request

1. The client sends `POST /mcp` with the same raw or Bearer user token. Every other method returns `405`.
2. Auth runs before any MCP work; a missing or invalid token returns a plain JSON `401`.
3. A malformed JSON body returns a JSON-RPC `-32700` parse error. Transport failures return `-32603`.
4. Bun creates a fresh `McpServer` and a stateless `WebStandardStreamableHTTPServerTransport` for the request. Responses are JSON, not SSE.
5. Tool calls run through `src/api/workspace/` with `surface: "ai"`; the read tools reuse the chat executors.
6. A failed tool returns an MCP `isError` result whose text is `{ "error": { "code", "message" } }`. The HTTP request still succeeds.

MCP is an AI surface: private records and private-folder subtrees are hidden. It is a separate write-capable surface from chat, which stays read-only. See [`ai.md`](ai.md).

### Chat request

1. Browser posts to `/api/chat/send` with the user token.
2. `verifyAuth()` validates the token; `fetchAIConfig()` reads `settings.ai_config` with the server superuser token.
3. Bun creates or appends to a `conversations` record.
4. `createChatTools()` builds `list_notes`, `read_note`, `list_boards`, and `read_board`, all using the caller's `Authorization` header and the AI visibility lock.
5. `streamText()` runs with `stopWhen(stepCountIs(8))`; tools read PocketBase on demand, bounded and author-scoped.
6. `onFinish` persists the assistant text, reasoning, terminal tool names/statuses, and model name; title generation runs in the background.
7. The response is an SSE UI-message stream with `X-Conversation-Id`, `X-Is-New-Conversation`, and `X-Model-Name`.

### Board request

1. `/board` loads `boards` and `tasks` through the SDK at `/pb`, then groups tasks with `listBoardSummaries()`.
2. `/board/:boardId` loads one board and `listTasks(boardId)`, sorted by `board_order` and `created`.
3. The folder view also calls `listBoardSummaries()` and filters active boards to the current folder, so a board sits beside notes and subfolders.
4. Dragging a card writes only the changed rows through `persistTaskPositions()`: `status` and `board_order`, never `board`.
5. Dragging a board between folders calls `updateBoard(id, { folder })`. PocketBase runs `guards/board_guards.js`, which verifies the incoming folder belongs to the caller.
6. Realtime task events refresh the open board; board and task events refresh the index and folder view after a short debounce.
7. Archiving is a board `PATCH { archived: true }`. Permanent delete is allowed only for archived boards and cascades their tasks.

### Data flows

| Flow | Path |
| --- | --- |
| Document save | Browser → `/pb/api/collections/documents/...` → PB hooks (word count, version snapshot) → response |
| Document delete | Browser → PB delete → document and its versions removed; no external index to update |
| Trash move | Browser → `/pb/api/trash/move-*` → PB copies to `trash_*` and deletes the original |
| Trash restore | Browser → `/pb/api/trash/restore-*` → PB moves the record back |
| Folder trash | Browser → `/pb/api/trash/move-folder` → PB copies the subtree, moves documents to trash, rehomes boards to the root → `{ trashFolderId, movedDocumentIds, movedBoardIds }` |
| Board folder move | Browser → `PATCH boards/:id { folder }` → `board_guards.js` ownership check → realtime refresh |
| Task move | Browser → `/pb/api/collections/tasks/records/:id` (`status`, `board_order`) → realtime refresh |
| Board index | Browser → `boards` + `tasks` (`fields=board,status`) → per-board open/done/total counts |
| Folder view boards | Browser → `listBoardSummaries()` → filter active boards by `folder = currentFolderId` |
| Board archive | Browser → `PATCH boards/:id { archived: true }` → active index excludes it |
| Board delete | Browser → `DELETE boards/:id` only while archived → PB cascades the board's tasks |
| Note to task | Browser → `createTaskFromDocument()` → task with `board`, optional `document`, title, excerpt, up to six tags |
| REST read/write | API client → `/api/v1` → Elysia handler → workspace service (`surface: "user"`) → PB REST with user token → JSON |
| MCP tool call | MCP client → `POST /mcp` → per-request MCP server → workspace service (`surface: "ai"`) → PB REST with user token → tool result |
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

- **Single origin.** Browser code never hardcodes `:8090` or a PocketBase URL outside `/pb`. `/api/v1` and `/mcp` are same-origin surfaces; there is no CORS layer.
- **Two processes, one container.** The Docker entrypoint runs PocketBase and Bun in parallel and shuts both down.
- **Server-side admin reads.** Settings and AI configuration are admin-only; Bun reads them with the auto-provisioned superuser token.
- **Chat tools are read-only and user-scoped.** `src/api/chat/tools/` must never use the superuser token, and every read is author-scoped and private-locked.
- **MCP is a separate write surface.** It reuses `src/api/workspace/` with the caller's token, author scoping, and `surface: "ai"`. It is not chat and does not extend chat's tool set.
- **REST is the owner surface.** `/api/v1` uses `surface: "user"`, so the owner sees their private records; the AI lock is deliberately not applied there.
- **One AI visibility rule.** `src/api/workspace/privacy.ts` defines hidden folders, list conditions, and record checks. Chat and MCP both consume it.
- **No background indexing.** Document saves and trash moves have no fire-and-forget search side effects.
- **SSE needs no timeout.** Chat and PocketBase realtime requests explicitly disable Bun's request timeout.
- **Boards archive before deletion.** PocketBase rejects deleting an active board; task creation and updates are blocked on archived boards.
- **Boards are not trashed with folders.** `boards.folder` does not cascade; folder trash rehomes affected boards to the root.

### Cross-cutting utilities

| Utility | Use |
| --- | --- |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only place to read environment variables. |
| `src/lib/logger.ts` | `createLogger("Module")` for browser and terminal logging. |
| `src/api/auth.ts` | `verifyAuth()` for protected Bun application routes. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()` for `/api/v1` and `/mcp`; accepts raw or Bearer user tokens and refreshes them. |
| `src/api/pocketbase/client.ts` | `pbRequest()` / `pbGet()` with the caller's token; maps upstream statuses to model-safe failures. |
| `src/api/workspace/privacy.ts` | `loadAiVisibility()`, `aiVisibilityConditions()`, `noteIsLocked()`, `boardIsLocked()`, `folderIsLocked()`. |
| `src/api/rate-limiter.ts` | Per-IP limits loaded from `settings.rate_limits`. |
| `src/api/chat/tools/text.ts` | Pure bounds and escaping helpers shared by the read tools and workspace services. |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, site/sender helpers. |

## Gotchas & invariants

- **Production needs both `NODE_ENV=production` and `dist/index.html`.** Missing `dist` silently serves the dev SPA.
- **`server.timeout(req, 0)` is required** on `/api/chat/send` and `/pb/api/realtime`; otherwise long streams are cut off.
- **The proxy is transparent.** It forwards auth headers and never injects a superuser token. Adding side effects or client-controlled upstream URLs breaks the trust boundary.
- **The superuser token belongs to configuration reads only.** `fetchAIConfig()` and the rate limiter use it; chat tools, REST, and MCP must use the caller's token.
- **Chat is read-only; MCP is the write surface.** Do not add write tools to `src/api/chat/tools/`. MCP writes go through `src/api/workspace/` with a user token, author checks, and `surface: "ai"`.
- **Private means hidden from AI, not from the owner.** `/api/v1` is the owner surface and intentionally returns private notes, boards, and folder contents. Only chat and MCP apply `loadAiVisibility()`.
- **MCP tool failures are not HTTP failures.** `POST /mcp` returns `200` with an `isError` text result; only auth, transport, and JSON-RPC errors use HTTP statuses.
- **`/docs` is public by design.** The API itself is authenticated. The Swagger UI bundle and CSS are served under `/docs/` from `node_modules`, not a CDN.
- **A task requires a board.** The `board` relation is required after migration `0000018_created_boards.js`; UI code cannot create a task without one.
- **Archived boards freeze task writes.** `createRule`/`updateRule` require `board.archived = false`. Deletion of a task on an archived board remains allowed.
- **Deleting an archived board cascades its tasks.** The `tasks.board` relation has `cascadeDelete: true`; notes linked through `tasks.document` stay in the library.
- **Boards in folders need a request guard.** PocketBase relation rules see the stored board, so `guards/board_guards.js` checks the incoming `folder` on create/update. Removing it allows filing a board into another user's folder.
- **Folder trash rehomes boards.** `boards.folder` uses `cascadeDelete: false`; `move-folder` and permanent folder delete clear the folder pointer instead of deleting boards. `movedBoardIds` reports the rehomed rows from a trash move.
- **`0000020` adds an optional folder relation without a backfill.** Existing boards stay at the workspace root until someone moves them.
- **Board summaries count tasks from one query.** `listBoardSummaries()` includes boards with no tasks; don't replace it with per-board requests.
- **`useDocumentData()` runs once.** It is called at `AppContent` and nowhere else; board pages own their own task state.
- **Rate limits apply before the workspace surfaces.** `/api/v1`, `/docs`, and `/mcp` pass through `checkRateLimit()` at the Bun edge. REST and MCP requests get a 60-second Bun request ceiling; workspace PocketBase calls default to 30 seconds, while chat tool calls keep their 8-second signal.
- **Migrations run on container boot.** The entrypoint runs `PB_MIGRATING=1 pocketbase migrate up` before starting either process; a fresh test database therefore includes `0000020`.

## Related docs

- [`api.md`](api.md) — route-level contracts for Bun application routes, Elysia `/api/v1`, MCP, and PocketBase.
- [`frontend.md`](frontend.md) — routes, Jotai state, board/folder UI, chat UI.
- [`ai.md`](ai.md) — chat, MCP, read tools, privacy lock, and persistence.
- [`pocketbase.md`](pocketbase.md) — schema, rules, migrations, archive lifecycle, board folders.
- [`security.md`](security.md) — trust boundaries, MCP authorization, CSP, secrets.
- [`deployment.md`](deployment.md) — build, Docker, upgrades, persistence.
