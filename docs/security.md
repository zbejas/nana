# Security — trust boundaries, auth, and AI surfaces

## Overview

Nana is self-hosted, so the operator controls the network boundary. The application still enforces a trust boundary between the browser, the Bun server, and PocketBase, and between one user's data and another's.

Nana exposes three public access paths through the Bun origin: the application API (`/api/chat`, `/api/export`, `/api/admin`), the Elysia `/api/v1` typed workspace API plus browser facade with public docs at `/docs`, and the MCP endpoint at `/mcp`. PocketBase is a loopback-only backend. Chat is read + edit: `ask` mode is read-only; `edit` (Work) can create, rename, move, and update folders, notes, boards, and tasks through the workspace services, and archive/restore boards. Deletes are confirm-first: the model creates a pending `chat_edits` row, and the user must approve it before the workspace delete runs. MCP is the separate external write surface with its own authorization rules. `/api/v1` is the owner surface. Both `/api/v1` typed routes and `/mcp` also accept long-lived, scoped API keys for machine clients.

## Key files

| File | Role |
| --- | --- |
| `src/api/auth.ts` | `verifyAuth()` for protected Bun application routes. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()` for `/api/v1` and `/mcp`; raw/Bearer tokens, `auth-refresh`, and `nana_…` API key exchange. |
| `src/api/api-keys/` | Key token format, SHA-256 hashing, superuser-only lookup, impersonation, and owner key management. |
| `src/api/rest/index.ts` | Elysia routes, request validation, OpenAPI docs, error mapping, browser facade mount. |
| `src/api/rest/browser/` | Browser facade: auth, allowlisted records, files, realtime relay, trash, admin, public shares. |
| `src/api/rest/browser/records.ts` | Collection allowlist, author injection, relation ownership, document sanitization. |
| `src/api/mcp/index.ts` | MCP server, tool registration, auth-before-work, stateless transport, `isError` results. |
| `src/index.ts` | CSP, security headers, route registration, rate-limit checks. |
| `src/api/rate-limiter.ts` | Per-IP rate limiting from `settings.rate_limits`. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase access; maps upstream statuses without echoing bodies. |
| `src/api/workspace/privacy.ts` | Hidden-folder computation, AI list filters, and record lock checks. |
| `src/api/workspace/shared.ts` | `Surface` selection, author checks, folder ownership, id/paging normalization, write gating. |
| `src/api/workspace/notes.ts` | Revision-aware note creation, edits, snapshots, and restore for chat undo. |
| `src/lib/markdown/sections.ts` | Anchor validation and section-scoped edits that leave untouched sections not re-sanitized. |
| `src/api/chat/index.ts` | Chat auth, mode/context/attachment handling, tool wiring, streaming, persistence. |
| `src/api/chat/context.ts` | Server-resolved page context with ownership, trash, and private-lock checks. |
| `src/api/chat/attachments.ts` | Session-only upload validation, magic-byte type checks, PDF extraction, draft ownership/binding, and protected-file fetches. |
| `src/api/chat/stream.ts` | Named SSE events, legacy chunks, and stream accumulation. |
| `src/api/chat/edits.ts` | `chat_edits` audit rows, edit-card listing, and revision-aware undo. |
| `src/api/chat/tools/index.ts` | Ask/edit tool registry and per-request source/edit recorder. |
| `src/api/chat/tools/writes.ts` | Edit-mode note/board/task write executors and revision checks. |
| `src/api/chat/tools/version.ts` | Note version tokens and revision matching. |
| `src/api/chat/tools/http.ts` | Re-exports the shared caller-token client. |
| `src/api/chat/tools/notes.ts` | Author-filtered note reads with bounds, truncation, and the private lock. |
| `src/api/chat/tools/boards.ts` | Author-filtered board reads; archived and hidden boards refused. |
| `src/api/chat/tools/tasks.ts` | AI-scoped task reads with archived-board checks. |
| `src/api/chat/pocketbase.ts` | Message sanitization and read/write tool-activity allowlist. |
| `src/api/chat/superuser.ts` | Superuser token for admin-only config reads and server-owned audit rows; never passed to a tool. |
| `pocketbase/pb_hooks/guards/` | Signup, deletion, owner lock, folder-cycle, and incoming relation guards. |
| `pocketbase/pb_hooks/routes/` | Public, trash, and admin routes with ownership checks. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Board/task rules and the board delete rule. |
| `pocketbase/pb_migrations/0000020_boards_in_folders.js` | Board folder relation, private flag, and author/folder index. |
| `pocketbase/pb_migrations/0000022_relational_remodel.js` | Soft-delete trash views, messages records, owner/relation integrity, and indexes. |
| `pocketbase/pb_migrations/0000024_api_keys.js` | `api_keys`: hashed machine credentials with no public rules, access, scope, and folder roots. |
| `pocketbase/pb_migrations/0000027_chat_edits.js` | Document revisions/actor metadata, version snapshots, message context/sources, and the server-owned `chat_edits` audit table. |
| `pocketbase/pb_migrations/0000030_chat_attachments.js` | Owner-scoped `chat_attachments`, protected files, server-only extracted text, and `messages.attachments`. |

## How it works

### Trust boundary

```text
Browser / API client / MCP client (untrusted)
  │  same-origin only; no CORS
  ▼
Bun :3000 (trusted server)
  ├── /api/v1, /docs
  │    ├── typed workspace API
  │    └── browser facade (records/auth/files/realtime/trash/admin/public)
  ├── /mcp
  ├── /api/chat, /api/export, /api/admin
  └── /pb → 404
  │
  ▼
PocketBase 127.0.0.1:8090 (loopback-only trusted backend)
```

- The browser never talks to PocketBase on `:8090`; it uses the same-origin `/api/v1` facade.
- PocketBase is the authority for users, API rules, and collection permissions.
- Bun is the authority for API auth checks, collection allowlisting, author/relation checks, rate limiting, CSP, server-side admin reads, and workspace authorization.
- Chat workspace tools, typed REST services, browser facade writes, and MCP tools sit inside Bun but call PocketBase with the user's token, so they do not gain superuser authority. The server-owned `chat_edits` audit row is the exception; it is written only after conversation ownership is checked.
- `/api/v1` and `/mcp` are same-origin surfaces. The server adds no CORS headers; cross-origin browser clients are not supported.

Production compose exposes only `:3000`. PocketBase binds to `127.0.0.1:8090`, and `EXPOSE`/compose mappings for `8090` are intentionally absent.

### Authentication layers

| Layer | Mechanism |
| --- | --- |
| Browser session | Local auth store in `src/lib/pocketbase.ts`; token validated through `/api/v1/auth/refresh` on startup and on focus. |
| Bun application API | `verifyAuth(req)` calls PB `auth-refresh` and returns the user ID. |
| Elysia typed workspace API | `authenticateApiRequest()` accepts a raw token or `Bearer`, refreshes a session token or exchanges an API key, and returns the user ID plus an optional key scope. |
| Elysia browser facade | Decodes the JWT for caller id/expiry, then PocketBase verifies the unchanged token on every upstream call. API keys are not JWTs and are rejected. |
| MCP `/mcp` | The same `authenticateApiRequest()`, before any MCP work; the key's access and scope travel in `ToolContext`. |
| PocketBase collections | Per-collection API rules (`author = @request.auth.id`, etc.). |
| PocketBase admin routes | `$apis.requireAuth()` plus `requireAdmin(c)`. |
| Server-side admin reads | Auto-provisioned PocketBase superuser token. |
| Chat tools | The caller's raw `Authorization` header and user id; edit-mode writes add `actor: "ai"` but keep the same token. |
| Chat attachments | `verifyAuth` session only; owner-scoped `chat_attachments` rows; protected files fetched with a short-lived PocketBase file token. API keys and MCP are rejected. |
| REST/MCP workspace services | The caller's refreshed token, user id, and a `Surface` (`user` or `ai`). |
| Public docs | `/docs`, `/docs/json`, `/docs/scalar.js`, and the `/docs/geist*.woff2` fonts require no token. |

`src/api/auth.ts` throws `AuthError` with `401` for missing/invalid tokens. `authenticateApiRequest()` also returns `401` when PocketBase cannot be reached to verify the session, rather than falling back to an unauthenticated path.

### Chat tool scoping

`createChatTools({ authHeader, userId }, { mode, recorder, conversationId })` is built per request. `ask` registers only read tools; `edit` registers the read set plus the note/board/task write set. Every tool:

- Sends `Authorization: <user token>` to PocketBase through the shared client. Notes and boards read directly; task reads and every write go through `src/api/workspace/` with `surface: "ai"`.
- Adds `author="<userId>"` to list queries and verifies `record.author === context.userId` for single-record reads.
- Loads the AI visibility set and excludes private records and private-folder subtrees from lists and reads. Write tools re-check the loaded note, folder, board, or task before mutating.
- Refuses archived boards and hidden boards in `read_board`, `list_tasks`, and `read_task`; `list_boards` can list archived boards only when `includeArchived: true`.
- Can create, rename, move, and update folders, notes, boards, and tasks; can archive/restore boards. Cannot publish, share, change privacy, manage columns/labels, or move a task to another board. Delete tools only create a pending action; confirmation re-checks ownership and visibility and runs the workspace delete with the caller's token.
- Is bounded: `perPage` ≤ 50, note windows ≤ 600 lines, note bodies capped at 2,000,000 bytes, lines clipped at 2,000 characters, excerpts at 400 characters.
- Note and board reads abort PocketBase after 8 seconds or when the model aborts; task reads and writes use the workspace client's 30-second default.
- Escapes filter values and accepts ids only when they match `[A-Za-z0-9]{1,64}`.
- Note and board read tools map PocketBase `403` and `404` to the same generic `not_found` so another user's ids are not disclosed.

The superuser token is used for `settings.ai_config`, rate-limit configuration, API key lookup/exchange, and server-owned `chat_edits` rows only. It is never passed into `ToolContext` or returned to a client.

### Chat write path

Chat writes are a real mutation surface, not an extension of the read prompt. The boundary has several independent parts:

| Rule | Implementation |
| --- | --- |
| Mode gate | `createChatTools()` returns the read set in `ask`; the write tools exist only in `edit`. The tool registry, not the system prompt, decides. |
| Delete approval | Delete tools write only a `pending` `chat_edits` row. `POST /api/chat/edits/:id/confirm` verifies the conversation owner, then executes the workspace delete with the caller's token; `/cancel` writes nothing. The model has no direct delete path. |
| Caller token | Write tools call `src/api/workspace/` with `context.authHeader` and `context.userId`; the superuser token is never in `ToolContext`. |
| Actor stamp | `actor: "ai"` adds `X-Nana-Actor: ai`. The revision guard and task activity hooks stamp `last_edited_by`/`last_edit_source`, version `source`/`actor_label`, and task `actor_type` as Nana. |
| Revision | `read_note` returns `revision` and `versionToken`. Note edits require one of them; a mismatch returns `conflict` before PocketBase is touched. The PocketBase revision guard re-checks the submitted revision. |
| Section edits | `append_note` and `edit_note` use `src/lib/markdown/sections.ts`. Fragments are sanitized, untouched sections are not re-sanitized, and a missing or ambiguous anchor aborts the whole edit. |
| Version snapshot | Note update tools send `published: true` as the version-request flag. The PocketBase hook snapshots the old title/content/tags/folder/privacy with `source: "ai"` and `actor_label: "Nana"`, then resets the flag. `create_note` starts a new revision instead. |
| Audit | `chat_edits` has no create/update/delete rules. Bun writes the row with the server credential only after the caller's token proves ownership of the conversation. Its `operations` JSON may carry the pre-edit note snapshot used as an undo fallback, so the collection stays server-only. |
| Undo | A created note is trashed; note edits restore the pre-edit snapshot. Board/task edits have no undo. Note-edit undo returns `409` if newer work exists; a successful undo is idempotent on repeat. |
| Confirm-first deletes | Delete tools create a pending `chat_edits` row only. The explicit confirm route re-checks ownership and visibility, then runs the workspace delete with the caller token. Chat has no direct share, publish, privacy, column, or label tool; moving and archive/restore stay behind the workspace services. |

A failed `chat_edits` write does not fail the workspace mutation; the edit card is omitted and the model still sees success. A failed revision check, private-lock check, archived-board check, or invalid section anchor fails before the workspace write. Chat accepts PocketBase user session tokens only; `nana_…` API keys are rejected, so key scope never applies to chat.

### MCP authorization design

MCP is the separate external write surface. Its safety does not rely on the chat prompt or the chat mode gate.

| Rule | Implementation |
| --- | --- |
| Caller credential only | `handleMcpRequest()` calls `authenticateApiRequest()` and builds `ToolContext` from the caller. A session token is refreshed; a key is exchanged for a normal user token. The superuser token never enters `ToolContext`. |
| Auth before work | A missing, invalid, or revoked token/key returns `401` before the server or transport is created. |
| Author scoping | Every list filters on the owning record (`author`, or `board.author` for tasks); every loaded record is checked against `context.userId`; relation targets are checked for ownership and trashed state. |
| Key scope | An API key's `access` and `scope` travel in `ToolContext`. Read-only keys are not offered write tools; folder/root scope hides out-of-envelope records as `not_found`. |
| Private lock | Every tool passes `surface: "ai"` to the workspace services. Lists filter hidden records; reads and writes to hidden records return `not_found`. A key scope never overrides the private lock. |
| Stateless | No session id, no server-side session store, no cross-request context. A fresh `McpServer` and transport handle one request. |
| No CORS | The endpoint is same-origin only, like the rest of the app. |
| Bounded input | Zod schemas cap ids, names, tags, pages, and per-page sizes; the workspace services re-check enums and bounds. |
| Tool failures | Workspace failures become MCP `isError` text results. They do not become HTTP errors disclosing internals. |
| Destructive actions | `delete_note` trashes a note; `delete_board` only deletes an archived board; `delete_task` is permanent. These tools are explicit in the tool list. |
| No confirmation | The server does not prompt a human before an MCP write. The client is responsible for presenting tool calls to its user. |

A prompt-injected note or task can at worst cause writes inside the caller's own **visible** workspace: it cannot reach another user's records, and it cannot read or write a private record. It could still delete a visible note (to trash), delete an archived board, or permanently delete a visible task, so MCP clients should treat destructive tools with the same care as any other agent tool.

`/api/v1` is the counterpart owner surface: it uses `surface: "user"`, so private records are visible to their owner. Do not copy the REST handler pattern into an AI surface, and do not copy the AI lock into REST.

### API keys and scopes

API keys are the long-lived alternative to a PocketBase session token for machine clients. They are deliberately narrower than a browser session.

| Property | Implementation |
| --- | --- |
| Secret format | `nana_` plus 32 random bytes, base64url. Only a display prefix and a SHA-256 hash are stored in `api_keys`. |
| Storage | `api_keys` has no public PocketBase rules. Bun reads and writes it with the cached superuser token after verifying the caller; hashes never reach a client. |
| Exchange | `resolveApiKeyToken()` matches the hash, then `mintUserToken()` calls PocketBase impersonation for the key's `author`. The minted user token is cached in process memory for 15 minutes and never returned to the caller. |
| Access | `read` blocks every mutation with `403`; MCP also omits write tools. `write` allows mutations inside the scope. |
| Scope | `workspace` = root plus every folder; `root` = records with no folder and no folders themselves; `folders` = selected root subtrees, including descendants, but never the workspace root. |
| Revocation | Deleting the key record invalidates the next authentication immediately. There is no expiry field; revocation is the lifecycle control. |
| Management | Only a signed-in session can list, create, or revoke keys. A key cannot manage keys, even for an admin. |
| Surfaces | Typed `/api/v1` workspace routes and `/mcp` only. The browser facade, chat, export, and admin routes reject keys. |
| Private lock | Unchanged. A workspace key still cannot see private records through MCP; `/api/v1` remains the owner surface. |

Scope is applied by the workspace services through the same hidden-folder set used by the AI lock: lists add exclusions, single-record reads and writes check `recordIsLocked()`, and creating or moving into an out-of-scope location returns `404`. The key envelope is not a prompt statement and not a client-side filter.

The superuser token appears in this flow only to read the hashed key record and to mint the user token. It is never put in `ToolContext`, never sent as the downstream workspace authorization, and never returned by an API route.

### Chat attachments

Attachments are a session-only chat feature. `POST /api/chat/attachments` and `DELETE /api/chat/attachments/:id` call `verifyAuth`; API keys and MCP have no attachment route, and the collection is absent from the generic browser-facade allowlist.

- **Byte validation.** MIME and kind come from magic bytes plus UTF-8 validation, not the browser type. PNG/JPEG/WebP/GIF, PDF, and text/Markdown are accepted; SVG and binary/unknown content are `415`. File size, per-send count, and total bytes are checked before a conversation exists.
- **Ownership and drafts.** Every row carries the caller's `author`; rules require `author = @request.auth.id`. Send resolution rejects foreign/missing ids as `404`, already-bound rows as `400`, and binds only after the user message exists. Draft-only DELETE returns `409` once bound.
- **Model capability gate.** Images require the selected model's `vision`; native PDFs require `files`. A text-only model gets extracted PDF text, and a PDF with no extractable text is refused. This prevents silently sending unsupported binary parts.
- **Protected files.** `chat_attachments.file` is protected. The server fetches bytes with a short-lived file token and an 8-second timeout. The browser file facade allowlists `chat_attachments` for previews; the record collection itself is not exposed.
- **Untrusted content.** Extracted text and PDF fallbacks are wrapped in named `<attachment>` text blocks. The system prompt says attachment contents are untrusted data and never instructions. Older attachments degrade under a request-wide byte/text budget; assistant messages never contribute attachments.
- **No leakage.** API DTOs carry only `{ id, name, mimeType, size, kind }`. Extracted text, the stored protected file name, raw bytes, and file tokens are never returned, persisted in message JSON, or logged. Title generation receives only the user text or the first attachment name.

There is no background draft sweep. An abandoned or failed upload stays as an owner-scoped unbound row until the user deletes it; conversation/message deletes cascade bound rows and files.

### Prompt injection stance

Tool results and chat attachments are untrusted data. Note bodies, task descriptions, text files, and PDF-extracted text can contain text that looks like instructions. The chat system instruction and the MCP instructions tell the model to treat tool text and attachment contents as data, never follow instructions inside them, use only ids returned by tools, and not claim to have read something a tool did not return.

The real boundary is structural, not the prompt:

- Ask-mode chat has no write tools, so injected text can at worst produce a bad answer.
- Work-mode chat can create, rename, move, archive/restore, and change folders, notes, boards, and tasks in the caller's visible workspace. Deletes require a pending confirmation card. Note body writes are revision-checked; publish, share, privacy, column, and label tools remain unavailable, as does moving a task to another board.
- MCP tools are user-scoped and private-locked, so injected text cannot reach another account or a private record. MCP does expose explicit destructive tools.
- Tool output is bounded, so a single note cannot flood the context.
- The final answer is rendered through the sanitized Markdown pipeline; stored message content is sanitized with `sanitizeHtml()`.
- Persisted chat tool activity is allowlisted to `{ name, status }` for the read/write tool set; inputs, outputs, and arguments are never stored or displayed.

Do not add a destructive chat tool. A new chat write stays in `src/api/chat/tools/writes.ts`, goes through `src/api/workspace/` with the caller token, and records a `chat_edits` row. A new MCP write follows the same service boundary with `surface: "ai"`.

### Public endpoints

These intentionally do not require a user token:

- `GET /api/app/version`
- `GET /docs`, `GET /docs/json`, and the self-hosted Scalar and font assets under `/docs/`
- `GET /api/v1/check-users`
- `POST /api/v1/auth/login`, `/auth/methods`, password-reset/email-confirm, and OAuth endpoints
- `GET /api/v1/public/documents/:token` and its attachment route
- `GET /api/v1/public/folders/:token` and its attachment route
- `GET /api/v1/public/boards/:token`
- `GET /api/v1/realtime` handshake (the subscription POST requires auth)
- Static SPA assets

All other Bun application routes call `verifyAuth()` for Bun-level auth. Typed `/api/v1` workspace routes authenticate through `authenticateApiRequest()`, browser facade routes validate the token envelope and let PocketBase verify every upstream call, and `POST /mcp` authenticates before handling. PocketBase collection rules stay in force; do not assume a route is private just because it is under `/api/v1`.

The OpenAPI document is public by design. It describes routes and schemas, not user data. Do not add secrets, internal URLs, or examples containing live tokens to it.

### Admin access

Admin-only PocketBase routes call `requireAdmin(c)`, which:

1. Requires an authenticated record.
2. Requires the `admin` field to be true.
3. Throws `ForbiddenError` otherwise.

Route handlers pass caught errors to `sendError()` in `pocketbase/pb_hooks/utils.js`, so `ForbiddenError` becomes `403`, `BadRequestError` `400`, and `NotFoundError` `404`; only unknown failures become `500`. Do not swallow these into a generic 500 — clients and tests rely on the status.

Admin capabilities include user updates, password changes, SMTP configuration, OAuth configuration, attachment limits, app URL sync, and rate limits.

The first user is auto-assigned `admin = true` and `verified = true`. After that, public signup is locked and only admins can create users. Only verified admins can grant admin to another user. Verified users cannot be deleted.

`GET`/`PATCH /api/v1/admin/rate-limits` are role-checked through `requireBrowserAdmin()`, and the legacy `POST /api/admin/rate-limits/reload` uses `verifyAdmin()`. Both reject a valid non-admin token with `403`; do not lower either check to plain authentication.

### Browser facade safety

`src/api/rest/browser/` replaced the old transparent `/pb` proxy:

- Collection names are allowlisted; system collections, schema, logs, backups, and superuser paths are unreachable.
- Reads forward PocketBase `filter`, `sort`, `expand`, `fields`, and paging only for allowlisted collections.
- Writes drop unknown fields, ignore browser-supplied `author`, inject the caller id, and remove `author` on update.
- Folder parents, board folders, task boards, and task note links are checked for ownership and trashed state before the upstream write.
- Trashed records are hidden by `documents`/`folders` list rules; the read-only `trash_*` views are the only owner-visible path.
- Document `content` is sanitized at the edge; PocketBase file rules and file tokens still protect attachments.
- Admin routes require `admin = true`; settings routes are admin-only.
- File routes allowlist `documents`, `users`, `trash_documents`, and `chat_attachments`.
- Realtime relays PocketBase SSE; the subscription POST requires the user token.
- No superuser token is ever injected into browser traffic.

Do not turn this into a generic proxy. Do not add client-controlled upstream URLs, and do not bypass PocketBase rules by injecting a superuser token.

### CSP and response headers

`src/index.ts` wraps API, docs, MCP, manifest, service-worker, icon, PDF-worker, and production static responses with these headers. The development SPA route is served by Bun's HTML bundle; production serves the built files through the wrapped static handler.

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Strict in production; development additionally allows `ws:`/`wss:` in `connect-src` for HMR. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Production CSP: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `worker-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `connect-src 'self'`; `font-src 'self' data:`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`.

`unsafe-inline` is required by the current editor/bundled styles. `font-src 'self' data:` is required because the production bundle inlines the self-hosted Geist fonts as data URIs; no remote font origin is allowed. Scalar and its Geist fonts are self-hosted under `/docs/`; do not add a CDN origin for them. Do not widen `connect-src` or add remote script/font origins without a concrete need.

### Rate limiting

`src/api/rate-limiter.ts` uses `rate-limiter-flexible` in memory, per IP:

| Scope | Config |
| --- | --- |
| `/api/v1/*` | `rate_limits.pbMaxPerMinute` (legacy key name) |
| Everything else, including `/docs` and `/mcp` | `rate_limits.appMaxPerMinute` |

`rate_limits.enabled` turns it on. The defaults in `src/api/rate-limiter.ts` are disabled, 600 API req/min, and 1200 app req/min. Read and update the config at `GET`/`PATCH /api/v1/admin/rate-limits`; both require the PocketBase admin flag, and the `PATCH` persists the settings and reloads the limiter in one request. `POST /api/admin/rate-limits/reload` remains as an admin-only reload hook.

The limiter is process-local, so it resets on restart and is not shared across replicas. MCP requests can fan out into several PocketBase reads (for example, `list_boards` counts tasks per board); the app limit is the outer bound.

### Sanitization

| Surface | Protection |
| --- | --- |
| Markdown preview | `rehype-sanitize` with an extended GitHub-style schema (`src/lib/sanitize.ts`). |
| Chat messages | `sanitizeHtml()` before persisting to `messages`; context, sources, tools, and stopped are separately allowlisted. |
| Chat edit fragments | `sanitizeHtml()` on each section fragment before `applySectionEdits()`; untouched note sections are not re-sanitized. |
| REST/MCP note content | `sanitizeHtml()` before creating or updating a document. |
| Chat tool activity | Allowlist of read/write tool names and `success`/`error`; no args or outputs. |
| Chat tool excerpts | HTML/Markdown stripped to plain text, truncated. |
| PocketBase HTML responses | `escapeHtml()` from `utils.js` where user data is interpolated. |
| URLs | `sanitizeUrl()` trims quotes and trailing slashes. |
| Attachments | PocketBase protected files + short-lived file token on the client. |
| Static files | `src/api/static-files.ts` blocks traversal and serves only from `dist/`. |

Never render raw user HTML without sanitization. If you add a new Markdown/HTML surface, reuse the existing sanitizer or extend the schema deliberately.

### Board and task access

- `boards` list/view/create/update are author-scoped. Delete requires the owner **and** `archived = true`.
- `boards.folder` is an optional relation. `guards/relation_guards.js` checks the incoming folder on API create/update; the folder must belong to the caller and not be trashed. Clearing it is always allowed.
- `boards.is_private` hides the board from chat and MCP. It does not hide it from its owner, `/api/v1`, or the browser UI.
- `tasks` list/view/delete require `board.author = @request.auth.id`. Create/update additionally require the board to be active, and a newly set note link must be owned and not trashed. Tasks store no separate author.
- An archived board blocks task creation and updates, but still allows the owner to delete tasks.
- Deleting an archived board cascades its tasks through `tasks.board.cascadeDelete`.
- Notes linked via `tasks.document` are not cascaded; deleting a board never deletes notes.
- Folder trash clears the folder pointer on affected boards instead of deleting them. A board is never deleted by a folder operation.
- Documents and folders soft-delete (`deleted_at`) instead of disappearing; normal list/view rules filter them out, and permanent delete is a superuser/internal route.
- Another user's board, task, folder, note, or private record returns `404` through PocketBase or the workspace services, not a list of forbidden ids.

### Public shares

Public sharing is separate from collection rules and from the AI private lock:

- `public_share_token` is a unique 20-byte random hex value.
- `ensureActivePublicShare()` requires `is_public`, rejects `is_private`, and enforces `public_expires_at`.
- Expired shares are disabled on read and cleaned by a 15-minute cron.
- Folder shares skip private subtrees, private documents, and private or archived boards.
- Board shares require `is_public`, reject `is_private` and `archived`, and return the board’s tasks without `author`, `board`, or the linked `document`.
- Attachments require `share_attachments` and membership in the shared document/folder. Boards have no attachments and no attachment route.
- Share tokens are not user auth tokens; never use them to authorize normal API access.

### Secrets and runtime data

Never commit or expose:

- `pocketbase/pb_data/` (SQLite DB, attachments, credentials).
- `pocketbase/pb_data/superuser_credentials.json`.
- API key plaintext. `api_keys` stores only a prefix and a SHA-256 hash.
- AI provider API keys (`settings.ai_config`).
- SMTP/OAuth credentials.
- `.env` files.

Use environment variables (`PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`, `POCKETBASE_URL`, etc.) or the app's Workspace settings. PocketBase's own admin UI is not exposed. `createLogger()` must not log tokens, API keys, credentials, tool inputs, or tool outputs.

### Security review checklist

- Does the change add a new public route? If so, does it validate share tokens/expiry or intentionally need no auth?
- Does a new Bun application route call `verifyAuth()`?
- Does a new `/api/v1` route sit under the scoped Elysia app so `authenticateApiRequest()` runs?
- Does a new MCP tool use the caller's token, author scoping, `surface: "ai"`, and the private lock?
- Does a new workspace read or write respect API key access and scope, including the root/folder boundary?
- Does chat keep `ask` read-only, gate every write behind `mode: "edit"`, route writes through the workspace services with note revision checks and `chat_edits`, and require confirmation for deletes?
- Does a new PocketBase admin route call `requireAdmin(c)`?
- Are PocketBase collection rules still author-scoped?
- Does a write validate incoming `folder`, `parent`, `board`, and `document` relations through `relation_guards.js`?
- Could the change expose a private record to chat or MCP? Could it expose `:8090`, a superuser token, or an API key to the browser?
- Are destructive MCP tools explicit, and does each one preserve its invariant (note → trash, board → archived, task → permanent)?
- Is new HTML sanitized on the server and client?
- Does the change affect file access or attachment tokens? For chat attachments, does it keep uploads session-only, validate bytes, enforce owner/unbound/count/size, and keep extracted text and file names out of client DTOs and logs?
- Does it add a rate-limit bypass or a long-lived background operation?
- Are errors logged without secrets and returned without internals?

## Gotchas & invariants

- **Chat workspace tools must never use the superuser token.** The superuser exists for admin settings reads, credential exchange, and server-owned `chat_edits` rows; never put it in `ToolContext` or use it for a workspace read or write.
- **API keys store only a hash.** Never add the plaintext, hash, or a reversible secret to logs, list responses, or the OpenAPI examples. `api_keys` stays superuser-only.
- **A key is exchanged, not trusted as a user token.** The key's `author` is the only source of identity; mint an impersonation token for that user and keep the superuser token out of `ToolContext`.
- **Key scope is part of the boundary.** A folder-scoped key must never read the root or a sibling subtree, a root-only key must never manage folders, and a read-only key must never reach a mutating service.
- **Author scoping is mandatory even with PocketBase rules.** Lists filter on `author`; single-record reads check `record.author` before returning. Rules protect the API; service code keeps the result set correct and the intent explicit.
- **`403` and `404` collapse to one error.** That is deliberate: PocketBase hides records the caller cannot view, and the service must not reveal the difference.
- **Chat writes are mode-gated, not prompt-gated.** Ask mode must return only the read tools. Edit mode adds the write allowlist; the model cannot obtain a write by asking for one in text.
- **Chat note edits are revision-checked; every applied write is audited.** Note edits require the revision/`versionToken` from `read_note`; the PocketBase guard re-checks it. Applied writes record a server-owned `chat_edits` row. Undo returns `409` rather than overwriting newer work.
- **Chat deletion is confirm-first.** Delete tools can only create a pending card. Confirmation is a separate owner-scoped request that re-runs workspace visibility and board/archive rules. Do not add a direct delete path to the chat registry. Move/rename/archive tools go through the same workspace services and private lock.
- **MCP has its own write design.** User token or exchanged key, author checks, `surface: "ai"`, the private lock, explicit tool schemas, and explicit destructive tools. Do not route MCP through the chat tool set.
- **Private means hidden from AI, not from the owner.** Chat and MCP apply `loadAiVisibility()`; `/api/v1` and the browser client deliberately do not.
- **A private folder hides its descendants.** The lock walks `parent`; a child does not need its own `is_private` flag.
- **MCP has no CORS and no session.** That is deliberate. Cross-origin browser use is unsupported, and every request re-authenticates.
- **Workspace requests are time-bounded.** REST and MCP requests get a 60-second Bun ceiling; the shared PocketBase client defaults to 30 seconds. Chat's note and board read tools pass their tighter 8-second signal; task reads and chat writes use the 30-second default.
- **`/docs` is public.** It describes schemas and routes; it must never contain secrets or live credentials.
- **Tool text can be hostile.** A note can say “ignore previous instructions”. Ask mode can only produce a bad answer; Work mode can create or change visible workspace records, but deletes need the user's confirmation and sharing/privacy remain unavailable. MCP can also delete directly, so its private lock and author checks are part of the boundary.
- **Chat attachments are session-only.** API keys and MCP cannot upload, resolve, or read them. The collection is owner-scoped, absent from the generic record facade, and its file bytes are fetched server-side with a short-lived file token.
- **Attachment text is server-only.** `chat_attachments.text` and the protected file name never appear in message JSON, SSE, API DTOs, title generation, or logs. Only `{ id, name, mimeType, size, kind }` is client-visible.
- **Persisted chat tool activity is content, not diagnostics.** Only allowlisted read/write names and statuses survive; never add args, queries, note text, or edit details to `tools`.
- **`chat_edits` is server-owned.** No public create/update/delete rule exists. The superuser write happens only after the caller's token proves conversation ownership; never expose it as a client-writable collection.
- **Undo is not a general restore.** Only a created note (trash) and note edits (snapshot restore) are undoable. Board/task cards have `undo.kind: "none"`, and a second undo is a no-op. A note-edit undo returns `409` when the note has newer work.
- **Archived boards are not readable through `read_board`, `list_tasks`, or `read_task`.** `list_boards` can return archived metadata, but task reads refuse an archived board.
- **Deleting an active board is blocked at the rule layer.** Do not rely on the UI to enforce archive-first.
- **Board deletion cascades tasks but not notes.** `tasks.board` has `cascadeDelete: true`; `tasks.document` does not.
- **Folder delete never deletes boards.** `boards.folder` has `cascadeDelete: false`; the trash routes rehome boards to the root first.
- **Incoming relation guards are required.** PocketBase relation rules evaluate the stored record, so `folder`, `parent`, `board`, and `document` need `guards/relation_guards.js`.
- **Soft-deleted records still exist.** `$app` code bypasses rules, so internal/public queries must check `deleted_at`; the browser never sees trashed records through the live collections.
- **Direct note/folder deletes are disabled.** `deleteRule` is `null`; only the trash routes can move or permanently delete. Do not loosen this to let a client skip trash.
- **The browser facade is an allowlist.** No system collections, no client-controlled upstream URLs, no superuser token injection, and no generic PocketBase pass-through.
- **Rate-limit admin routes are role-checked.** `GET`/`PATCH /api/v1/admin/rate-limits` and the legacy `POST /api/admin/rate-limits/reload` require the PocketBase admin flag, not just a valid token.
- **The rate limiter is per process.** It does not coordinate across replicas and resets on restart.
- **Legacy runtime data is not application state.** Anything left from removed features is inert; handle cleanup as a deployment operation, not through application code.

## Related docs

- [`api.md`](api.md) — routes, request/response contracts, and MCP tools.
- [`pocketbase.md`](pocketbase.md) — guards, collection rules, public sharing, board/task rules.
- [`ai.md`](ai.md) — chat ask/edit tools, write path, MCP boundary, privacy lock, and persistence.
- [`deployment.md`](deployment.md) — exposure, volumes, runtime data, and upgrade cleanup.
