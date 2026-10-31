# Architecture — topology, requests, and data flows

## Overview

Nana is a self-hosted document workspace: Markdown notes in folders, multiple task boards, version history, trash, user-to-user and public sharing, a read/edit AI assistant, a JSON API, and an MCP server for external AI clients. Notes are `documents`; tasks are separate `tasks` records grouped by author-scoped `boards`. Boards and notes live in the same folder tree, can be marked private, and can be shared with other accounts or through a public link.

The system is one deployable with two processes: **Bun** serves the SPA, the application API, the Elysia REST API at `/api/v1`, the public OpenAPI docs at `/docs`, and the MCP endpoint at `/mcp` on port `3000`; **PocketBase** serves data, auth, hooks, and admin APIs on `127.0.0.1:8090`. PocketBase is loopback-only; the browser never reaches it directly.

## Key files

| Path | Role |
| --- | --- |
| `src/index.ts` | Bun route registration, security headers, PWA assets, `/api/v1` mount, `/pb` 404 guard, graceful shutdown. |
| `src/frontend.tsx` | React root, Jotai provider, `AuthProvider`, service-worker registration. |
| `src/App.tsx` | Router, protected routes, layout, mobile navigation, `useDocumentData()` call site, `AddToBoardHost`. |
| `src/api/` | Server handlers: chat, export, app version, versioning, auth, rate limiting, static files. |
| `src/api/rest/` | Elysia typed workspace API and browser facade, PocketBase token/API key auth, TypeBox schemas, public OpenAPI and Scalar reference. |
| `src/api/api-keys/` | API key token format, hashing, superuser lookup, impersonation, and owner key management. |
| `src/api/rest/browser/` | Browser-only facade: auth, allowlisted records, files, SSE relay, trash, admin, public shares, version history. Session JWT only. |
| `src/api/versioning/` | Server-side git version store, per-note lock, document reader/patcher, and the version service used by the browser routes. |
| `src/api/mcp/` | Stateless Streamable HTTP MCP server, tool registration, and per-request transport handling. |
| `src/api/workspace/` | Shared folder, note, board, and task services used by REST and MCP; `Surface` selection and the AI visibility lock. |
| `src/api/pocketbase/` | Caller-token PocketBase REST client shared by chat tools, REST services, and MCP. Never accepts the superuser token. |
| `src/api/chat/` | Chat orchestration, providers, context resolution, SSE streaming, conversation persistence, edit cards, and ask/edit workspace tools. |
| `src/api/chat/tools/` | Read tools plus edit-mode note/board/task write tools with bounds, author checks, revision checks, and the private lock. |
| `src/components/chat/` | Chat dock, page thread, composer, context-usage ring, sources, tool strip, and edit cards. |
| `src/lib/chat/` | Chat store, route-context derivation, SSE client, history grouping, and presence. |
| `src/lib/markdown/sections.ts` | Anchor-validated, section-scoped edits that leave untouched sections not re-sanitized. |
| `src/lib/pocketbase.ts` | Browser client over `/api/v1`; PB-shaped `collection`, `authStore`, `files`, `filter`, and realtime helpers. |
| `src/lib/boards/` | Board types, CRUD, trash/restore, permanent delete, folder/privacy/public-share fields, summaries, realtime subscription. |
| `src/lib/tasks/` | Task types, CRUD, position persistence, note import, realtime subscription. |
| `src/pages/` | Timeline, board detail/trash, chat, settings, auth, onboarding, public pages. |
| `src/components/board/` | Board state, dynamic workflow columns, task cards, task detail panel, inline settings, add-to-board host/picker, note import. |
| `src/components/folder-view/` | Folder contents grid/list, folder state, board rows beside notes, drag targets, board create/edit entry points. |
| `src/components/file-folder-handling/` | Note, folder, and board drag-and-drop plus the folder/document/board context menus. |
| `src/lib/documents/` | Document and attachment CRUD, revisions, version history/restore calls, export helpers, public sharing. |
| `src/components/editor/milkdown/` | Milkdown WYSIWYG, CodeMirror source/split, toolbar, slash menu, inline editor, AI section highlights. |
| `src/lib/sharing/` | Session-sharing client for links, access, shared folders, and comments over `/api/v1/sharing`. |
| `src/components/sharing/` | Owner share panel, permission controls, public-link section, shared rows, and share buttons. |
| `src/pages/SharedPage.tsx` | “Shared with me” index at `/shared`; shared folder contents at `/shared/folders/:id`. |
| `src/state/sharing.ts` | Shared-with-me index, effective access, and realtime invalidation atoms. |
| `src/lib/config.ts` | `serverConfig` / `clientConfig`; the only environment-variable reader. |
| `src/index.css` | Graphite tokens, self-hosted typefaces, global styles, motion, Markdown overrides. |
| `src/assets/fonts/` | Self-hosted Geist and Geist Mono files plus the OFL licence. |
| `src/state/` | Jotai atoms and data, realtime, and lazy-loading hooks. |
| `pocketbase/pb_hooks/` | JSVM hooks, soft-delete trash and public-share routes, relation/owner guards, mailers, cron, bootstrap. |
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
  ├── /api/v1/* ──────────▶ Elysia
  │                          ├── typed workspace ──▶ workspace services ──▶ PB REST (user token)
  │                          ├── browser facade ───▶ allowlists + auth ──▶ PB REST (user token)
  │                          ├── versions ─────────▶ version service ──▶ git store + PB REST
  │                          └── auth/files/realtime/public/trash/admin ──▶ PB REST
  ├── /pb, /pb/* ─────────▶ 404 (the public PocketBase proxy is gone)
  ├── /docs, /docs/json ──▶ OpenAPI spec + self-hosted Scalar reference (public)
  ├── /mcp ───────────────▶ MCP Streamable HTTP ──▶ workspace services ──▶ PB REST (user token)
  │                          └── session token or nana_ API key ──▶ PB impersonation
  ├── /api/chat/* ────────▶ AI SDK providers + ask/edit tools + edit cards ──▶ PB REST (user token)
  ├── /api/export ────────▶ PB documents/attachments → Markdown/ZIP
  ├── /api/app/version ───▶ GitHub Releases API
  └── /* ─────────────────▶ React SPA (dev: Bun HMR, prod: dist/)
```

There is no embedding service, vector store, or background indexer in the topology. Chat reads notes, boards, and tasks on demand and writes notes, boards, and tasks in edit mode; MCP reads and writes folders, notes, boards, and tasks through the shared workspace services.

### Process responsibilities

| Process | Owns | Entry point |
| --- | --- | --- |
| Bun | SPA serving, application API routes, Elysia `/api/v1`, public OpenAPI docs, MCP endpoint, auth verification, rate limiting, CSP, export, chat/provider orchestration, workspace services, ask/edit chat tools, chat edit audit, server-side git version history | `src/index.ts` |
| PocketBase | Data, auth records, API rules, schema, hooks, custom routes, mailers, cron; loopback only | `pocketbase/pb_hooks/index.pb.js` |
| Browser | React UI, Jotai state, `/api/v1` client calls, SSE chat client, SSE realtime relay | `src/frontend.tsx` |
| API / MCP clients | JSON requests to `/api/v1` or `/mcp` with a PocketBase user token or a scoped `nana_…` API key; no browser session required | `src/api/rest/`, `src/api/mcp/`, `src/api/api-keys/` |

### Page load

1. Bun serves `index.html` and built assets from `dist/` in production, or the HMR bundle in development.
2. `src/frontend.tsx` mounts React inside `AuthProvider` and the Jotai `Provider`.
3. `src/App.tsx` validates the stored token through `pb.authStore` and `/api/v1/auth/refresh`.
4. Authenticated routes call `useDocumentData()` once in `AppContent`, which loads root documents, recents, folders, and the read-only trash views through `/api/v1/records`, then starts the `/api/v1/realtime` SSE relay.
5. `AddToBoardHost` mounts once at the app root and waits for a note request atom.

### Browser request

1. The browser client in `src/lib/pocketbase.ts` calls `/api/v1/...`; it never calls PocketBase.
2. Auth calls proxy `/api/v1/auth/*`; records calls hit `/api/v1/records/:collection`; files use `/api/v1/files/*`; live updates use `/api/v1/realtime`.
3. The browser facade decodes the JWT for the caller id and rejects an expired/missing token with `401`.
4. Records writes parse JSON or multipart, drop unknown fields and `author`, inject the caller id, validate folder/board/note ownership, and sanitize document content.
5. Elysia calls PocketBase REST on `127.0.0.1:8090` with the caller's token. PocketBase enforces rules and runs hooks, guards, relation cascades, soft-delete routes, and file protection.
6. The response keeps PocketBase's record shape and `{ code, message, data }` envelope so the SPA's existing error handling stays intact.
7. Realtime is a streaming relay: the unauthenticated `GET /api/v1/realtime` opens the SSE handshake, and the authenticated `POST /api/v1/realtime` subscribes the client id to topics. Bun's timeout is disabled for the GET.

### Typed REST request

1. A client calls `/api/v1/folders`, `/notes`, `/boards`, or `/tasks` with a PocketBase user token or a `nana_…` API key, sent raw or as `Authorization: Bearer <token>`.
2. `authenticateApiRequest()` refreshes a session token or hashes the key, looks it up with the superuser, and mints a normal user token through PocketBase impersonation. The key's access/scope joins `ToolContext`.
3. Elysia validates paths, query strings, and JSON bodies with TypeBox. Validation failures return `422`, malformed JSON returns `400`.
4. The handler calls a workspace service with `surface: "user"` and the caller's `ToolContext`.
5. The service calls PocketBase REST with the caller's user token, adds author and visibility filters, and maps upstream `403`/`404` to one generic `not_found`. A read-only key is rejected with `403` before a mutation.
6. The response is JSON. Errors are `{ "error": "message" }` with the status from the `ApiError`.

`GET /docs` serves a Scalar API reference and `GET /docs/json` serves the OpenAPI document. Both are public and use self-hosted assets, including the app's Geist fonts; `/api/v1` itself is authenticated. See [`api.md`](api.md) for the endpoint table.

### MCP request

1. The client sends `POST /mcp` with the same raw or Bearer session token or API key. Every other method returns `405`.
2. Auth runs before any MCP work; a missing, invalid, or revoked credential returns a plain JSON `401`.
3. A malformed JSON body returns a JSON-RPC `-32700` parse error. Transport failures return `-32603`.
4. Bun creates a fresh `McpServer` and a stateless `WebStandardStreamableHTTPServerTransport` for the request. Responses are JSON, not SSE. Read-only keys get only read tools; folder/root scope is carried in `ToolContext`.
5. Tool calls run through `src/api/workspace/` with `surface: "ai"`; the note and board read tools reuse the chat executors.
6. A failed tool returns an MCP `isError` result whose text is `{ "error": { "code", "message" } }`. The HTTP request still succeeds.

MCP is an AI surface: private records and private-folder subtrees are hidden. It is the separate external write surface; chat has its own ask/edit tool set. See [`ai.md`](ai.md).

### Chat request

1. Browser posts to `/api/chat/send` with the user token, `message`, `mode`, and optional `conversationId`, `context`, and `regenerate`.
2. `verifyAuth()` validates the token. A context, if present, is resolved server-side from `{ type, id }` with ownership, trash, and private-lock checks; the title is loaded from PocketBase, not trusted from the client. `fetchAIConfig()` reads `settings.ai_config` with the server superuser token.
3. Bun creates a `conversations` record when needed, then appends the user turn with its resolved `context` to `messages`. `regenerate: true` trims the prior exchange first.
4. `createChatTools()` builds `list_notes`, `read_note`, `list_boards`, `read_board`, `list_tasks`, and `read_task` using the caller's `Authorization` header and the AI visibility lock. In `mode: "edit"` it also builds the create/update tools and confirm-first delete tools for folders, notes, boards, and tasks.
5. `streamText()` runs with `stopWhen(stepCountIs(8))`; reads use PocketBase on demand, and writes go through `src/api/workspace/` with `actor: "ai"`. Note updates add revision checks; board and task writes use the normal ownership, trash, and status guards. AI edits never commit to version history.
6. The stream pump emits named SSE events (`text`, `reasoning`, `tool`, `sources`, `edit`, `done`, `error`) and, for mode-less requests, legacy AI-SDK chunks. After the model stream ends it persists the assistant text, reasoning, terminal tool names/statuses, the ordered text/tool/edit `parts` timeline, sources, stopped flag, and model name as a `messages` row; appending touches the conversation so it sorts to the top.
7. Applied writes persist server-owned `chat_edits` rows and emit `edit` cards. Title generation runs in the background for a new, non-stopped conversation with no stream error.
8. The response carries `X-Conversation-Id`, `X-Is-New-Conversation`, `X-Model-Name`, and `X-Chat-Mode`.

### Board request

1. The timeline, sidebar, and folder view load `boards` and `tasks` through `listBoardSummaries()` over `/api/v1/records`. There is no separate board index.
2. `/board/:boardId` loads one board and `listTasks(boardId)`, sorted by `board_order` and `created`.
3. The folder view filters active board summaries to the current folder; the shared view lists active `is_public` boards.
4. Dragging a card writes only the changed rows through `persistTaskPositions()`: `status` and `board_order`, never `board`.
5. Dragging a board between folders calls `updateBoard(id, { folder })`. PocketBase runs `guards/relation_guards.js`, which verifies the incoming folder belongs to the caller and is not trashed.
6. Realtime task events refresh the open board; board and task events refresh timeline and folder summaries after a short debounce.
7. Trashing is a board `POST /api/trash/move-board` (or `PATCH { archived: true }`). Permanent delete is allowed only for trashed boards and cascades their tasks.
8. Public board links use `public_share_token`; `/api/public/boards/:token` validates `is_public`, privacy, expiry, and trash state before returning tasks.

### Data flows

| Flow | Path |
| --- | --- |
| Document save | Browser → `/api/v1/records/documents` (JSON or multipart) → Elysia author/relation/sanitize checks → PB hooks (word count) → response; no version is written |
| Save version | Browser → `POST /api/v1/documents/:id/versions` → owner check + revision check → git commit of the current note state → `{ created, version }`; identical state returns `created: false` |
| Version detail | Browser → `GET /api/v1/documents/:id/versions/:versionId` → owner check → git blob read → version fields plus `content` |
| Restore version | Browser → `POST /api/v1/documents/:id/versions/:versionId/restore` → owner + revision check → git commit of current state → PB patch of the selected Markdown body only → `{ document }` |
| Document delete | Browser → `/api/v1/trash/move-document` → PB sets `deleted_at`/`deleted_by` and clears sharing; the record, attachments, and its git repository stay in place |
| Permanent note delete | Browser → `/api/v1/trash/permanent-delete-document` → PB hard-deletes the note and attachments → Bun removes `pb_data/versioning/<noteId>.git` |
| Trash move | Browser → `/api/v1/trash/move-document` → PB marks the live document deleted; `trash_documents` is a read-only view over it |
| Trash restore | Browser → `/api/v1/trash/restore-document` → PB clears the soft-delete fields; a note whose folder is trashed is re-rooted |
| Folder trash | Browser → `/api/v1/trash/move-folder` → PB marks the subtree and its documents, rehomes boards to the root → `{ trashFolderId, movedDocumentIds, movedBoardIds }` |
| Board folder move | Browser → `PATCH /api/v1/records/boards/:id { folder }` → Elysia folder ownership + `guards/relation_guards.js` → realtime refresh |
| Task move | Browser → `PATCH /api/v1/records/tasks/:id` (`status`, `board_order`) → realtime refresh |
| Timeline boards | Browser → `boards` + `tasks` (`fields=board,status`) → per-board open/done/total counts → merged with notes |
| Folder view boards | Browser → `listBoardSummaries()` → filter active boards by `folder = currentFolderId`; shared view filters `is_public` |
| Board trash | Browser → `POST /api/v1/trash/move-board` → timeline, sidebar, and normal folder views exclude it; Trash lists it; public link returns `404` |
| Board delete | Browser → `POST /api/v1/trash/permanent-delete-board` only while trashed → PB cascades the board's tasks and columns |
| Note to task | Browser → `createTaskFromDocument()` → task with `board`, optional `document`, title, excerpt, up to six tags |
| Browser auth | Browser → `/api/v1/auth/*` → PB auth endpoints; token and record keep the PB shape |
| Browser files | Browser → `/api/v1/files/token` + `/api/v1/files/:collection/:record/:file` → PB file token/bytes/thumbnails |
| Browser realtime | Browser → `GET /api/v1/realtime` SSE handshake + authenticated `POST /api/v1/realtime` subscription → PB realtime |
| Typed REST read/write | API client → `/api/v1` → Elysia handler → workspace service (`surface: "user"`) → PB REST with user token → JSON |
| MCP tool call | MCP client → `POST /mcp` → per-request MCP server → workspace service (`surface: "ai"`) → PB REST with user token → tool result |
| Chat read | Browser → `/api/chat/send` (`mode: "ask"`) → `streamText` + read tools → PB REST with user token → named SSE |
| Chat edit | Browser → `/api/chat/send` (`mode: "edit"`, context) → workspace services with `actor: "ai"` + revision/private checks → PB revision hooks → `chat_edits` (including `operations.before`) → edit SSE card + undo route; deletes create pending rows confirmed via `/api/chat/edits/:id/confirm`. Chat never writes version history. |
| Export | Browser → `/api/export` → resolve documents/folders → download attachments → Markdown or ZIP |
| Public share | Public page → `/api/v1/public/*` → PB validates token, expiry, privacy, trash state, and attachment sharing |
| Version check | About tab → `/api/app/version` → cached GitHub Releases lookup |

### Runtime modes

| Mode | How it runs | Notes |
| --- | --- | --- |
| Development | `docker compose -f docker/compose.dev.yml up --build`, or `bun run dev` with a local PocketBase | Bun HMR; CSP allows `ws:`/`wss:` for development. |
| Production | `NODE_ENV=production bun src/index.ts` after `bun run build`, or the production image | Requires `dist/index.html`; strict CSP. |
| Test | `bun run test:docker` | Ephemeral PocketBase and Bun; runs the unit phase and the integration phases. |

Production detection is deliberate: Bun treats the app as production only when `NODE_ENV=production` **and** `dist/index.html` exists. Without the build, it serves the development SPA.

### Design constraints

- **Single origin.** Browser code never hardcodes `:8090` or calls PocketBase; it uses `/api/v1`. `/api/v1` and `/mcp` are same-origin surfaces; there is no CORS layer.
- **Two processes, one container.** The Docker entrypoint runs PocketBase and Bun in parallel and shuts both down.
- **Server-side admin reads.** Settings and AI configuration are admin-only; Bun reads them with the auto-provisioned superuser token.
- **Chat tools are user-scoped and mode-gated.** Workspace reads and writes in `src/api/chat/tools/` must use the caller's token. Ask mode exposes reads only; edit mode adds writes through `src/api/workspace/` with note revision checks, `X-Nana-Actor: ai`, and a server-owned `chat_edits` row.
- **MCP is a separate external write surface.** It reuses `src/api/workspace/` with the caller's token, author scoping, and `surface: "ai"`. It is not chat and does not extend chat's tool set.
- **REST is the owner surface.** `/api/v1` uses `surface: "user"`, so the owner sees their private records; the AI lock is deliberately not applied there.
- **One AI visibility rule.** `src/api/workspace/privacy.ts` defines hidden folders, list conditions, and record checks. Chat and MCP both consume it.
- **No background indexing.** Document saves and trash moves have no fire-and-forget search side effects.
- **SSE needs no timeout.** Chat and PocketBase realtime requests explicitly disable Bun's request timeout.
- **Boards trash before permanent deletion.** PocketBase rejects deleting an active board; task creation and updates are blocked on trashed boards.
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
| `src/api/chat/tools/text.ts` | Pure bounds and escaping helpers shared by chat tools and workspace services. |
| `src/lib/markdown/sections.ts` | Anchor validation, section replacement/insertion, and applied-range reporting for chat note edits. |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, site/sender helpers. |

## Gotchas & invariants

- **Production needs both `NODE_ENV=production` and `dist/index.html`.** Missing `dist` silently serves the dev SPA.
- **`server.timeout(req, 0)` is required** on `/api/chat/send` and `/api/v1/realtime`; otherwise long streams are cut off.
- **The browser facade is an allowlist, not a proxy.** It forwards only allowlisted collections and routes, never system/schema/log/backup/superuser paths, and never injects a superuser token.
- **PocketBase is loopback-only.** The container entrypoint binds `127.0.0.1:8090`; `/pb` returns `404`. Do not publish `8090` or add a pass-through proxy back to PocketBase.
- **The superuser token belongs to configuration, credential exchange, and server-owned audit rows.** `fetchAIConfig()`, the rate limiter, API key lookup/exchange, and `chat_edits` persistence use it; chat tool workspace calls, REST, and MCP must use the caller's token.
- **Chat writes are mode-gated; MCP has its own write surface.** Ask mode exposes reads only. Work-mode writes go through `src/api/workspace/` with a user token, `X-Nana-Actor: ai`, `chat_edits`, and note revision checks; deletes are confirm-first; MCP has a separate tool list and destructive-tool design.
- **Chat note edits are section-scoped and revision-checked.** `read_note` returns `revision` and `versionToken`; the note update tools pass one back. A stale value returns `conflict`. `src/lib/markdown/sections.ts` carries untouched sections through instead of replacing the whole note.
- **Version history is manual-only and git-backed.** Only an explicit Save version commits the current note state into `pb_data/versioning/<noteId>.git`. Autosave, chat, MCP, and trash moves never commit. Restoring commits the current state first (when it differs from HEAD), then applies only the Markdown body; title, tags, folder, and privacy stay. Permanent delete removes the repository. The UI never exposes commit ids, branches, or git terms.
- **Private means hidden from AI, not from the owner.** `/api/v1` is the owner surface and intentionally returns private notes, boards, and folder contents. Only chat and MCP apply `loadAiVisibility()`.
- **MCP tool failures are not HTTP failures.** `POST /mcp` returns `200` with an `isError` text result; only auth, transport, and JSON-RPC errors use HTTP statuses.
- **`/docs` is public by design.** The API itself is authenticated. The Scalar bundle and Geist fonts are served under `/docs/` from `node_modules` and `src/assets/fonts`, not a CDN.
- **A task requires a board.** The `board` relation is required after migration `0000018_created_boards.js`; UI code cannot create a task without one.
- **Trashed boards freeze task writes.** `createRule`/`updateRule` require `board.archived = false`. Deletion of a task on a trashed board remains allowed.
- **Permanently deleting a trashed board cascades its tasks.** The `tasks.board` relation has `cascadeDelete: true`; notes linked through `tasks.document` stay in the library.
- **Incoming relations need a request guard.** PocketBase relation rules see the stored record, so `guards/relation_guards.js` checks `folder`, `parent`, `board`, and `document` on create/update. Removing it allows filing a record into another user's folder or linking a foreign/trashed note.
- **Folder trash rehomes boards.** `boards.folder` uses `cascadeDelete: false`; `move-folder` and permanent folder delete clear the folder pointer instead of deleting boards. `movedBoardIds` reports the rehomed rows from a trash move.
- **Trash is a soft-delete state.** `documents` and `folders` keep their ids, attachments, and version repositories while `deleted_at` is set; version routes hide a trashed note. `trash_documents` and `trash_folders` are read-only views; direct deletes are superuser-only.
- **Hard-deleting a folder cascades.** `folders.parent` and `documents.folder` cascade, so permanent folder delete removes the subtree, notes, git repositories, and attachments. Soft delete does not trigger the cascade.
- **Tasks have no `author`.** Ownership comes from `board.author`; the board relation cascades and the note link does not.
- **`0000020` adds an optional folder relation without a backfill.** Existing boards stay at the workspace root until someone moves them.
- **Board summaries count tasks from one query.** `listBoardSummaries()` includes boards with no tasks; don't replace it with per-board requests.
- **`useDocumentData()` runs once.** It is called at `AppContent` and nowhere else; board pages own their own task state.
- **Rate limits apply before the workspace surfaces.** `/api/v1`, `/docs`, and `/mcp` pass through `checkRateLimit()` at the Bun edge. REST and MCP requests get a 60-second Bun request ceiling; workspace PocketBase calls default to 30 seconds. Chat note/board reads pass an 8-second signal; task reads and chat writes use the 30-second default.
- **Migrations run on container boot.** The entrypoint runs `PB_MIGRATING=1 pocketbase migrate up` before starting either process; a fresh test database therefore includes the current migration head (`0000033`).

## Related docs

- [`api.md`](api.md) — route-level contracts for Bun application routes, Elysia `/api/v1`, MCP, and PocketBase.
- [`frontend.md`](frontend.md) — routes, Jotai state, board/folder UI, chat UI.
- [`ai.md`](ai.md) — chat ask/edit tools, write path, MCP boundary, privacy lock, and persistence.
- [`pocketbase.md`](pocketbase.md) — schema, rules, migrations, board trash lifecycle, board folders.
- [`security.md`](security.md) — trust boundaries, MCP authorization, CSP, secrets.
- [`deployment.md`](deployment.md) — build, Docker, upgrades, persistence.
