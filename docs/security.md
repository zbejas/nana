# Security — trust boundaries, auth, and AI tools

## Overview

Nana is self-hosted, so the operator controls the network boundary. The application still enforces a trust boundary between the browser, the Bun server, and PocketBase, and between one user's data and another's.

## Key files

| File | Role |
| --- | --- |
| `src/api/auth.ts` | `verifyAuth()` for protected Bun API routes. |
| `src/api/pocketbase-proxy.ts` | Transparent `/pb/*` forwarding; no auth injection or side effects. |
| `src/index.ts` | CSP, security headers, route registration, rate-limit checks. |
| `src/api/rate-limiter.ts` | Per-IP rate limiting from `settings.rate_limits`. |
| `src/api/chat/index.ts` | Chat auth, tool wiring, streaming, persistence. |
| `src/api/chat/tools/http.ts` | User-token PocketBase access and generic error mapping. |
| `src/api/chat/tools/notes.ts` | Author-filtered note reads with bounds and truncation. |
| `src/api/chat/tools/boards.ts` | Author-filtered board/task reads; archived boards refused. |
| `src/api/chat/pocketbase.ts` | Message sanitization and tool-activity allowlist. |
| `src/api/chat/superuser.ts` | Superuser token for admin-only config reads; never used by tools. |
| `pocketbase/pb_hooks/guards/` | Signup, deletion, trash, and version guards. |
| `pocketbase/pb_hooks/routes/` | Public, trash, and admin routes with ownership checks. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Board/task rules and the board delete rule. |

## How it works

### Trust boundary

```text
Browser (untrusted)
  │  same-origin only
  ▼
Bun :3000 (trusted server)
  │
  ▼
PocketBase :8090 (trusted backend, not exposed publicly)
```

- The browser never talks to PocketBase on `:8090`; it uses the same-origin `/pb` proxy.
- PocketBase is the authority for users, API rules, and collection permissions.
- Bun is the authority for API auth checks, rate limiting, CSP, and server-side admin reads.
- Chat tools sit inside Bun but call PocketBase with the user's token, so they do not gain superuser authority.

Production compose exposes only `:3000`. Do not publish `:8090` unless explicitly requested.

### Authentication layers

| Layer | Mechanism |
| --- | --- |
| Browser session | PocketBase auth store; token validated with `authRefresh()` on startup and on focus. |
| Bun API | `verifyAuth(req)` calls PB `auth-refresh` and returns the user ID. |
| PocketBase collections | Per-collection API rules (`author = @request.auth.id`, etc.). |
| PocketBase admin routes | `$apis.requireAuth()` plus `requireAdmin(c)`. |
| Server-side admin reads | Auto-provisioned PocketBase superuser token. |
| Chat tools | The caller's raw `Authorization` header and user id. |

`src/api/auth.ts` throws `AuthError` with `401` for missing/invalid tokens. Handlers map that to a JSON error response.

### Chat tool isolation

`createChatTools({ authHeader, userId })` is built per request. Every tool:

- Sends `Authorization: <user token>` to PocketBase through `pbGet()`.
- Adds `author="<userId>"` to list queries and verifies `record.author === context.userId` for single-record reads.
- Refuses archived boards in `read_board`; `list_boards` can list them only when `includeArchived: true`.
- Is read-only. There is no create, update, delete, move, or share tool.
- Is bounded: `perPage` ≤ 50, note windows ≤ 600 lines, note bodies capped at 2,000,000 bytes, lines clipped at 2,000 characters, excerpts at 400 characters.
- Aborts a PocketBase request after 8 seconds or when the model aborts.
- Escapes filter values and accepts ids only when they match `[A-Za-z0-9]{1,64}`.
- Maps PocketBase `403` and `404` to the same generic `not_found` so another user's ids are not disclosed.

The superuser token is used for `settings.ai_config` and rate-limit configuration only. It is never passed into `ToolContext`.

### Prompt injection stance

Tool results are untrusted data. Note bodies and task descriptions can contain text that looks like instructions. The fixed system instruction tells the model to treat tool text as data, never follow instructions inside it, use only ids returned by tools, and not claim to have read something a tool did not return.

The real boundary is structural, not the prompt:

- Tools are read-only, so injected text cannot cause a write.
- Tools are user-scoped, so injected text cannot reach another account.
- Tool output is bounded, so a single note cannot flood the context.
- The final answer is rendered through the sanitized Markdown pipeline; stored message content is sanitized with `sanitizeHtml()`.
- Persisted tool activity is allowlisted to `{ name, status }`; inputs, outputs, and arguments are never stored or displayed.

Adding a write-capable tool would require a separate authorization and confirmation design. Do not add one by extending the read set.

### Public endpoints

These intentionally do not require a user token:

- `GET /api/check-users`
- `GET /pb/api/public/documents/:token` and its attachment route
- `GET /pb/api/public/folders/:token` and its attachment route
- Static SPA assets and `GET /api/app/version`

All other Bun API routes call `verifyAuth()`. PocketBase collection routes rely on API rules; do not assume a route is private just because it is under `/pb`.

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

`src/index.ts` wraps API, proxy, manifest, service-worker, icon, PDF-worker, and production static responses with these headers. The development SPA route is served by Bun's HTML bundle; production serves the built files through the wrapped static handler.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Strict in production; development additionally allows `ws:`/`wss:` in `connect-src` for HMR. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Production CSP: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `worker-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `connect-src 'self'`; `font-src 'self'`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`.

`unsafe-inline` is required by the current editor/bundled styles. Fonts are self-hosted, so `font-src 'self'` stays closed. Do not widen `connect-src` or add remote script/font origins without a concrete need.

### Rate limiting

`src/api/rate-limiter.ts` uses `rate-limiter-flexible` in memory, per IP:

| Scope | Config |
| --- | --- |
| `/pb/*` | `rate_limits.pbMaxPerMinute` |
| Everything else | `rate_limits.appMaxPerMinute` |

`rate_limits.enabled` turns it on. The defaults in `src/api/rate-limiter.ts` are disabled, 600 PB req/min, and 1200 app req/min. Reload with `POST /api/admin/rate-limits/reload` after changing settings.

The limiter is process-local, so it resets on restart and is not shared across replicas.

### Sanitization

| Surface | Protection |
| --- | --- |
| Markdown preview | `rehype-sanitize` with an extended GitHub-style schema (`src/lib/sanitize.ts`). |
| Chat messages | `sanitizeHtml()` before persisting to `conversations`. |
| Chat tool activity | Allowlist of tool names and `success`/`error`; no args or outputs. |
| Chat tool excerpts | HTML/Markdown stripped to plain text, truncated. |
| PocketBase HTML responses | `escapeHtml()` from `utils.js` where user data is interpolated. |
| URLs | `sanitizeUrl()` trims quotes and trailing slashes. |
| Attachments | PocketBase protected files + short-lived file token on the client. |
| Static files | `src/api/static-files.ts` blocks traversal and serves only from `dist/`. |

Never render raw user HTML without sanitization. If you add a new Markdown/HTML surface, reuse the existing sanitizer or extend the schema deliberately.

### Board and task access

- `boards` list/view/create/update are author-scoped. Delete requires the owner **and** `archived = true`.
- `tasks` list/view/delete are author-scoped. Create/update require the author's own active board: `board.author = @request.auth.id && board.archived = false`.
- An archived board blocks task creation and updates, but still allows the owner to delete tasks.
- Deleting an archived board cascades its tasks through `tasks.board.cascadeDelete`.
- Notes linked via `tasks.document` are not cascaded; deleting a board never deletes notes.
- Another user's board or task returns `404` through PocketBase, not a list of forbidden ids.

### Public shares

Public sharing is separate from collection rules:

- `public_share_token` is a unique 20-byte random hex value.
- `ensureActivePublicShare()` requires `is_public`, rejects `is_private`, and enforces `public_expires_at`.
- Expired shares are disabled on read and cleaned by a 15-minute cron.
- Folder shares skip private subtrees and private documents.
- Attachments require `share_attachments` and membership in the shared document/folder.
- Share tokens are not user auth tokens; never use them to authorize normal API access.

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
- Does a new Bun API call `verifyAuth()`?
- Does a new PocketBase admin route call `requireAdmin(c)`?
- Are PocketBase collection rules still author-scoped?
- Does a new AI tool use the caller's token and author scoping, and is it still read-only?
- Could the change expose `:8090`, a superuser token, or an API key to the browser?
- Is new HTML sanitized on the server and client?
- Does the change affect file access or attachment tokens?
- Does it add a rate-limit bypass or a long-lived background operation?
- Are errors logged without secrets and returned without internals?

## Gotchas & invariants

- **Chat tools must never use the superuser token.** The superuser exists for admin settings reads; using it in `ToolContext` removes the per-user boundary.
- **Author scoping is mandatory even with PocketBase rules.** Lists filter on `author`; single-record reads check `record.author` before returning. Rules protect the API; tool code keeps the result set correct and the intent explicit.
- **`403` and `404` collapse to one tool error.** That is deliberate: PocketBase hides records the caller cannot view, and the tool must not reveal the difference.
- **Read-only is the security property, not a prompt.** The model cannot be trusted to ignore injected instructions; the tool set simply has no write path.
- **Tool text can be hostile.** A note can say “ignore previous instructions”. The system prompt says not to follow it; the read-only scope ensures the worst case is a bad answer.
- **Persisted tool activity is content, not diagnostics.** Only allowlisted names/statuses survive; never add args, queries, or note text to `tools`.
- **Archived boards are not readable through `read_board`.** `list_boards` can return archived metadata, but the tool refuses to read their tasks.
- **Deleting an active board is blocked at the rule layer.** Do not rely on the UI to enforce archive-first.
- **Board deletion cascades tasks but not notes.** `tasks.board` has `cascadeDelete: true`; `tasks.document` does not.
- **The proxy must stay transparent.** No auth injection, no client-controlled upstream URL, no indexing side effects.
- **`src/api/admin/rate-limits/reload` is auth-only.** It is not role-checked despite the path.
- **The rate limiter is per process.** It does not coordinate across replicas and resets on restart.
- **Legacy runtime data is not application state.** Anything left from removed features is inert; handle cleanup as a deployment operation, not through application code.

## Related docs

- [`api.md`](api.md) — routes and auth requirements.
- [`pocketbase.md`](pocketbase.md) — guards, collection rules, public sharing, board/task rules.
- [`ai.md`](ai.md) — read tools, prompt contract, and persistence.
- [`deployment.md`](deployment.md) — exposure, volumes, runtime data, and upgrade cleanup.
