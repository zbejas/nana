# API — Elysia, MCP, and internal PocketBase

## Overview

Nana exposes four HTTP surfaces through one Bun origin:

- **Bun application API** — `/api/chat`, `/api/export`, `/api/app/version`, and `/api/admin`.
- **Elysia `/api/v1`** — the owner workspace API (folders, notes, boards, tasks), the browser facade (auth, records, files, realtime, trash, admin, public shares), and public OpenAPI docs at `/docs` and `/docs/json`.
- **MCP** — `POST /mcp`, a stateless Streamable HTTP endpoint for AI clients.
- **PocketBase** — an internal data/auth/hook engine on `127.0.0.1:8090`. It is not a public surface.

The browser uses the small client in `src/lib/pocketbase.ts`, which talks only to `/api/v1`. The compatibility-shaped browser facade in `src/api/rest/browser/` keeps PocketBase's record and error shapes so the SPA did not need a screen-by-screen rewrite. `/pb` is gone: `GET /pb` and `/pb/*` return `404`.

`/api/v1` and `/mcp` accept the user token raw or as a Bearer token:

```http
Authorization: <pocketbase-auth-token>
Authorization: Bearer <pocketbase-auth-token>
```

`verifyAuth()` validates tokens for the application API. `authenticateApiRequest()` validates them for the typed workspace API and `/mcp`, accepts either form, and uses the refreshed token for downstream calls. The browser facade decodes the JWT for the caller id, then lets PocketBase verify the token on every upstream call. PocketBase collection rules, guards, hooks, cascades, trash logic, and file protection stay in force.

## Key files

| File | Role |
| --- | --- |
| `src/index.ts` | Bun route table, Elysia mount, MCP mount, rate-limit checks, security headers, and the 404 guard for the old `/pb` path. |
| `src/api/rest/index.ts` | Elysia typed workspace routes, REST error mapping, browser facade mount, and self-hosted Scalar assets. |
| `src/api/rest/browser/` | Browser facade: auth, allowlisted records, files, realtime relay, trash, admin, public shares. |
| `src/api/rest/browser/records.ts` | Collection allowlist, author injection, relation ownership checks, document sanitization, and PB-shaped errors. |
| `src/api/rest/browser/realtime.ts` | SSE relay for `/api/v1/realtime` plus authenticated subscription POSTs. |
| `src/api/rest/openapi.ts` | OpenAPI document metadata, Scalar configuration, Graphite docs theme, and shared docs paths. |
| `src/api/rest/responses.ts` | Shared error response schemas used by runtime validation and the OpenAPI document. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()`; raw/Bearer token handling and `auth-refresh` for typed workspace routes. |
| `src/api/rest/schemas.ts` | TypeBox request, query, params, and response schemas. |
| `src/api/mcp/index.ts` | MCP server construction, folder/note/board/task tool registrations, stateless transport, JSON-RPC errors. |
| `src/api/workspace/` | Shared folder, note, board, and task services used by the typed workspace API and MCP. |
| `src/api/workspace/privacy.ts` | `loadAiVisibility()`, `aiVisibilityConditions()`, and the record lock helpers. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase REST client and status mapping. |
| `src/api/auth.ts` | `verifyAuth()` and `AuthError`. |
| `src/api/chat/index.ts` | Chat request parsing, SSE response, conversation dispatch. |
| `src/api/chat/tools/` | Read-only `list_notes`, `read_note`, `list_boards`, `read_board`, shared with MCP reads. |
| `src/api/export/` | Markdown and ZIP export. |
| `src/api/app-version.ts` | Cached GitHub Releases lookup. |
| `src/lib/pocketbase.ts` | Browser client over `/api/v1`; preserves the small `pb.collection` / `pb.authStore` / `pb.files` surface the SPA uses. |
| `src/lib/boards/` | Browser-side board CRUD, folder/privacy/public-share fields, and summaries over `/api/v1/records`. |
| `src/lib/tasks/` | Browser-side task CRUD, ordering, and note import over `/api/v1/records`. |
| `pocketbase/pb_hooks/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users. |
| `pocketbase/pb_hooks/guards/board_guards.js` | Board folder ownership on API create/update. |
| `pocketbase/pb_migrations/` | Collection schema and API rules. |

## How it works

### Conventions

| Topic | Convention |
| --- | --- |
| Typed workspace API | `/api/v1/folders`, `/notes`, `/boards`, `/tasks`: JSON with camelCase fields and `{ "error": "message" }` failures. |
| Browser facade | `/api/v1/records`, `/auth`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`: PocketBase-shaped records (snake_case fields) and `{ code, message, data }` failures. |
| `/api/v1` auth | Raw user token or `Authorization: Bearer <token>`; invalid or expired tokens return `401`. |
| Typed validation | Path/query/body schemas return `422`; malformed JSON returns `400`. |
| Browser facade validation | The facade rejects unknown collections, cross-user relations, author spoofing, and unsafe writes with `400`/`404`; PocketBase field errors pass through. |
| MCP | JSON-RPC over Streamable HTTP; tool failures are `isError` results, not HTTP failures. |
| Application API errors | Bun handlers return `{ "error": "message" }`; PocketBase returns its standard error envelope. |
| Auth failure | Missing or invalid user token (`401`); authenticated non-admin on an admin route (`403`). |
| Rate limit | `429` with `Retry-After` when `settings.rate_limits.enabled` is true. `/api/v1` uses the `pbMaxPerMinute` bucket; everything else uses the app bucket. |
| SSE | `/api/chat/send` and `/api/v1/realtime` disable the Bun request timeout. Chat streams the AI SDK UI message protocol; realtime relays PocketBase SSE. |
| Browser URLs | Always same-origin `/api/v1`, never `:8090`. |

### Elysia `/api/v1`

`/api/v1` is the **owner surface**. It has two layers:

1. **Typed workspace API** — `/folders`, `/notes`, `/boards`, `/tasks`. These use the workspace services with `surface: "user"`, so the owner sees their private notes, boards, folders, and private-folder contents. The AI visibility lock applies only to chat and MCP.
2. **Browser facade** — `/auth`, `/records`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`, `/check-users`, `/me`. These keep the PocketBase record/error shape the SPA already understands while Elysia owns the public edge.

Neither layer replaces PocketBase. Both call the loopback PocketBase REST API with the caller's own token; PocketBase still enforces API rules, guards, hooks, cascades, trash copying, and file protection. The browser facade adds the missing public-edge checks: collection allowlisting, author injection, relation ownership, and note sanitization.

#### Authentication and docs

Typed workspace routes and MCP call `authenticateApiRequest()` before the handler:

1. Extract the raw token or the value after `Bearer`.
2. POST it to PocketBase `auth-refresh` (8-second timeout).
3. Use the returned record id as the author and the refreshed token for downstream PocketBase calls.
4. Return `401 { "error": "..." }` when the header is missing, the token is invalid/expired, or PocketBase cannot verify it.

Browser facade routes decode the JWT locally for the caller id and expiry, then send the unchanged token upstream. PocketBase rejects a forged or revoked token, so no write or read succeeds without its authorization. Auth, public-share, and file-token routes are the deliberate exceptions to "decode first"; they proxy PocketBase's public/auth endpoints directly.

`GET /docs` serves a Scalar API reference and `GET /docs/json` serves the OpenAPI document. Both are **public**; `/api/v1` itself is not. The Scalar bundle is served from `@scalar/api-reference` at `/docs/scalar.js`; the docs use the app's self-hosted Geist fonts at `/docs/geist.woff2` and `/docs/geist-mono.woff2`. No CDN or external font origin is needed, so the CSP stays `script-src 'self'` and `font-src 'self' data:` (the production bundle inlines the app fonts as data URIs).

`GET /docs` serves a Scalar API reference and `GET /docs/json` serves the OpenAPI document. Both are **public**; `/api/v1` itself is not. The Scalar bundle is served from `@scalar/api-reference` at `/docs/scalar.js`; the docs use the app's self-hosted Geist fonts at `/docs/geist.woff2` and `/docs/geist-mono.woff2`. No CDN or external font origin is needed, so the CSP stays `script-src 'self'` and `font-src 'self'`.

The spec uses `APP_VERSION`, grouped Folders/Notes/Boards/Tasks tags, stable operation ids, per-status error responses, request/response examples, and a `bearerAuth` HTTP security scheme. Scalar's own theme is disabled in favour of Graphite CSS variables so the reference reads like the rest of Nana.

#### Endpoints

Path ids must match `[A-Za-z0-9]{1,64}`.

| Method | Path | Input | Success |
| --- | --- | --- | --- |
| `GET` | `/api/v1/folders` | — | `200` array of folder DTOs, sorted by name. |
| `POST` | `/api/v1/folders` | `{ name, parentId?, isPrivate? }` | `201` folder DTO. |
| `GET` | `/api/v1/notes` | `query`, `tag`, `folderId`, `page`, `perPage`, `sort` | `200` paged note summaries; no content. |
| `POST` | `/api/v1/notes` | `{ title?, content?, tags?, folderId?, isPrivate? }` | `201` note DTO. |
| `GET` | `/api/v1/notes/:id` | — | `200` note DTO including content. |
| `PATCH` | `/api/v1/notes/:id` | Same fields as create | `200` note DTO. |
| `DELETE` | `/api/v1/notes/:id` | — | `200 { "trashDocumentId": "id" }`. |
| `GET` | `/api/v1/boards` | `includeArchived`, `folderId`, `page`, `perPage` | `200` paged board DTOs. |
| `POST` | `/api/v1/boards` | `{ name, description?, folderId?, isPrivate? }` | `201` board DTO. |
| `GET` | `/api/v1/boards/:id` | — | `200` board DTO. |
| `PATCH` | `/api/v1/boards/:id` | `{ name?, description?, archived?, folderId?, isPrivate? }` | `200` board DTO. |
| `DELETE` | `/api/v1/boards/:id` | — | `204`; only when archived. |
| `GET` | `/api/v1/boards/:id/tasks` | `status`, `page`, `perPage` | `200` paged task DTOs, ordered by `board_order`, then `created`. |
| `POST` | `/api/v1/boards/:id/tasks` | `{ title, description?, status?, priority?, dueDate?, boardOrder?, labels?, noteId? }` | `201` task DTO. |
| `POST` | `/api/v1/boards/:id/notes` | `{ noteId, status? }` | `201` task DTO copied from the note. |
| `GET` | `/api/v1/tasks/:id` | — | `200` task DTO. |
| `PATCH` | `/api/v1/tasks/:id` | `{ title?, description?, status?, priority?, dueDate?, boardOrder?, labels?, noteId?, boardId? }` | `200` task DTO. |
| `DELETE` | `/api/v1/tasks/:id` | — | `204`; permanent. |

List endpoints return:

```json
{
  "items": [],
  "page": 1,
  "perPage": 20,
  "totalItems": 0,
  "totalPages": 0
}
```

`perPage` is capped at 50. Notes and boards default to 20; task lists default to 50. `page` is 1-based. `GET /folders` is the exception: it returns a plain array of every owned folder.

#### DTOs

| DTO | Fields |
| --- | --- |
| Folder | `id`, `name`, `parentId`, `isPrivate`, `isPublic`, `created`, `updated`. |
| Note summary | `id`, `title`, `tags`, `folderId`, `isPrivate`, `isPublic`, `published`, `wordCount`, `readingTime`, `created`, `updated`. |
| Note | Summary plus `slug` and `content`. |
| Board | `id`, `name`, `description`, `archived`, `folderId`, `isPrivate`, `created`, `updated`. |
| Task | `id`, `title`, `description`, `status`, `priority`, `dueDate`, `boardOrder`, `labels`, `noteId`, `boardId`, `created`, `updated`. |

`folderId`, `noteId`, `dueDate`, and `parentId` are `null` when unset. `priority` is `""` when unset.

#### Request notes

- **Notes.** Titles default to `Untitled`; slugs are generated from the title. `content` is sanitized before storage. List results never include bodies, and `query` searches titles and tags only. Send `folderId: ""` or `null` to move a note to the root. Attachments are not managed by this API.
- **Folders.** A parent must belong to the caller. There is no folder update or delete route on `/api/v1`; the UI still uses the PocketBase collection and trash routes.
- **Boards.** Active boards are returned by default; `includeArchived=true` adds archived boards. `archived: true` archives; `archived: false` restores. A board may only be deleted while archived; deleting it cascades its tasks. `folderId: ""` or `null` moves it to the root. Private boards are visible here because this is the owner surface.
- **Tasks.** A task is created on the active board in the path. The board must belong to the caller and must not be archived. `status` defaults to `backlog`; `priority` defaults to `""`. `noteId` links a note without modifying it; `""` clears the link. `boardId`, `status`, and `boardOrder` move a task. Task deletion is permanent.
- **Add note to board.** `POST /boards/:id/notes` copies the note title, a plain-text excerpt (up to 4,000 characters), up to six labels, and the `document` relation into a new task. The note is unchanged.

#### Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid request body or an invalid field value. |
| `401` | Missing, invalid, or expired user token. |
| `404` | Unknown route, or a record the caller cannot see. Another user's record and a missing record look identical. |
| `409` | The action conflicts with state: deleting an active board, or writing a task on an archived board. |
| `422` | Elysia schema validation failed. |
| `500` | Unexpected server failure; the body is generic. |
| `502` | PocketBase was unreachable or returned an unreadable response. |

#### Browser facade

The browser facade is the replacement for `/pb`. It is public-facing Elysia code with PocketBase-shaped payloads; PocketBase itself is loopback-only.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/check-users` | public | `{ hasUsers, totalUsers }` for onboarding vs sign-in. |
| `GET` | `/api/v1/auth/methods` | public | Password/OAuth provider discovery. |
| `POST` | `/api/v1/auth/login` | public | `{ identity, password }` → `{ token, record }`. |
| `POST` | `/api/v1/auth/refresh` | user | Refresh the session and return a new token. |
| `POST` | `/api/v1/auth/logout` | user | `204`; the client clears its local auth store. |
| `POST` | `/api/v1/auth/password-reset/request` | public | Request a reset email. |
| `POST` | `/api/v1/auth/password-reset/confirm` | public | Confirm with token and new password. |
| `POST` | `/api/v1/auth/email-change/request` | user | Request an email change. |
| `POST` | `/api/v1/auth/email-change/confirm` | public | Confirm with token and password. |
| `POST` | `/api/v1/auth/oauth2` | public | Exchange an OAuth2 code. |
| `GET` | `/api/v1/auth/oauth2/callback` | public | Popup callback page; posts the provider query back to the opener. Configure providers to allow `<origin>/api/v1/auth/oauth2/callback`. |
| `GET` | `/api/v1/me` | user | The caller's own user record. |
| `GET` | `/api/v1/records/:collection` | user | Allowlisted PocketBase list with `filter`, `sort`, `expand`, `fields`, `page`, `perPage`, `skipTotal`. |
| `POST` | `/api/v1/records/:collection` | user¹ | Create a record with an allowlisted body. |
| `GET` | `/api/v1/records/:collection/:id` | user | Read one record. |
| `PATCH` | `/api/v1/records/:collection/:id` | user | Partial update; ownership cannot be changed. |
| `DELETE` | `/api/v1/records/:collection/:id` | user | Delete through PocketBase rules. |
| `POST` | `/api/v1/files/token` | user | Short-lived protected-file token. |
| `GET` | `/api/v1/files/:collection/:recordId/:filename` | token/query | Protected file or thumbnail; supports `?token=`, `?thumb=`, `?download=`. |
| `GET` | `/api/v1/realtime` | public handshake | SSE stream; PocketBase sends `PB_CONNECT`. |
| `POST` | `/api/v1/realtime` | user | `{ clientId, subscriptions }`; authenticated subscription POST. |
| `POST` | `/api/v1/trash/:action` | user | `move-document`, `restore-document`, `permanent-delete-document`, `move-folder`, `restore-folder`, `permanent-delete-folder`. |
| `GET/PATCH` | `/api/v1/admin/smtp` | admin | SMTP settings; password is never returned. |
| `POST` | `/api/v1/admin/smtp/test`, `/api/v1/admin/smtp/send-password` | admin | Test mail / send a password email. |
| `GET/PATCH` | `/api/v1/admin/attachments` | admin | Attachment limits. |
| `GET/PATCH` | `/api/v1/admin/oauth/providers` | admin | OAuth provider config with masked secrets. |
| `PATCH` | `/api/v1/admin/app-url` | admin | Sync PocketBase `meta.appURL`. |
| `PATCH` | `/api/v1/admin/users/:id` | admin | Update email/name/admin/password. |
| `POST` | `/api/v1/admin/users/:id/request-email-change` | admin | Send an admin-initiated email change. |
| `GET` | `/api/v1/public/documents/:token` | public | Public document payload. |
| `GET` | `/api/v1/public/documents/:token/files/:filename` | public | Public attachment. |
| `GET` | `/api/v1/public/folders/:token` | public | Public folder tree and documents. |
| `GET` | `/api/v1/public/folders/:token/files/:documentId/:filename` | public | Public folder attachment. |
| `GET` | `/api/v1/public/boards/:token` | public | Public board and tasks. |

¹ `POST /records/users` is public for first-user onboarding; PocketBase locks public signup after the first account.

Allowed record collections:

| Collection | Read | Write | Notes |
| --- | --- | --- | --- |
| `documents` | yes | yes | `content` is sanitized by Elysia; `author` is injected; `folder` must be owned. |
| `folders` | yes | yes | `parent` must be owned; cycles/self-parent are rejected. |
| `boards` | yes | yes | `folder` must be owned; archive-before-delete stays in PocketBase. |
| `tasks` | yes | yes | `board` must be owned and active; `document` must be owned. |
| `document_versions` | yes | no | Read-only through the facade. |
| `trash_documents`, `trash_folders` | yes | no | Mutations only through `/trash/:action`. |
| `users` | yes | self/admin | Self updates exclude `admin`/`verified`; admin routes use the custom admin endpoints. |
| `settings` | admin | admin | `site_url`, `ai_config`, `rate_limits`. |

Browser facade behavior:

- **Author injection.** `author` from the browser is ignored on create and removed on update. The caller's JWT id is used, and PocketBase independently checks ownership.
- **Relation checks.** Folder parents, board folders, task boards, and task note links are checked against the caller before the upstream write. Unknown or foreign records return `404`.
- **Sanitization.** Document `content` is sanitized on create and update inside Elysia. Uploaded attachments are still protected by PocketBase file rules.
- **Read-only collections.** Version and trash collections accept only reads; writes return `405`.
- **Query pass-through.** Reads forward PocketBase `filter`, `sort`, `expand`, `fields`, `page`, `perPage`, and `skipTotal`. This preserves the SPA's raw PB queries without exposing arbitrary system collections.
- **Error shape.** The facade preserves PocketBase's `{ code, message, data }` error envelope and status codes so the client's field-error and auth handling stays intact.
- **Files.** Only `documents`, `users`, and `trash_documents` file paths are allowlisted. Protected files still require a PocketBase file token or a public-share route.
- **Realtime.** The SSE handshake is unauthenticated, like PocketBase; the subscription POST requires the user token. Elysia sets the Bun timeout to `0` for `/api/v1/realtime`.

### MCP

`POST /mcp` is a stateless Streamable HTTP MCP endpoint. It uses the same user-token authentication as `/api/v1`; auth runs before any MCP work.

| Behavior | Contract |
| --- | --- |
| Methods | `POST` only. Other methods return `405` with `Allow: POST`. |
| Session | Stateless. A fresh `McpServer` and transport are created per request; responses are JSON, not SSE. |
| Bad JSON | JSON-RPC parse error `-32700` with HTTP `400`. |
| Transport failure | JSON-RPC internal error `-32603` with HTTP `500`. |
| Tool failure | A workspace failure returns HTTP success containing an MCP `isError` text result with `{ "error": { "code", "message" } }`. |
| Auth failure | Plain JSON `{ "error": "..." }` with `401`. |
| Rate limit | The Bun app limiter applies before the MCP handler. |
| CORS | None. The endpoint is same-origin, like the rest of the app. |

The server registers tools for folders, notes, boards, and tasks; the table below is the contract. Read tools reuse the chat executors, including their bounds, author checks, and private lock. Write tools call the shared workspace services with `surface: "ai"`.

| Family | Tools | Behavior |
| --- | --- | --- |
| Folders | `list_folders`, `create_folder` | List visible folders; create a folder under a visible parent. |
| Notes | `list_notes`, `read_note`, `create_note`, `update_note`, `move_note`, `delete_note` | Metadata/list and bounded body reads; create, update, move, or trash a note. `delete_note` returns `{ deleted, trashDocumentId }`. |
| Boards | `list_boards`, `read_board`, `create_board`, `update_board`, `move_board`, `archive_board`, `restore_board`, `delete_board` | List with task counts; read a non-archived board; create/update/move; archive/restore; permanently delete an archived board. |
| Tasks | `list_tasks`, `create_task`, `update_task`, `move_task`, `delete_task`, `add_note_to_board` | List, create, update, move, or permanently delete tasks; copy a note onto a board. |

MCP is an AI surface, so private notes, boards, folders, and private-folder subtrees are omitted from lists and look missing by id. A tool that tries to write to a hidden record returns `not_found`. See [`ai.md`](ai.md) for the privacy rules and tool semantics.

### Bun application routes

#### `GET /api/app/version`

Public. Returns the package version, the latest GitHub release (or tag fallback), whether an update exists, and the releases URL:

```json
{
  "currentVersion": "<package.json version>",
  "latestVersion": "<latest release or null>",
  "updateAvailable": false,
  "releasesUrl": "https://github.com/zbejas/nana/releases"
}
```

Only `GET` is allowed. The lookup is cached for 15 minutes.

#### `POST /api/export`

Requires auth. Request:

```json
{
  "documentIds": ["id"],
  "folderIds": ["id"],
  "zipName": "optional-name"
}
```

At least one document or folder is required. A single document with no attachments returns `text/markdown`; everything else returns a ZIP containing Markdown and attachments. Folder exports include descendants. See `src/api/export/`.

#### `POST /api/chat/send`

Requires auth. Request:

```json
{
  "conversationId": "optional-existing-id",
  "message": "user text",
  "regenerate": false
}
```

- Omit `conversationId` to create a conversation. The first message seeds the title; a background title call refines it after the first reply.
- `regenerate: true` trims the previous user/assistant exchange before re-sending.
- There is no `documentIds` field and no attachment payload. Chat reads notes and boards only through tools.
- Only message role and content are sent to the model; stored reasoning, tool activity, and model metadata stay out of the prompt.
- Chat remains read-only. `/mcp` is the separate write-capable AI surface.

The response is an SSE stream from `toUIMessageStreamResponse()` with these headers:

| Header | Meaning |
| --- | --- |
| `X-Conversation-Id` | Conversation to continue. |
| `X-Is-New-Conversation` | `"true"` when a new conversation was created. |
| `X-Model-Name` | Active model name. |

There is no `X-RAG-Sources` header. Sources, embeddings, and retrieval metadata are not part of the chat contract.

`onFinish` persists the assistant message with `content`, optional `reasoning`, optional `tools`, and `model`. Persisted tool activity is only `{ name, status }` with `status` `success` or `error`; names are restricted to `CHAT_TOOL_NAMES`. See [`ai.md`](ai.md) for the tool contracts, bounds, and prompt-injection stance.

Chat errors:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON or empty `message`. |
| `401` | Missing or invalid user token. |
| `502` | The provider failed before or during the stream; the message is mapped by `getAIErrorMessage()`. |
| `503` | `ai_config` is missing, no provider is active, or the provider has no model. |

#### Chat conversations

| Route | Method | Response |
| --- | --- | --- |
| `/api/chat/conversations` | GET | The current user's conversations, newest first. |
| `/api/chat/conversations/:id` | GET | `{ conversation, messages }`. |
| `/api/chat/conversations/:id` | DELETE | `204` on success. |

Conversation list/view/delete are author-scoped by PocketBase rules. Bun creates a conversation with the author derived from the token, and every route forwards the caller's token. Unknown conversations and another user's conversation both return `404`. Responses include the stored message objects, including any legacy fields tolerated on read.

#### Admin

`POST /api/admin/rate-limits/reload` requires auth and reloads `settings.rate_limits` into the in-memory limiter. It returns `{ success: true, config }`. It is guarded by `verifyAuth()` only, not an admin-role check.

#### API, docs, and assets

| Route | Method | Behavior |
| --- | --- | --- |
| `/pb`, `/pb/*` | any | `404`. The public PocketBase proxy was removed. |
| `/api/v1/*` | any | Elysia typed workspace API and browser facade. Authenticated per route. |
| `/api/v1/realtime` | GET | SSE relay; Bun timeout is disabled. |
| `/docs`, `/docs/json` | GET | Public Scalar API reference and OpenAPI document. |
| `/docs/scalar.js` | GET | Self-hosted Scalar standalone bundle. |
| `/docs/geist.woff2`, `/docs/geist-mono.woff2` | GET | Self-hosted Geist fonts for the reference. |
| `/mcp` | POST | Stateless MCP endpoint. |
| `/manifest.webmanifest` | GET | PWA manifest. |
| `/sw.js` | GET | Minimal service worker. |
| `/nana.svg`, `/nana-192.png`, `/nana-512.png` | GET | Icons. |
| `/pdfjs/pdf.worker.min.mjs` | GET | PDF.js worker from `node_modules`. |
| `/*` | GET | Production static files with SPA fallback, or the development HMR entry. |

### PocketBase routes (internal)

PocketBase listens only on `127.0.0.1:8090`. The paths below are shown as PocketBase sees them; the browser reaches the same behavior through `/api/v1/trash`, `/api/v1/admin`, `/api/v1/public`, and `/api/v1/records`.

#### Public

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/check-users` | GET | `{ hasUsers, totalUsers }`; drives onboarding vs sign-in. |
| `/api/public/documents/:shareToken` | GET | Public document payload. Validates `is_public`, `is_private`, and expiry. |
| `/api/public/documents/:shareToken/files/:filename` | GET | Document attachment when `share_attachments` is true. |
| `/api/public/folders/:shareToken` | GET | Folder tree plus descendant folders/documents. Private subtrees and private documents are skipped. |
| `/api/public/folders/:shareToken/files/:documentId/:filename` | GET | Attachment for a document in a shared folder. |
| `/api/public/boards/:shareToken` | GET | Board metadata plus tasks in board order. Archived, private, expired, and non-public boards return `404`. Linked task notes are omitted. |

#### Trash

All require a user token and ownership checks.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/trash/move-document` | `{ "documentId": "id" }` | `{ trashDocumentId }` |
| `POST /api/trash/restore-document` | `{ "trashDocumentId": "id" }` | `{ documentId, folderId }` |
| `POST /api/trash/permanent-delete-document` | `{ "trashDocumentId": "id" }` | Deletes the trash record and its versions. |
| `POST /api/trash/move-folder` | `{ "folderId": "id" }` | `{ trashFolderId, movedDocumentIds, movedBoardIds }`; boards in the trashed subtree are rehomed to the root. |
| `POST /api/trash/restore-folder` | `{ "trashFolderId": "id" }` | Restores the folder subtree and documents. Boards rehomed to the root are not moved back. |
| `POST /api/trash/permanent-delete-folder` | `{ "trashFolderId": "id" }` | Permanently deletes the folder subtree and defensively rehomes any board still pointing at it. |

#### Admin

All require a user token with `admin = true`.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/admin/users/:id` | PATCH | Update name/email/admin/password without an old-password check. |
| `/api/admin/users/:id/request-email-change` | POST | Send an email-change confirmation to a new address. |
| `/api/admin/smtp` | GET, PATCH | Read/update SMTP settings. |
| `/api/admin/smtp/test` | POST | Send a test email. |
| `/api/admin/smtp/send-password` | POST | Send a password email. |
| `/api/admin/attachments` | GET, PATCH | Attachment limits and allowed MIME types. |
| `/api/admin/oauth/providers` | GET, PATCH | OAuth provider configuration. |
| `/api/admin/app-url` | PATCH | Sync PocketBase `meta.appURL` for OAuth redirects. |

### Collection routes

PocketBase's standard collection endpoints under `/api/collections/...` are internal. The browser reaches the allowlisted subset through `/api/v1/records/...`; the rest (system collections, schema, logs, backups, superusers) is not exposed.

| Collection | Browser path | Access |
| --- | --- | --- |
| `users` | `/api/v1/records/users` / `/api/v1/auth/*` | Auth, registration, password reset, email change, OAuth, self profile/avatar. |
| `folders`, `documents`, `boards`, `tasks` | `/api/v1/records/<collection>` | Author-scoped CRUD with injected ownership and relation checks. |
| `document_versions` | `/api/v1/records/document_versions` | Read-only. |
| `settings` | `/api/v1/records/settings` | Admin-only key/value store. |
| `trash_documents`, `trash_folders` | `/api/v1/records/trash_*` | Readable but not writable; mutations go through `/api/v1/trash/:action`. |
| `conversations` | none | Server-side chat only; `/api/chat/conversations`. |

#### Board records

```json
{
  "name": "Release",
  "description": "Ship the next version",
  "archived": false,
  "folder": "optional_folder_id",
  "is_private": false,
  "is_public": false,
  "public_share_token": "",
  "public_expires_at": "",
  "author": "user_record_id"
}
```

- `name` is required (max 120); `description` is optional (max 500).
- `archived` defaults to false. Archiving is a normal `PATCH`; there is no separate archive route. An archived board’s public link stops serving.
- `folder` is optional. It must belong to the caller; `board_guards.js` checks the incoming relation. An empty value means the workspace root.
- `is_private` hides the board from chat and MCP, not from its owner. A private board cannot be served publicly.
- `is_public`, `public_share_token`, and `public_expires_at` are the board public-share fields; the browser generates the token and the public route validates it.
- `author` is required and set on create. Ownership cannot be changed later.
- A board may only be deleted while `archived = true`; that delete cascades its tasks.
- List and view are author-scoped. Use `filter=archived=false` for active boards and `filter=archived=true` for the archive.

#### Task records

```json
{
  "title": "Draft release notes",
  "description": "Markdown body",
  "status": "backlog | next | progress | done",
  "priority": "low | medium | high | urgent | \"\"",
  "due_date": "2026-10-30 00:00:00.000Z",
  "board_order": 0,
  "labels": ["release"],
  "author": "user_record_id",
  "board": "board_record_id",
  "document": "optional_document_id"
}
```

- `board` is required. A task cannot be created without a board, on another user's board, or on an archived board.
- `status` is required and limited to the four column values. `priority` is optional; the UI sends `""` when unset.
- `board_order` is a non-negative number scoped to a column. Dragging writes only changed rows.
- `document` is optional and does not cascade. Deleting the note leaves the task; deleting the task leaves the note.
- List, view, and delete are author-scoped. Create and update additionally require `board.author = @request.auth.id` and `board.archived = false`.
- Tasks have no trash flow. Deleting a task is permanent.

See [`pocketbase.md`](pocketbase.md) for the exact rules, indexes, and archive lifecycle.

### Public share payloads

Document response:

```json
{
  "type": "document",
  "shareToken": "…",
  "expiresAt": "2026-01-01 00:00:00.000Z",
  "shareAttachments": true,
  "author": { "id": "…", "name": "…" },
  "document": { "id": "…", "title": "…", "content": "…", "attachments": [], "tags": [] }
}
```

Board response:

```json
{
  "type": "board",
  "shareToken": "…",
  "expiresAt": null,
  "author": { "id": "…", "name": "…" },
  "board": { "id": "…", "name": "…", "description": "…", "folder": "" },
  "tasks": [
    {
      "id": "…",
      "title": "…",
      "description": "…",
      "status": "backlog",
      "priority": "",
      "due_date": null,
      "board_order": 0,
      "labels": []
    }
  ]
}
```

Folder response includes `rootFolder`, `folders`, `documents`, and `entryDocumentId`. Board tasks do not include `author`, `board`, or the linked `document`; the linked note keeps its own privacy and share state. Expired shares are disabled on read and swept by a 15-minute cron.

## Gotchas & invariants

- **`/api/v1` has two contracts.** The typed workspace routes return camelCase DTOs and `{ error }` failures; the browser facade returns PocketBase-shaped records and `{ code, message, data }` failures. Do not mix their paths or schemas.
- **The browser never calls PocketBase.** `src/lib/pocketbase.ts` is a small client over `/api/v1`; `/pb` returns `404`. Server-side code uses `serverConfig.pocketbaseUrl` on loopback.
- **Legacy file links are rewritten.** Existing Markdown may contain `/pb/api/files/...`; `src/lib/legacy-urls.ts` rewrites those to `/api/v1/files/...` in Markdown previews and public views. There is no compatibility `/pb` route.
- **The browser facade is an allowlist, not a proxy.** Do not add system collections, schema, logs, backups, or superuser paths to `/api/v1/records`. New collections need an explicit entry in `src/api/rest/browser/records.ts`.
- **Ownership is server-injected.** Browser `author` values are ignored on create and removed on update. Folder parents, board folders, task boards, and note links are checked before the upstream write.
- **Document content is sanitized at the edge.** The facade calls `sanitizeHtml()` on create/update; PocketBase is still the storage and rules engine.
- **Private records are visible to their owner.** `/api/v1` is the owner surface. Only chat and MCP apply the private lock; do not add `aiVisibilityConditions()` to REST or browser facade handlers.
- **`/docs` is public.** The OpenAPI document and Scalar assets are intentionally unauthenticated; `/api/v1` routes are not.
- **MCP is POST-only and stateless.** There is no session to continue. Every request authenticates, builds a server, handles one payload, and closes the transport.
- **MCP tool failures are model-facing, not HTTP failures.** An `isError` text result still returns `200`; only auth, parse, and transport failures return HTTP errors.
- **Chat has no `documentIds`.** A request containing extra fields is ignored; only `conversationId`, `message`, and `regenerate` are read.
- **No RAG headers or sources.** Clients must not expect `X-RAG-Sources` or a `sources` field in new assistant messages.
- **Chat tool errors are model-facing, not HTTP errors.** `list_notes` etc. return `{ ok: false, code, message }` inside the stream; the chat `POST` still succeeds.
- **Persisted chat tool activity is allowlisted.** Only `CHAT_TOOL_NAMES` entries and `success`/`error` statuses survive `sanitizeTools()`; args and outputs are never stored. MCP tool activity is not persisted in conversations.
- **Deleting an active board fails.** Archive it first, then delete from `/board/archive` or `DELETE /api/v1/boards/:id`.
- **Task deletion still works on an archived board.** The archived-board rule blocks create/update, not delete; this is intentional so cleanup stays possible.
- **A `403` and a `404` can look identical through the services.** PocketBase hides unauthorized records; the shared client maps both to a generic `not_found`.
- **Cross-author folders are rejected twice.** The workspace service checks folder ownership before the write; `board_guards.js` checks the incoming relation again for direct API calls.
- **A trashed folder does not trash its boards.** Boards are rehomed to the root and keep their tasks and archive state.
- **Rate limits apply before handlers.** `/api/*`, `/api/v1`, `/docs`, and `/mcp` all pass through `checkRateLimit()`; a `429` includes `Retry-After`. The `/api/v1` bucket is still stored under the legacy `pbMaxPerMinute` settings key.

## Related docs

- [`architecture.md`](architecture.md) — topology, request flow, and data flows.
- [`ai.md`](ai.md) — chat tools, MCP, privacy lock, providers, and failures.
- [`pocketbase.md`](pocketbase.md) — collection rules, migrations, and settings.
- [`security.md`](security.md) — auth layers, MCP authorization, browser facade safety, and CSP.
- [`frontend.md`](frontend.md) — routes and client calls that consume these endpoints.
