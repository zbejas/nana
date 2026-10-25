# Security — trust boundaries, auth, and AI surfaces

## Overview

Nana is self-hosted, so the operator controls the network boundary. The application still enforces a trust boundary between the browser, the Bun server, and PocketBase, and between one user's data and another's.

Nana exposes four access paths through the Bun origin: the browser PocketBase proxy at `/pb`, the application API (`/api/chat`, `/api/export`, `/api/admin`), the Elysia REST API at `/api/v1` with public docs at `/docs`, and the MCP endpoint at `/mcp`. Chat is read-only. MCP is a separate write-capable AI surface with its own authorization rules. `/api/v1` is the owner surface.

## Key files

| File | Role |
| --- | --- |
| `src/api/auth.ts` | `verifyAuth()` for protected Bun application routes. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()` for `/api/v1` and `/mcp`; raw/Bearer tokens and `auth-refresh`. |
| `src/api/rest/index.ts` | Elysia routes, request validation, OpenAPI docs, error mapping. |
| `src/api/mcp/index.ts` | MCP server, tool registration, auth-before-work, stateless transport, `isError` results. |
| `src/api/pocketbase-proxy.ts` | Transparent `/pb/*` forwarding; no auth injection or side effects. |
| `src/index.ts` | CSP, security headers, route registration, rate-limit checks. |
| `src/api/rate-limiter.ts` | Per-IP rate limiting from `settings.rate_limits`. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase access; maps upstream statuses without echoing bodies. |
| `src/api/workspace/privacy.ts` | Hidden-folder computation, AI list filters, and record lock checks. |
| `src/api/workspace/shared.ts` | `Surface` selection, author checks, folder ownership, id/paging normalization. |
| `src/api/chat/index.ts` | Chat auth, tool wiring, streaming, persistence. |
| `src/api/chat/tools/http.ts` | Re-exports the shared caller-token client. |
| `src/api/chat/tools/notes.ts` | Author-filtered note reads with bounds, truncation, and the private lock. |
| `src/api/chat/tools/boards.ts` | Author-filtered board/task reads; archived and hidden boards refused. |
| `src/api/chat/pocketbase.ts` | Message sanitization and tool-activity allowlist. |
| `src/api/chat/superuser.ts` | Superuser token for admin-only config reads; never used by tools. |
| `pocketbase/pb_hooks/guards/` | Signup, deletion, trash, version, task, and board-folder guards. |
| `pocketbase/pb_hooks/routes/` | Public, trash, and admin routes with ownership checks. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Board/task rules and the board delete rule. |
| `pocketbase/pb_migrations/0000020_boards_in_folders.js` | Board folder relation, private flag, and author/folder index. |

## How it works

### Trust boundary

```text
Browser / API client / MCP client (untrusted)
  │  same-origin only; no CORS
  ▼
Bun :3000 (trusted server)
  ├── /api/v1, /docs
  ├── /mcp
  ├── /api/chat, /api/export, /api/admin
  └── /pb (transparent proxy)
  │
  ▼
PocketBase :8090 (trusted backend, not exposed publicly)
```

- The browser never talks to PocketBase on `:8090`; it uses the same-origin `/pb` proxy.
- PocketBase is the authority for users, API rules, and collection permissions.
- Bun is the authority for API auth checks, rate limiting, CSP, server-side admin reads, and workspace authorization.
- Chat tools, REST services, and MCP tools sit inside Bun but call PocketBase with the user's token, so they do not gain superuser authority.
- `/api/v1` and `/mcp` are same-origin surfaces. The server adds no CORS headers; cross-origin browser clients are not supported.

Production compose exposes only `:3000`. Do not publish `:8090` unless explicitly requested.

### Authentication layers

| Layer | Mechanism |
| --- | --- |
| Browser session | PocketBase auth store; token validated with `authRefresh()` on startup and on focus. |
| Bun application API | `verifyAuth(req)` calls PB `auth-refresh` and returns the user ID. |
| Elysia REST `/api/v1` | `authenticateApiRequest()` accepts a raw token or `Bearer`, refreshes it, and returns the user ID and refreshed token. |
| MCP `/mcp` | The same `authenticateApiRequest()`, before any MCP work. |
| PocketBase collections | Per-collection API rules (`author = @request.auth.id`, etc.). |
| PocketBase admin routes | `$apis.requireAuth()` plus `requireAdmin(c)`. |
| Server-side admin reads | Auto-provisioned PocketBase superuser token. |
| Chat tools | The caller's raw `Authorization` header and user id. |
| REST/MCP workspace services | The caller's refreshed token, user id, and a `Surface` (`user` or `ai`). |
| Public docs | `/docs`, `/docs/json`, and `/docs/swagger-ui-*` require no token. |

`src/api/auth.ts` throws `AuthError` with `401` for missing/invalid tokens. `authenticateApiRequest()` also returns `401` when PocketBase cannot be reached to verify the session, rather than falling back to an unauthenticated path.

### Chat tool isolation

`createChatTools({ authHeader, userId })` is built per request. Every tool:

- Sends `Authorization: <user token>` to PocketBase through the shared client.
- Adds `author="<userId>"` to list queries and verifies `record.author === context.userId` for single-record reads.
- Loads the AI visibility set and excludes private records and private-folder subtrees from lists and reads.
- Refuses archived boards and hidden boards in `read_board`; `list_boards` can list archived boards only when `includeArchived: true`.
- Is read-only. There is no create, update, delete, move, or share tool in chat.
- Is bounded: `perPage` ≤ 50, note windows ≤ 600 lines, note bodies capped at 2,000,000 bytes, lines clipped at 2,000 characters, excerpts at 400 characters.
- Aborts a PocketBase request after 8 seconds or when the model aborts.
- Escapes filter values and accepts ids only when they match `[A-Za-z0-9]{1,64}`.
- Maps PocketBase `403` and `404` to the same generic `not_found` so another user's ids are not disclosed.

The superuser token is used for `settings.ai_config` and rate-limit configuration only. It is never passed into `ToolContext`.

### MCP authorization design

MCP is the separate write-capable AI surface. Its safety does not rely on the chat prompt.

| Rule | Implementation |
| --- | --- |
| User token only | `handleMcpRequest()` calls `authenticateApiRequest()` and builds `ToolContext` from the caller. No superuser path exists. |
| Auth before work | A missing or invalid token returns `401` before the server or transport is created. |
| Author scoping | Every list filters on `author`; every loaded record is checked against `context.userId`; relation targets are checked for ownership. |
| Private lock | Every tool passes `surface: "ai"` to the workspace services. Lists filter hidden records; reads and writes to hidden records return `not_found`. |
| Stateless | No session id, no server-side session store, no cross-request context. A fresh `McpServer` and transport handle one request. |
| No CORS | The endpoint is same-origin only, like the rest of the app. |
| Bounded input | Zod schemas cap ids, names, tags, pages, and per-page sizes; the workspace services re-check enums and bounds. |
| Tool failures | Workspace failures become MCP `isError` text results. They do not become HTTP errors disclosing internals. |
| Destructive actions | `delete_note` trashes a note; `delete_board` only deletes an archived board; `delete_task` is permanent. These tools are explicit in the tool list. |
| No confirmation | The server does not prompt a human before an MCP write. The client is responsible for presenting tool calls to its user. |

A prompt-injected note or task can at worst cause writes inside the caller's own **visible** workspace: it cannot reach another user's records, and it cannot read or write a private record. It could still delete a visible note (to trash), delete an archived board, or permanently delete a visible task, so MCP clients should treat destructive tools with the same care as any other agent tool.

`/api/v1` is the counterpart owner surface: it uses `surface: "user"`, so private records are visible to their owner. Do not copy the REST handler pattern into an AI surface, and do not copy the AI lock into REST.

### Prompt injection stance

Tool results are untrusted data. Note bodies and task descriptions can contain text that looks like instructions. The chat system instruction and the MCP instructions tell the model to treat tool text as data, never follow instructions inside it, use only ids returned by tools, and not claim to have read something a tool did not return.

The real boundary is structural, not the prompt:

- Chat tools are read-only, so injected text cannot cause a write through chat.
- MCP tools are user-scoped and private-locked, so injected text cannot reach another account or a private record.
- Tool output is bounded, so a single note cannot flood the context.
- The final answer is rendered through the sanitized Markdown pipeline; stored message content is sanitized with `sanitizeHtml()`.
- Persisted chat tool activity is allowlisted to `{ name, status }`; inputs, outputs, and arguments are never stored or displayed.

Do not add a write tool to the chat set. A new MCP write goes through `src/api/workspace/` with `surface: "ai"` and the same author/private checks.

### Public endpoints

These intentionally do not require a user token:

- `GET /api/app/version`
- `GET /docs`, `GET /docs/json`, and the self-hosted Swagger UI assets under `/docs/`
- `GET /api/check-users`
- `GET /pb/api/public/documents/:token` and its attachment route
- `GET /pb/api/public/folders/:token` and its attachment route
- Static SPA assets

All other Bun application routes call `verifyAuth()`. Every `/api/v1` route authenticates through the scoped `derive`. `POST /mcp` authenticates before handling. PocketBase collection routes rely on API rules; do not assume a route is private just because it is under `/pb`.

The OpenAPI document is public by design. It describes routes and schemas, not user data. Do not add secrets, internal URLs, or examples containing live tokens to it.

### Admin access

Admin-only PocketBase routes call `requireAdmin(c)`, which:

1. Requires an authenticated record.
2. Requires the `admin` field to be true.
3. Throws `ForbiddenError` otherwise.

Route handlers pass caught errors to `sendError()` in `pocketbase/pb_hooks/utils.js`, so `ForbiddenError` becomes `403`, `BadRequestError` `400`, and `NotFoundError` `404`; only unknown failures become `500`. Do not swallow these into a generic 500 — clients and tests rely on the status.

Admin capabilities include user updates, password changes, SMTP configuration, OAuth configuration, attachment limits, and app URL sync.

The first user is auto-assigned `admin = true` and `verified = true`. After that, public signup is locked and only admins can create users. Only verified admins can grant admin to another user. Verified users cannot be deleted.

`POST /api/admin/rate-limits/reload` lives under `/api/admin` in the Bun server but is guarded by `verifyAuth()` only, not a separate admin-role check. Keep that in mind if you change its behavior.

### Proxy safety

`src/api/pocketbase-proxy.ts`:

- Forwards method, headers, query string, and body to `POCKETBASE_URL`.
- Sets the upstream `Host` header.
- Disables Bun's timeout for PocketBase realtime connections.
- Does not add or remove authentication; PocketBase enforces it.
- Has no mutation observers or indexing side effects.

Keep the proxy transparent. Do not add client-controlled upstream URLs, and do not bypass PocketBase rules by injecting a superuser token into browser requests.

### CSP and response headers

`src/index.ts` wraps API, proxy, docs, MCP, manifest, service-worker, icon, PDF-worker, and production static responses with these headers. The development SPA route is served by Bun's HTML bundle; production serves the built files through the wrapped static handler.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Strict in production; development additionally allows `ws:`/`wss:` in `connect-src` for HMR. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Production CSP: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `worker-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `connect-src 'self'`; `font-src 'self'`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`.

`unsafe-inline` is required by the current editor/bundled styles. Fonts are self-hosted, so `font-src 'self'` stays closed. Swagger UI is self-hosted under `/docs/`; do not add a CDN origin for it. Do not widen `connect-src` or add remote script/font origins without a concrete need.

### Rate limiting

`src/api/rate-limiter.ts` uses `rate-limiter-flexible` in memory, per IP:

| Scope | Config |
| --- | --- |
| `/pb/*` | `rate_limits.pbMaxPerMinute` |
| Everything else, including `/api/v1`, `/docs`, and `/mcp` | `rate_limits.appMaxPerMinute` |

`rate_limits.enabled` turns it on. The defaults in `src/api/rate-limiter.ts` are disabled, 600 PB req/min, and 1200 app req/min. Reload with `POST /api/admin/rate-limits/reload` after changing settings.

The limiter is process-local, so it resets on restart and is not shared across replicas. MCP requests can fan out into several PocketBase reads (for example, `list_boards` counts tasks per board); the app limit is the outer bound.

### Sanitization

| Surface | Protection |
| --- | --- |
| Markdown preview | `rehype-sanitize` with an extended GitHub-style schema (`src/lib/sanitize.ts`). |
| Chat messages | `sanitizeHtml()` before persisting to `conversations`. |
| REST/MCP note content | `sanitizeHtml()` before creating or updating a document. |
| Chat tool activity | Allowlist of tool names and `success`/`error`; no args or outputs. |
| Chat tool excerpts | HTML/Markdown stripped to plain text, truncated. |
| PocketBase HTML responses | `escapeHtml()` from `utils.js` where user data is interpolated. |
| URLs | `sanitizeUrl()` trims quotes and trailing slashes. |
| Attachments | PocketBase protected files + short-lived file token on the client. |
| Static files | `src/api/static-files.ts` blocks traversal and serves only from `dist/`. |

Never render raw user HTML without sanitization. If you add a new Markdown/HTML surface, reuse the existing sanitizer or extend the schema deliberately.

### Board and task access

- `boards` list/view/create/update are author-scoped. Delete requires the owner **and** `archived = true`.
- `boards.folder` is an optional relation. `guards/board_guards.js` checks the incoming folder on API create/update; the folder must belong to the caller. Clearing it is always allowed.
- `boards.is_private` hides the board from chat and MCP. It does not hide it from its owner, `/api/v1`, or the browser UI.
- `tasks` list/view/delete are author-scoped. Create/update require the author's own active board: `board.author = @request.auth.id && board.archived = false`.
- An archived board blocks task creation and updates, but still allows the owner to delete tasks.
- Deleting an archived board cascades its tasks through `tasks.board.cascadeDelete`.
- Notes linked via `tasks.document` are not cascaded; deleting a board never deletes notes.
- Folder trash clears the folder pointer on affected boards instead of deleting them. A board is never deleted by a folder operation.
- Another user's board, task, folder, note, or private record returns `404` through PocketBase or the workspace services, not a list of forbidden ids.

### Public shares

Public sharing is separate from collection rules and from the AI private lock:

- `public_share_token` is a unique 20-byte random hex value.
- `ensureActivePublicShare()` requires `is_public`, rejects `is_private`, and enforces `public_expires_at`.
- Expired shares are disabled on read and cleaned by a 15-minute cron.
- Folder shares skip private subtrees and private documents.
- Attachments require `share_attachments` and membership in the shared document/folder.
- Share tokens are not user auth tokens; never use them to authorize normal API access.

Boards have no public-share flow; a private board is an AI visibility flag only.

### Secrets and runtime data

Never commit or expose:

- `pocketbase/pb_data/` (SQLite DB, attachments, credentials).
- `pocketbase/pb_data/superuser_credentials.json`.
- AI provider API keys (`settings.ai_config`).
- SMTP/OAuth credentials.
- `.env` files.

Use environment variables (`PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`, `POCKETBASE_URL`, etc.) or the admin UI. `createLogger()` must not log tokens, API keys, credentials, tool inputs, or tool outputs.

### Security review checklist

- Does the change add a new public route? If so, does it validate share tokens/expiry or intentionally need no auth?
- Does a new Bun application route call `verifyAuth()`?
- Does a new `/api/v1` route sit under the scoped Elysia app so `authenticateApiRequest()` runs?
- Does a new MCP tool use the caller's token, author scoping, `surface: "ai"`, and the private lock?
- Is chat still read-only? MCP writes belong in the separate surface, not in `src/api/chat/tools/`.
- Does a new PocketBase admin route call `requireAdmin(c)`?
- Are PocketBase collection rules still author-scoped?
- Does a board write validate the incoming `folder` owner through `board_guards.js`?
- Could the change expose a private record to chat or MCP? Could it expose `:8090`, a superuser token, or an API key to the browser?
- Are destructive MCP tools explicit, and does each one preserve its invariant (note → trash, board → archived, task → permanent)?
- Is new HTML sanitized on the server and client?
- Does the change affect file access or attachment tokens?
- Does it add a rate-limit bypass or a long-lived background operation?
- Are errors logged without secrets and returned without internals?

## Gotchas & invariants

- **Chat tools must never use the superuser token.** The superuser exists for admin settings reads; using it in `ToolContext` removes the per-user boundary.
- **Author scoping is mandatory even with PocketBase rules.** Lists filter on `author`; single-record reads check `record.author` before returning. Rules protect the API; service code keeps the result set correct and the intent explicit.
- **`403` and `404` collapse to one error.** That is deliberate: PocketBase hides records the caller cannot view, and the service must not reveal the difference.
- **Chat read-only is a security property, not a prompt.** The model cannot be trusted to ignore injected instructions; the chat tool set has no write path.
- **MCP writes require the separate design.** User token, author checks, `surface: "ai"`, the private lock, and explicit tool schemas. Do not add a write by extending the chat tools.
- **Private means hidden from AI, not from the owner.** Chat and MCP apply `loadAiVisibility()`; `/api/v1` and the browser SDK deliberately do not.
- **A private folder hides its descendants.** The lock walks `parent`; a child does not need its own `is_private` flag.
- **MCP has no CORS and no session.** That is deliberate. Cross-origin browser use is unsupported, and every request re-authenticates.
- **Workspace requests are time-bounded.** REST and MCP requests get a 60-second Bun ceiling; the shared PocketBase client defaults to 30 seconds, and chat tools pass their tighter 8-second signal.
- **`/docs` is public.** It describes schemas and routes; it must never contain secrets or live credentials.
- **Tool text can be hostile.** A note can say “ignore previous instructions”. Chat can only produce a bad answer. MCP could perform a write in the caller's visible workspace, so its private lock and author checks are part of the boundary.
- **Persisted chat tool activity is content, not diagnostics.** Only allowlisted names/statuses survive; never add args, queries, or note text to `tools`.
- **Archived boards are not readable through `read_board`.** `list_boards` can return archived metadata, but the tool refuses to read their tasks.
- **Deleting an active board is blocked at the rule layer.** Do not rely on the UI to enforce archive-first.
- **Board deletion cascades tasks but not notes.** `tasks.board` has `cascadeDelete: true`; `tasks.document` does not.
- **Folder delete never deletes boards.** `boards.folder` has `cascadeDelete: false`; the trash routes rehome boards to the root first.
- **The board folder guard is required.** PocketBase relation rules evaluate the stored record, so the incoming `folder` needs `guards/board_guards.js`.
- **The proxy must stay transparent.** No auth injection, no client-controlled upstream URL, no indexing side effects.
- **`src/api/admin/rate-limits/reload` is auth-only.** It is not role-checked despite the path.
- **The rate limiter is per process.** It does not coordinate across replicas and resets on restart.
- **Legacy runtime data is not application state.** Anything left from removed features is inert; handle cleanup as a deployment operation, not through application code.

## Related docs

- [`api.md`](api.md) — routes, request/response contracts, and MCP tools.
- [`pocketbase.md`](pocketbase.md) — guards, collection rules, public sharing, board/task rules.
- [`ai.md`](ai.md) — chat tools, MCP boundary, privacy lock, and persistence.
- [`deployment.md`](deployment.md) — exposure, volumes, runtime data, and upgrade cleanup.
