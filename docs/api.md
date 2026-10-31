# API — Elysia, MCP, and internal PocketBase

## Overview

Nana exposes four HTTP surfaces through one Bun origin:

- **Bun application API** — `/api/chat`, `/api/export`, `/api/app/version`, and `/api/admin`.
- **Elysia `/api/v1`** — the owner workspace API (folders, notes, boards, tasks), the browser facade (auth, records, files, realtime, trash, admin, public shares), and public OpenAPI docs at `/docs` and `/docs/json`.
- **MCP** — `POST /mcp`, a stateless Streamable HTTP endpoint for AI clients.
- **PocketBase** — an internal data/auth/hook engine on `127.0.0.1:8090`. It is not a public surface.

The browser uses the small client in `src/lib/pocketbase.ts`, which talks only to `/api/v1`. The compatibility-shaped browser facade in `src/api/rest/browser/` keeps PocketBase's record and error shapes so the SPA did not need a screen-by-screen rewrite. `/pb` is gone: `GET /pb` and `/pb/*` return `404`.

`/api/v1` and `/mcp` accept a PocketBase user token or a long-lived Nana API key, raw or as a Bearer token:

```http
Authorization: <pocketbase-auth-token>
Authorization: Bearer <nana_api_key>
```

`verifyAuth()` validates session tokens for the application API. `authenticateApiRequest()` validates the typed workspace API and `/mcp`: a PocketBase token is refreshed through `auth-refresh`; a `nana_…` key is hashed and matched against `api_keys`, then exchanged server-side for a normal user token through PocketBase impersonation. Either form yields the same author-scoped `ToolContext`, and the refreshed or minted token is used for downstream calls. The browser facade decodes the JWT for the caller id, then lets PocketBase verify the token on every upstream call. API keys are not accepted by the browser facade. PocketBase collection rules, guards, hooks, cascades, trash logic, and file protection stay in force.

## Key files

| File | Role |
| --- | --- |
| `src/index.ts` | Bun route table, Elysia mount, MCP mount, rate-limit checks, security headers, and the 404 guard for the old `/pb` path. |
| `src/api/rest/index.ts` | Elysia typed workspace routes, REST error mapping, browser facade mount, and self-hosted Scalar assets. |
| `src/api/rest/browser/` | Browser facade: auth, allowlisted records, files, realtime relay, trash, admin, public shares, version history. |
| `src/api/rest/browser/records.ts` | Collection allowlist, author injection, relation ownership checks, document sanitization, and PB-shaped errors. |
| `src/api/rest/browser/versions.ts` | Session-authenticated, owner-only version history, detail, save, and restore routes. |
| `src/api/versioning/` | Server-side git store, per-note lock, PocketBase document reader/patcher, and version service used by the browser routes. |
| `src/api/rest/browser/realtime.ts` | SSE relay for `/api/v1/realtime` plus authenticated subscription POSTs. |
| `src/api/rest/openapi.ts` | OpenAPI document metadata, Scalar configuration, Graphite docs theme, and shared docs paths. |
| `src/api/rest/responses.ts` | Shared error response schemas used by runtime validation and the OpenAPI document. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()`; raw/Bearer token handling, `auth-refresh`, and API key exchange for typed workspace routes and MCP. |
| `src/api/api-keys/` | Key token format/hash, superuser-only lookup, user-token impersonation, and owner key management. |
| `src/api/rest/schemas.ts` | TypeBox request, query, params, and response schemas. |
| `src/api/mcp/index.ts` | MCP server construction, folder/note/board/task tool registrations, stateless transport, JSON-RPC errors. |
| `src/api/workspace/` | Shared folder, note, board, and task services used by the typed workspace API and MCP. |
| `src/api/workspace/privacy.ts` | `loadAiVisibility()`, `aiVisibilityConditions()`, and the record lock helpers. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase REST client and status mapping. |
| `src/api/auth.ts` | `verifyAuth()` and `AuthError`. |
| `src/api/chat/index.ts` | Chat request parsing, mode/context/attachment validation, SSE response, conversation dispatch. |
| `src/api/chat/context.ts` | Server-side document/board/folder context resolution with ownership, trash, and private-lock checks; the prompt note carries only the id. |
| `src/api/chat/attachments.ts` | Multipart validation, magic-byte MIME/kind checks, PDF text extraction, draft binding/deletion, and protected-file downloads. |
| `src/api/chat/stream.ts` | Named SSE events, legacy AI-SDK chunks, final-step usage mapping, and stream accumulation. |
| `src/api/chat/edits.ts` | `chat_edits` recording, edit-card listing, and undo. |
| `src/api/chat/tool-names.ts` | Persisted read/write chat tool allowlists. |
| `src/api/chat/tools/` | Read tools plus Work-mode create, rename, move, trash/restore, and confirm-first delete tools for folders, notes, boards, and tasks. |
| `src/api/export/` | Markdown and ZIP export. |
| `src/api/app-version.ts` | Cached GitHub Releases lookup. |
| `src/lib/pocketbase.ts` | Browser client over `/api/v1`; preserves the small `pb.collection` / `pb.authStore` / `pb.files` surface the SPA uses. |
| `src/lib/boards/` | Browser-side board CRUD, folder/privacy/public-share fields, and summaries over `/api/v1/records`. |
| `src/lib/tasks/` | Browser-side task CRUD, ordering, and note import over `/api/v1/records`. |
| `pocketbase/pb_hooks/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users. |
| `pocketbase/pb_hooks/guards/relation_guards.js` | Incoming folder, parent, board, and note ownership on API create/update. |
| `pocketbase/pb_migrations/` | Collection schema and API rules. |

## How it works

### Conventions

| Topic | Convention |
| --- | --- |
| Typed workspace API | `/api/v1/folders`, `/notes`, `/boards`, `/tasks`: JSON with camelCase fields and `{ "error": "message" }` failures. |
| Browser facade | `/api/v1/records`, `/auth`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`: PocketBase-shaped records (snake_case fields) and `{ code, message, data }` failures. |
| `/api/v1` auth | Raw user token or API key, or `Authorization: Bearer <token>`; invalid, expired, or revoked credentials return `401`. Read-only keys return `403` on writes. |
| Typed validation | Path/query/body schemas return `422`; malformed JSON returns `400`. |
| Browser facade validation | The facade rejects unknown collections, cross-user relations, author spoofing, and unsafe writes with `400`/`404`; PocketBase field errors pass through. |
| MCP | JSON-RPC over Streamable HTTP; tool failures are `isError` results, not HTTP failures. |
| Application API errors | Bun handlers return `{ "error": "message" }`; PocketBase returns its standard error envelope. |
| Auth failure | Missing or invalid user token (`401`); authenticated non-admin on an admin route (`403`). |
| Rate limit | `429` with `Retry-After` when `settings.rate_limits.enabled` is true. `/api/v1` uses the API bucket (`pbMaxPerMinute`); everything else uses the app bucket (`appMaxPerMinute`). |
| SSE | `/api/chat/send` and `/api/v1/realtime` disable the Bun request timeout. Chat emits named events and, for mode-less requests, legacy AI-SDK UI chunks; realtime relays PocketBase SSE. |
| Browser URLs | Always same-origin `/api/v1`, never `:8090`. |

### Elysia `/api/v1`

`/api/v1` is the **owner surface**. It has three layers:

1. **Typed workspace API** — `/folders`, `/notes`, `/boards`, `/tasks`. These use the workspace services with `surface: "user"`, so the owner sees their private notes, boards, folders, and private-folder contents. The AI visibility lock applies only to chat and MCP.
2. **Browser facade** — `/auth`, `/records`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`, `/check-users`, `/me`, and `/documents/:id/versions`. These keep the PocketBase record/error shape the SPA already understands while Elysia owns the public edge.
3. **Admin settings** — `/admin/rate-limits`. This Bun-native route requires the admin flag, persists `settings.rate_limits` with the server's superuser token, and reloads the in-memory limiter in the same request. It is hidden from the public OpenAPI document.

The workspace and facade layers do not replace PocketBase. They call the loopback PocketBase REST API with the caller's own token; PocketBase still enforces API rules, guards, hooks, relation cascades, soft-delete trash routes, and file protection. The browser facade adds the missing public-edge checks: collection allowlisting, author injection, relation ownership, and note sanitization.

#### Authentication and docs

Typed workspace routes and MCP call `authenticateApiRequest()` before the handler:

1. Extract the raw token or the value after `Bearer`.
2. For a `nana_…` key, SHA-256 hash it, read the matching `api_keys` record with the server's superuser token, and mint a normal user token through PocketBase impersonation. The key's `access` and `scope` travel in the `ToolContext`; the superuser token never does.
3. Otherwise POST the token to PocketBase `auth-refresh` (8-second timeout) and use the returned record id as the author and the refreshed token for downstream PocketBase calls.
4. Return `401 { "error": "..." }` when the header is missing, the token or key is invalid/revoked, or PocketBase cannot verify it.

Browser facade routes decode the JWT locally for the caller id and expiry, then send the unchanged token upstream. PocketBase rejects a forged or revoked token, so no write or read succeeds without its authorization. Auth, public-share, and file-token routes are the deliberate exceptions to "decode first"; they proxy PocketBase's public/auth endpoints directly. API keys are not JWTs and are rejected by the browser facade.

`GET /docs` serves a Scalar API reference and `GET /docs/json` serves the OpenAPI document. Both are **public**; `/api/v1` itself is not. The Scalar bundle is served from `@scalar/api-reference` at `/docs/scalar.js`; the docs use the app's self-hosted Geist fonts at `/docs/geist.woff2` and `/docs/geist-mono.woff2`. No CDN or external font origin is needed, so the CSP stays `script-src 'self'` and `font-src 'self' data:` (the production bundle inlines the app fonts as data URIs).

The spec uses `APP_VERSION`, a single `Workspace` tag group for Folders/Notes/Boards/Tasks, stable operation ids, per-status error responses, request/response examples, and a `bearerAuth` HTTP security scheme. Scalar's own theme is disabled in favour of Graphite CSS variables so the reference reads like the rest of Nana.

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
| `POST` | `/api/v1/boards` | `{ name, description?, folderId?, icon?, isPrivate? }` | `201` board DTO. |
| `GET` | `/api/v1/boards/:id` | — | `200` board DTO including ordered `columns`. |
| `PATCH` | `/api/v1/boards/:id` | `{ name?, description?, icon?, archived?, folderId?, isPrivate? }` | `200` board DTO. |
| `DELETE` | `/api/v1/boards/:id` | — | `204`; moves the board and its tasks to trash. |
| `GET` | `/api/v1/boards/:id/columns` | — | `200` ordered workflow columns. |
| `POST` | `/api/v1/boards/:id/columns` | `{ name, slug?, position?, icon?, color?, isFinal? }` | `201` column DTO. |
| `POST` | `/api/v1/boards/:id/columns/reorder` | `{ orderedIds }` | `200` ordered columns. |
| `PATCH` | `/api/v1/board-columns/:id` | `{ name?, position?, icon?, color?, isFinal? }` | `200` column DTO. |
| `DELETE` | `/api/v1/board-columns/:id` | — | `204`; blocked while tasks reference the column. |
| `GET` | `/api/v1/boards/:id/tasks` | `status`, `page`, `perPage` | `200` paged task DTOs, ordered by `board_order`, then `created`. |
| `POST` | `/api/v1/boards/:id/tasks` | `{ title, description?, status?, priority?, assignee?, startDate?, dueDate?, recurrence?, boardOrder?, labels?, noteId? }` | `201` task DTO. |
| `POST` | `/api/v1/boards/:id/notes` | `{ noteId, status? }` | `201` task DTO copied from the note. |
| `GET` | `/api/v1/tasks/:id` | — | `200` task DTO. |
| `PATCH` | `/api/v1/tasks/:id` | `{ title?, description?, status?, priority?, assignee?, startDate?, dueDate?, recurrence?, boardOrder?, labels?, noteId? }` | `200` task DTO; a task never changes board. |
| `DELETE` | `/api/v1/tasks/:id` | — | `204`; permanent. |
| `GET/POST` | `/api/v1/tasks/:id/relations` | `{ targetId, type }` | `200` relations or `201` relation. |
| `DELETE` | `/api/v1/task-relations/:id` | — | `204`. |
| `GET` | `/api/v1/tasks/:id/activity` | — | `200` activity rows with actor type/label. |
| `GET` | `/api/v1/api-keys` | — | `200` array of key metadata; session token only. |
| `POST` | `/api/v1/api-keys` | `{ name, access, scope, folderIds? }` | `201 { token, apiKey }`; plaintext shown once. Session token only. |
| `DELETE` | `/api/v1/api-keys/:id` | — | `204`; revokes immediately. Session token only. |

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
| Note summary | `id`, `title`, `tags`, `folderId`, `isPrivate`, `isPublic`, `wordCount`, `readingTime`, `created`, `updated`. |
| Note | Summary plus `slug` and `content`. |
| Board | `id`, `name`, `description`, `archived`, `folderId`, `isPrivate`, `created`, `updated`. |
| Task | `id`, `title`, `description`, `status`, `priority`, `dueDate`, `boardOrder`, `labels`, `noteId`, `boardId`, `created`, `updated`. |

`folderId`, `noteId`, `dueDate`, and `parentId` are `null` when unset. `priority` is `""` when unset.

#### Request notes

- **Notes.** Titles default to `Untitled`; slugs are generated from the title. `content` is sanitized before storage. List results never include bodies, and `query` searches titles and tags only. Send `folderId: ""` or `null` to move a note to the root. Attachments are not managed by this API.
- **Folders.** A parent must belong to the caller. There is no folder update or delete route on `/api/v1`; the UI still uses the PocketBase collection and trash routes.
- **Boards.** Active boards are returned by default; `includeArchived=true` adds trashed boards. `archived: true` moves a board to trash; `archived: false` restores it. `DELETE` also moves a board to trash. Permanent delete uses `/api/v1/trash/permanent-delete-board` and cascades tasks and columns. `folderId: ""` or `null` moves it to the root. Private boards are visible here because this is the owner surface.
- **Tasks.** A task is created on the active board in the path. The board must belong to the caller and must not be in trash. `status` defaults to `backlog`; `priority` defaults to `""`. `noteId` links a note without modifying it; `""` clears the link. `boardId`, `status`, and `boardOrder` move a task. Task deletion is permanent.
- **Add note to board.** `POST /boards/:id/notes` copies the note title, a plain-text excerpt (up to 4,000 characters), up to six labels, and the `document` relation into a new task. The note is unchanged.

#### API keys

Long-lived keys authenticate the typed workspace API and `/mcp`. They are created and revoked only with a signed-in session; a key cannot manage keys. The plaintext is returned once and only a SHA-256 hash is stored.

```json
{
  "name": "Claude Desktop",
  "access": "read",
  "scope": "folders",
  "folderIds": ["folder123"]
}
```

The response includes the one-time secret and the metadata:

```json
{
  "token": "nana_a1b2c3d4e5f6…",
  "apiKey": {
    "id": "key123",
    "name": "Claude Desktop",
    "prefix": "nana_a1b2c3d4e5",
    "access": "read",
    "scope": "folders",
    "folders": [{ "id": "folder123", "name": "Product" }],
    "lastUsedAt": null,
    "createdAt": "2026-10-24 16:40:00.000Z"
  }
}
```

| Field | Values |
| --- | --- |
| `access` | `read` allows workspace reads; `write` also allows create, update, move, trash/restore, and delete. |
| `scope` | `workspace` covers the root and every folder; `root` covers only records with no folder; `folders` covers the selected folders and their descendants. |
| `folderIds` | Required for `folders` (1–20 owned, non-trashed folders); ignored for other scopes. |

Scope is enforced by the same workspace services for REST and MCP:

- Lists exclude out-of-scope folders, notes, boards, and tasks; totals describe the visible set.
- Reads and writes by id outside the scope return `404`.
- A read-only key returns `403` on any mutation.
- A folder-scoped key cannot read or create root records and cannot move a record to the root.
- A root-only key cannot use folders at all, including `create_folder`.
- MCP still applies the private lock: private notes, boards, folders, and private-folder subtrees stay hidden even for a `workspace` key.
- `lastUsedAt` records successful authentication, at most once a minute.

Revoking a key deletes its record and invalidates the next request immediately. Keys are not accepted by the browser facade (`/records`, `/auth`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`), chat, export, or admin routes.

#### Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid request body or an invalid field value. |
| `401` | Missing, invalid, expired, or revoked user token or API key. |
| `403` | The credential is valid but cannot perform this action, such as a read-only key attempting a write. |
| `404` | Unknown route, or a record the caller cannot see or is outside the key's scope. Another user's record and a missing record look identical. |
| `409` | The action conflicts with state: writing a task on a trashed board, a stale note revision, or undoing a chat edit after newer work. |
| `422` | Elysia schema validation failed. |
| `500` | Unexpected server failure; the body is generic. |
| `502` | PocketBase was unreachable or returned an unreadable response. |

#### Browser facade

The browser facade is the replacement for `/pb`. It is public-facing Elysia code with PocketBase-shaped payloads; PocketBase itself is loopback-only. It accepts only a PocketBase session JWT, never a `nana_…` API key.

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
| `POST` | `/api/v1/auth/oauth2` | public | Exchange an OAuth2 code with the provider's PKCE `codeVerifier` from `/auth/methods`. |
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
| `POST` | `/api/v1/trash/:action` | user | `move-document`, `restore-document`, `permanent-delete-document`, `move-folder`, `restore-folder`, `permanent-delete-folder`, `move-board`, `restore-board`, `permanent-delete-board`. |
| `GET/PATCH` | `/api/v1/admin/smtp` | admin | SMTP settings; password is never returned. |
| `POST` | `/api/v1/admin/smtp/test`, `/api/v1/admin/smtp/send-password` | admin | Test mail / send a password email. |
| `GET/PATCH` | `/api/v1/admin/attachments` | admin | Attachment limits. |
| `GET/PATCH` | `/api/v1/admin/oauth/providers` | admin | OAuth provider config with masked secrets. |
| `PATCH` | `/api/v1/admin/app-url` | admin | Sync PocketBase `meta.appURL`. |
| `GET/PATCH` | `/api/v1/admin/rate-limits` | admin | Per-IP request ceilings; `PATCH` persists and reloads the in-memory limiter. |
| `GET` | `/api/v1/admin/ai/models` | admin | Searchable models.dev catalog for the AI settings picker; optional `q` and `provider`. |
| `PATCH` | `/api/v1/admin/users/:id` | admin | Update email/name/admin/password. |
| `POST` | `/api/v1/admin/users/:id/request-email-change` | admin | Send an admin-initiated email change. |
| `GET` | `/api/v1/public/documents/:token` | public | Public document payload. |
| `GET` | `/api/v1/public/documents/:token/files/:filename` | public | Public attachment. |
| `GET` | `/api/v1/public/folders/:token` | public | Public folder tree, documents, and boards. |
| `GET` | `/api/v1/public/folders/:token/files/:documentId/:filename` | public | Public folder attachment. |
| `GET` | `/api/v1/public/boards/:token` | public | Public board columns and tasks. |
| `GET` | `/api/v1/sharing/users` | user | Name/avatar directory; email only for an exact address. |
| `GET` | `/api/v1/sharing/shared` | user | Direct and inherited records shared with the caller, bounded and paged. |
| `GET` | `/api/v1/sharing/access` | user | Effective `view`/`comment`/`edit`/`owner` access for a target. |
| `GET` | `/api/v1/sharing/folders/:id` | user | Shared folder contents. |
| `GET/POST` | `/api/v1/sharing/links` | owner | List or upsert a direct grant. |
| `DELETE` | `/api/v1/sharing/links/:id` | owner | Revoke a grant. |
| `GET/POST` | `/api/v1/sharing/comments` | user | List or create a document/board/task comment. |
| `PATCH/DELETE` | `/api/v1/sharing/comments/:id` | author/owner | Edit or delete a comment. |
| `GET` | `/api/v1/documents/:id/versions` | session owner | `200` page of `{ id, document, version_number, change_summary, source_created_at, created }`; query `page`, `perPage` (default 20, max 100); no content. |
| `GET` | `/api/v1/documents/:id/versions/:versionId` | session owner | `200` version fields plus `content` and optional `metadata`. |
| `POST` | `/api/v1/documents/:id/versions` | session owner | Body `{ expectedRevision }`; `200 { created, version }`. Commits the current note state; identical state returns `created: false`. |
| `POST` | `/api/v1/documents/:id/versions/:versionId/restore` | session owner | Body `{ expectedRevision }`; commits the current state if needed, then applies only the selected Markdown body; `200 { document }`. |

¹ `POST /records/users` is public for first-user onboarding; PocketBase locks public signup after the first account.

Allowed record collections:

| Collection | Read | Write | Notes |
| --- | --- | --- | --- |
| `documents` | yes | yes | `content` is sanitized by Elysia; `author` is injected; `folder` must be owned. |
| `folders` | yes | yes | `parent` must be owned; cycles/self-parent are rejected. |
| `boards` | yes | yes | `folder` must be owned; `DELETE` moves to trash; permanent delete uses `/trash/permanent-delete-board`. |
| `board_columns` | yes | yes | Owner-only writes; slugs are unique/reserved-safe. |
| `tasks` | yes | yes | `board` is create-only; status must match a board column or a virtual status; `document` must be owned. |
| `labels` | yes | yes | Author-scoped label definitions. |
| `task_relations` | yes | no | Writes go through typed REST; reads are symmetric. |
| `task_activity` | yes | no | Server writes only. |
| `trash_documents`, `trash_folders` | yes | no | Mutations only through `/trash/:action`. Trashed boards are read from `boards` with `archived=true`. |
| `users` | yes | self/admin | Self updates exclude `admin`/`verified`; admin routes use the custom admin endpoints. |
| `settings` | admin | admin | `site_url`, `ai_config`, and `rate_limits`. Use `/api/v1/admin/rate-limits` for rate-limit writes so the limiter reloads. |

Browser facade behavior:

- **Author injection.** `author` from the browser is ignored on create and removed on update. The caller's JWT id is used, and PocketBase independently checks ownership.
- **Relation checks.** Folder parents, board folders, task boards, and task note links are checked against the caller before the upstream write. Unknown or foreign records return `404`.
- **Sanitization.** Document `content` is sanitized on create and update inside Elysia. Uploaded attachments are still protected by PocketBase file rules.
- **Read-only collections.** Trash collections accept only reads; writes return `405`.
- **Query pass-through.** Reads forward PocketBase `filter`, `sort`, `expand`, `fields`, `page`, `perPage`, and `skipTotal`. This preserves the SPA's raw PB queries without exposing arbitrary system collections.
- **Error shape.** The facade preserves PocketBase's `{ code, message, data }` error envelope and status codes so the client's field-error and auth handling stays intact.
- **Files.** Only `documents`, `users`, `trash_documents`, and `chat_attachments` file paths are allowlisted. Protected files still require a PocketBase file token or a public-share route; chat attachment bytes are fetched server-side with the caller's short-lived file token.
- **Realtime.** The SSE handshake is unauthenticated, like PocketBase; the subscription POST requires the user token. Elysia sets the Bun timeout to `0` for `/api/v1/realtime`.

#### Version history

The four `/api/v1/documents/:id/versions` routes are browser-facade routes: they require a session token (no `nana_…` API keys), check that the caller owns the note, and hide trashed notes. Their responses use the PocketBase-shaped `{ code, message, data }` error envelope.

- `id` is an opaque version id (a commit id internally). Treat it as a string; do not parse or display it as a record id.
- List results are newest first and omit content. `page` defaults to 1, `perPage` defaults to 20 and is capped at 100. The response is `{ items, page, perPage, totalItems, totalPages }`.
- `POST` commits the current note title, content, tags, folder, and privacy. The commit is a no-op when the current state already matches HEAD, so `created: false` means **No changes since the last version**.
- `POST …/restore` commits the current state first when needed, then writes only the selected Markdown body. Title, tags, folder, and privacy are not restored. The response returns the updated PocketBase-shaped `document`.
- `expectedRevision` is required on both writes (`400` when missing). A stale revision returns `409`; a missing, foreign, or trashed note/version returns `404`; an unreachable PocketBase returns `502`, and an unexpected git failure returns `500`.

### MCP

`POST /mcp` is a stateless Streamable HTTP MCP endpoint. It accepts the same session token or `nana_…` API key as `/api/v1`; auth runs before any MCP work. A key contributes its read-only and folder/root scope to every tool call.

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

The server registers tools for folders, notes, boards, and tasks; the table below is the contract. The note and board read tools reuse the chat executors, including their bounds, author checks, and private lock. Write tools call the shared workspace services with `surface: "ai"`.

| Family | Tools | Behavior |
| --- | --- | --- |
| Folders | `list_folders`, `create_folder` | List visible folders; create a folder under a visible parent. |
| Notes | `list_notes`, `read_note`, `create_note`, `update_note`, `move_note`, `delete_note` | Metadata/list and bounded body reads; create, update, move, or trash a note. `delete_note` returns `{ deleted, trashDocumentId }`. |
| Boards | `list_boards`, `read_board`, `create_board`, `update_board`, `move_board`, `restore_board`, `delete_board` | List with task counts; read a non-trashed board; create/update/move; restore from trash; move to trash. |
| Tasks | `list_tasks`, `create_task`, `update_task`, `move_task`, `delete_task`, `add_note_to_board` | List, create, update, move, or permanently delete tasks; copy a note onto a board. |

MCP is an AI surface, so private notes, boards, folders, and private-folder subtrees are omitted from lists and look missing by id. A tool that tries to write to a hidden record returns `not_found`. API-key scope is an additional envelope: a folder-scoped key sees only those subtrees and never the root; a root-only key sees no folders; a read-only key is not offered write tools at all. See [`ai.md`](ai.md) for the privacy rules and tool semantics.

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
  "boardIds": ["id"],
  "zipName": "optional-name"
}
```

At least one document, folder, or board is required. A single document with no attachments returns `text/markdown`; a single board returns Markdown with its description and tasks grouped by column, including the backlog statuses. Everything else returns a ZIP containing Markdown and attachments. Folder exports include descendants. Board export is one board per request. See `src/api/export/`.

#### `GET /api/chat/status`

Requires auth. Reports whether an enabled model exists and returns the model picker without exposing keys or base URLs. A missing model context window is filled from the cached models.dev catalog for this response; saved values win and `ai_config` is not modified:

```json
{
  "configured": true,
  "model": "gpt-4o-mini",
  "provider": "openai",
  "local": false,
  "defaultModelId": "work:gpt-4o-mini",
  "models": [
    {
      "id": "work:gpt-4o-mini",
      "label": "GPT-4o mini",
      "model": "gpt-4o-mini",
      "provider": "Work gateway",
      "providerKind": "openai",
      "local": false,
      "contextWindow": 128000,
      "maxOutputTokens": null,
      "vision": true,
      "files": true,
      "tools": true,
      "reasoning": false
    }
  ],
  "limits": {
    "enabled": false,
    "maxFiles": 5,
    "maxFileBytes": 10485760,
    "maxTotalBytes": 26214400,
    "maxTextChars": 100000
  }
}
```

`model` is the upstream model id of the effective default; `provider` keeps the legacy provider kind (`openai`, `google`, `anthropic`, or `ollama`); `local` is true for Ollama. `models` contains only enabled models whose connection is enabled; each option's `provider` is the connection name and `providerKind` is its protocol. `defaultModelId` is a canonical `connectionId:modelId`. `limits` is the normalized attachment contract and gates the upload and send routes. API keys, base URLs, and connection objects are never returned. A settings-read failure returns `200` with `configured: false`, null model/provider/default, an empty `models`, and default limits rather than an error.

#### `POST /api/chat/attachments`

Requires a session token (`verifyAuth`; API keys are rejected). Multipart form with one `file` part. Returns `201 { "attachment": { id, name, mimeType, size, kind } }`; extracted text, the protected file name, and raw bytes are never returned.

- Allowed: PNG, JPEG, WebP, and GIF images (SVG is rejected), PDFs, and `text/plain`/Markdown text. Classification uses magic bytes and UTF-8 validation, not the declared `file.type`.
- Rejected when attachments are disabled (`403 attachments_disabled`), the file exceeds `maxFileBytes` (`413 too_large`), or the type/content is unsupported or mismatched (`415 unsupported_type`).
- The route is rate limited with the `/api/chat/*` bucket and has a 60-second request timeout. The configured `maxFileBytes` plus a bounded multipart allowance is checked from `Content-Length` before parsing.
- The row starts as a draft (`conversation` and `message` empty). Send it with `POST /api/chat/send.attachmentIds`; the server binds it after the user message is created.
- Text files get server-extracted text; PDFs are parsed with pdfjs (200-page, 15-second, `maxTextChars` limits). A scanned/empty PDF keeps the row with empty text.

#### `DELETE /api/chat/attachments/:id`

Requires a session token and owner. Deletes an unbound draft row and its protected file. `204` on success; `404` for another user's or missing id; `409 attachment_in_use` once the row is bound to a message. Conversations and messages cascade their attachment rows when deleted.

#### `POST /api/chat/send`

Requires auth. Request:

```json
{
  "conversationId": "optional-existing-id",
  "message": "user text",
  "attachmentIds": ["optional-draft-attachment-id"],
  "modelId": "optional-enabled-model-id",
  "mode": "ask",
  "context": { "type": "document", "id": "optional-record-id" },
  "regenerate": false
}
```

- `message` may be empty only when `attachmentIds` has at least one id. Ids must match `[A-Za-z0-9]{1,64}`, are deduplicated, and are capped at the configured `maxFiles` (hard ceiling 20).
- `attachmentIds` reference owner-scoped draft rows from `POST /api/chat/attachments`. The server verifies ownership, unbound state, count, per-file size, total size, and the selected model's `vision`/`files` capabilities before creating a conversation or SSE stream. Invalid/bound/too many ids are `400`; disabled attachments are `403`; size overflow is `413`; unsupported types or model capability failures are `415`; missing or foreign ids are `404`.
- `modelId` is optional and must be an enabled id from `GET /api/chat/status.models`. Omit it to use `defaultModelId`, then the first enabled model. An explicit unknown or disabled id returns `400` with code `model_not_found` before any conversation or stream work.
- `mode` is `"ask"` or `"edit"`; omit it for the safe read-only default. The UI's Work mode sends `"edit"` and is the default there; Ask sends `"ask"`. Edit adds create, rename, move, and update tools for folders, notes, boards, and tasks; boards and notes can be moved to trash or restored, and deletes use a pending confirmation card.
- `context` is optional and accepts only `{ type: "document" | "board" | "folder", id }`. Bun resolves the title, ownership, trash state, and private lock with the caller's token, then persists `messages.context` with the resolved title on the user message. The system prompt receives only the type and id; titles and bodies stay out. A missing, foreign, trashed, private, or hidden record is `404`; a malformed type/id is `400`; an unreadable visibility snapshot is `503`. Client-supplied titles and bodies are ignored.
- Omit `conversationId` to create a conversation. The first message seeds the title from the user text or the first attachment name; a background title call refines it after the first reply when the stream is not stopped and has no error. Title generation never receives attachment bytes or extracted text.
- `regenerate: true` trims the previous user/assistant exchange before re-sending.
- There is no `documentIds` field. `attachmentIds` is the only file payload; context is metadata only and tools read notes, boards, and tasks on demand.
- The persisted user message carries sanitized attachment refs. Chat history sends role, content, and attachment content for user messages only. Stored reasoning, tool activity, the ordered `parts` timeline, sources, context metadata, and model metadata stay out of the prompt; the resolved context contributes a short system note.
- Images become AI SDK image parts (vision required); PDFs become native file parts when the model has `files`, otherwise extracted text (and are rejected if no text); text files become named `<attachment>` text blocks. Older user-message attachments share the request's byte/text budget and degrade to text or an explicit omission marker; assistant attachments are never sent. Attachment contents are untrusted data and the system prompt says not to follow instructions inside them.
- In edit mode, writes go through the workspace services with the caller's token and `X-Nana-Actor: ai`; note edits carry revision checks. Tools cover creating, renaming, moving, and updating folders, notes, boards, and tasks; boards can be trashed and restored. Delete tools create a pending card; `POST /api/chat/edits/:id/confirm` executes it with the caller's token. Chat has no publish, share, privacy, board-column, or label tools, and it cannot move a task to another board. See [`ai.md`](ai.md) for the write contract.

The response is an SSE stream with these headers:

| Header | Meaning |
| --- | --- |
| `X-Conversation-Id` | Conversation to continue. |
| `X-Is-New-Conversation` | `"true"` when a new conversation was created. |
| `X-Model-Name` | Upstream model id used for this turn. |
| `X-Model-Source` | Canonical connection id that supplied the model. |
| `X-Chat-Mode` | `ask` or `edit`. |

The dock reads named SSE events. Every `data:` payload also carries `type`:

| Event | Payload |
| --- | --- |
| `text` | `{ type: "text", delta }`. |
| `reasoning` | `{ type: "reasoning", delta }`. |
| `tool` | `{ type: "tool", id, name, status, error? }`; `status` is `running`, `success`, or `error`. |
| `sources` | `{ type: "sources", sources }`; each source is a document or board with `{ id, title }`. |
| `edit` | `{ type: "edit", edit }`; one applied write, emitted before the model's next token where possible. |
| `done` | `{ type: "done", conversationId, messageId, stopped, model, sources, usage? }`; `messageId` is `null` if persistence failed, and `usage` is the final model step's token accounting when the provider reported it. |
| `error` | `{ type: "error", message, errorText }`. |

A request that omits `mode` also receives legacy AI-SDK UI chunks for text, reasoning, tools, completion, and errors: `text-delta`, `reasoning-delta`, `tool-input-start`, `tool-output-available`/`tool-output-error`, `finish`, `[DONE]`, and `error`. A request that sends `mode` (the dock) receives only the named events. There is no `X-RAG-Sources` header; sources travel as the `sources` event and the persisted `sources` field. There are no embeddings or retrieval metadata.

After the model stream ends, the pump persists the assistant message with `content`, optional `reasoning`, optional `tools`, optional `parts`, optional `sources`, optional `usage`, optional `stopped`, and `model`. `parts` is the ordered timeline of `{ type: "text" | "reasoning", text }`, `{ type: "tool", name, status, ... }`, and `{ type: "edit", editId }`; it is what lets the UI render a call where it happened. Persisted tool parts keep only `{ name, status }` plus optional safe title/target fields, with `status` `success` or `error`; names are restricted to `CHAT_TOOL_NAMES`, and inputs/outputs are dropped. See [`ai.md`](ai.md) for the tool contracts, bounds, and prompt-injection stance.

Chat errors:

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, an empty turn (no text and no attachments), invalid `mode`, malformed `context`, an invalid/bound/too-many attachment id, or an unknown/disabled `modelId` with code `model_not_found`. |
| `401` | Missing or invalid user token. |
| `403` | Attachments are disabled (`attachments_disabled`). |
| `404` | The context record is missing, trashed, foreign, or hidden; an attachment id is missing or foreign; or the conversation is missing or foreign. |
| `413` | An attachment or the combined attachment set exceeds the configured byte cap (`too_large`). |
| `415` | Unsupported/SVG/mismatched file content, or the selected model lacks the required vision/files capability (`unsupported_model`). |
| `502` | The provider failed before the SSE stream started; the message is mapped by `getAIErrorMessage()`. Failures after streaming begins arrive as an `error` event. |
| `503` | `ai_config` is missing, no enabled model (including the legacy active-provider fallback) is configured, or the context visibility snapshot could not be loaded. |

#### Chat conversations

| Route | Method | Response |
| --- | --- | --- |
| `/api/chat/conversations` | GET | The current user's conversations, newest first. |
| `/api/chat/conversations/:id` | GET | `{ conversation, messages }`. |
| `/api/chat/conversations/:id` | PATCH | `{ conversation }`; body `{ title }`, trimmed, 1–120 characters. |
| `/api/chat/conversations/:id` | DELETE | `204` on success. |

Conversation list/view/rename/delete are author-scoped by PocketBase rules. Bun creates a conversation with the author derived from the token, then writes each turn to the `messages` collection. Every route forwards the caller's token. Unknown conversations and another user's conversation both return `404`. `GET /api/chat/conversations/:id` returns `{ conversation, messages }`, with messages ordered by `position` and sanitized on read. Messages may carry `context`, `attachments`, `sources`, `usage`, `stopped`, and the ordered `parts` timeline; attachment refs contain only `{ id, name, mimeType, size, kind }`. See [`ai.md`](ai.md) for the persisted shapes.

#### Chat edits and undo

| Route | Method | Response |
| --- | --- | --- |
| `/api/chat/conversations/:id/edits` | GET | `{ edits }`, oldest first. |
| `/api/chat/edits/:id/undo` | POST | `{ edit, alreadyUndone }`. |
| `/api/chat/edits/:id/confirm` | POST | `{ edit }`; executes a pending delete with the caller's token. |
| `/api/chat/edits/:id/cancel` | POST | `{ edit }`; cancels a pending delete without a write. |

An edit card carries `id`, `conversationId`, `messageId`, `target { type, id, title, url }`, `tool`, `summary`, `status`, `actorType: "ai"`, `actorLabel`, `changed { sections?, fields? }`, `undo { kind, available }`, and timestamps. Target types are `document`, `board`, `task`, and `folder`. `status` is `pending`, `applied`, `undone`, `cancelled`, or `failed`; `undo.kind` is `trash`, `restore`, or `none`.

- Both routes require the conversation owner. Another user's conversation or edit returns `404`, matching a missing record.
- `create_note` undo moves the created note to trash. `append_note`, `edit_note`, and `update_note` undo restore the pre-edit snapshot.
- Pending delete cards are created by `delete_note`, `delete_task`, `delete_folder`, and `delete_board`. The confirm route re-checks ownership and visibility, then executes the workspace delete; cancel only changes the audit row status. Board and task edits have `undo.kind: "none"` and `available: false`; undoing one returns `409`.
- Note-edit undo is revision-aware. If the note changed after Nana's edit, the route returns `409` instead of overwriting newer work. Created-note undo trashes the target without a revision check. A second undo of a successful edit returns `alreadyUndone: true` and does not apply the edit twice.
- A note-edit undo with no saved revision or snapshot returns `409`. An applied non-AI audit row returns `409`; only Nana edits are undoable from chat.

#### Admin

`GET /api/v1/admin/rate-limits` returns `{ rateLimits, defaults, scopes }` for the signed-in admin. `rateLimits` is `{ enabled, apiPerMinute, otherPerMinute }`; `defaults` carries the two default ceilings; `scopes` lists the route groups each ceiling covers.

`PATCH /api/v1/admin/rate-limits` accepts the full `{ enabled, apiPerMinute, otherPerMinute }` object, validates positive integers up to 1,000,000, persists `settings.rate_limits`, and reloads the in-memory limiter in the same request. Both routes require the PocketBase admin flag: a missing or invalid token returns `401`, a valid non-admin token returns `403`, schema failures return `422`, and an unreachable settings store returns `502`. The admin routes are hidden from the public OpenAPI document.

`GET /api/v1/admin/ai/models` is an admin-only, read-only models.dev proxy. It accepts optional `q` (max 120 characters) and `provider` (models.dev provider id), returns at most 500 chat-capable models with limits and capability flags, and keeps a six-hour server-side cache with ETag revalidation. It never returns keys or writes provider state; first-load failure returns `502`.

`POST /api/admin/rate-limits/reload` is the legacy admin-only reload hook. It takes no body and returns `{ success: true, config }` with the legacy `pbMaxPerMinute` and `appMaxPerMinute` keys. The settings UI uses the `/api/v1` endpoint, so the separate reload is no longer required.

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
| `/api/public/folders/:shareToken` | GET | Folder tree plus descendant folders, documents, and active boards with their tasks. Private subtrees, private documents, and private/trashed boards are skipped. |
| `/api/public/folders/:shareToken/files/:documentId/:filename` | GET | Attachment for a document in a shared folder. |
| `/api/public/boards/:shareToken` | GET | Board metadata plus tasks in board order. Trashed, private, expired, and non-public boards return `404`. Linked task notes are omitted. |

#### Trash

All require a user token and ownership checks.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/trash/move-document` | `{ "documentId": "id" }` | Sets `deleted_at`/`deleted_by` and clears sharing; returns `{ trashDocumentId }`, which equals the document id. |
| `POST /api/trash/restore-document` | `{ "trashDocumentId": "id" }` | Clears the soft-delete fields; returns `{ documentId, folderId }`. A note whose folder is still trashed is re-rooted. |
| `POST /api/trash/permanent-delete-document` | `{ "trashDocumentId": "id" }` | Hard-deletes the document, removes its version repository, deletes attachments, and clears task `document` links. |
| `POST /api/trash/move-folder` | `{ "folderId": "id" }` | Marks the subtree and its documents deleted, clears sharing, and rehomes boards to the root; returns `{ trashFolderId, movedDocumentIds, movedBoardIds }`. |
| `POST /api/trash/restore-folder` | `{ "trashFolderId": "id" }` | Clears the subtree and its documents; returns `{ success, folderId, restoredDocumentIds }`. Boards rehomed to the root stay there. |
| `POST /api/trash/permanent-delete-folder` | `{ "trashFolderId": "id" }` | Rehomes boards, clears task note links, then hard-deletes the subtree through `folders.parent` and `documents.folder` cascades. |
| `POST /api/trash/move-board` | `{ "boardId": "id" }` | Sets `archived = true`, clears the public share and grants, and keeps tasks/columns; returns `{ boardId }`. |
| `POST /api/trash/restore-board` | `{ "trashBoardId": "id" }` | Clears `archived`; returns `{ boardId }`. |
| `POST /api/trash/permanent-delete-board` | `{ "trashBoardId": "id" }` | Hard-deletes a trashed board; cascades tasks and columns. Source notes stay. |

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
| `settings` | `/api/v1/records/settings` | Admin-only key/value store. |
| `trash_documents`, `trash_folders` | `/api/v1/records/trash_*` | Readable but not writable; mutations go through `/api/v1/trash/:action`. |
| `conversations` | none | Server-side chat only; `/api/chat/conversations`. |
| `chat_attachments` | none | Chat upload/send routes only; protected previews go through `/api/v1/files/chat_attachments/...`. |

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
- `archived` is the board trash flag and defaults to false. `POST /api/trash/move-board` or `PATCH { archived: true }` moves it to trash; `POST /api/trash/restore-board` or `PATCH { archived: false }` restores it. A trashed board’s public link stops serving.
- `folder` is optional. It must belong to the caller and not be trashed; `relation_guards.js` checks the incoming relation. An empty value means the workspace root.
- `is_private` hides the board from chat and MCP, not from its owner. A private board cannot be served publicly.
- `is_public`, `public_share_token`, and `public_expires_at` are the board public-share fields; the browser generates the token and the public route validates it.
- `author` is required and set on create. Ownership cannot be changed later.
- A board may only be permanently deleted while `archived = true`; that delete cascades its tasks and columns. `DELETE /api/v1/boards/:id` soft-trashes instead.
- List and view are author-scoped. Use `filter=archived=false` for active boards and `filter=archived=true` for trash.

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
  "board": "board_record_id",
  "document": "optional_document_id"
}
```

- `board` is required. A task cannot be created without a board, on another user's board, or on a trashed board.
- `status` is required and limited to the four column values. `priority` is optional; the UI sends `""` when unset.
- `board_order` is a non-negative number scoped to a column. Dragging writes only changed rows.
- `document` is optional and does not cascade. Trashing the note keeps the link so a restore restores it; unrelated task edits still work while the note is trashed. Permanently deleting the note clears the link. Deleting the task leaves the note.
- Tasks have no `author` field. Ownership is `board.author`; the board relation is required and cascades.
- List, view, and delete require `board.author = @request.auth.id`. Create and update additionally require `board.archived = false` (not in trash).
- Tasks have no trash flow. Deleting a task is permanent.

See [`pocketbase.md`](pocketbase.md) for the exact rules, indexes, and board trash lifecycle.

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

Folder response includes `rootFolder`, `folders`, `documents`, `boards`, and `entryDocumentId`. Each folder board carries its own `tasks`; task fields match a standalone board share and omit `author`, `board`, and the linked `document`. The linked note keeps its own privacy and share state. Expired shares are disabled on read and swept by a 15-minute cron.

## Gotchas & invariants

- **`/api/v1` has two contracts.** The typed workspace routes return camelCase DTOs and `{ error }` failures; the browser facade returns PocketBase-shaped records and `{ code, message, data }` failures. Do not mix their paths or schemas.
- **The browser never calls PocketBase.** `src/lib/pocketbase.ts` is a small client over `/api/v1`; `/pb` returns `404`. Server-side code uses `serverConfig.pocketbaseUrl` on loopback.
- **API keys are machine credentials, not browser sessions.** Only `/api/v1` typed workspace routes and `/mcp` accept them. The browser facade, chat, export, and admin routes reject them. Key management itself requires a session.
- **Only a hash is stored.** `api_keys.key_hash` is SHA-256 of the `nana_…` secret. The plaintext is returned once by `POST /api/v1/api-keys` and never stored or logged.
- **Key scope is enforced in the services.** A key's `access` and `scope` travel in `ToolContext`; lists filter out-of-scope folders and records, and reads/writes outside the envelope return `404`. Do not rely on the client or the MCP prompt to enforce it.
- **MCP private lock still wins.** A workspace-scoped key does not expose private records to MCP. `/api/v1` remains the owner surface and still shows the key owner's private records.
- **Legacy file links are rewritten.** Existing Markdown may contain `/pb/api/files/...`; `src/lib/legacy-urls.ts` rewrites those to `/api/v1/files/...` in Markdown previews and public views. There is no compatibility `/pb` route.
- **The browser facade is an allowlist, not a proxy.** Do not add system collections, schema, logs, backups, or superuser paths to `/api/v1/records`. New collections need an explicit entry in `src/api/rest/browser/records.ts`.
- **Ownership is server-injected.** Browser `author` values are ignored on create and removed on update. Folder parents, board folders, task boards, and note links are checked before the upstream write.
- **Document content is sanitized at the edge.** The facade calls `sanitizeHtml()` on create/update; PocketBase is still the storage and rules engine.
- **Private records are visible to their owner.** `/api/v1` is the owner surface. Only chat and MCP apply the private lock; do not add `aiVisibilityConditions()` to REST or browser facade handlers.
- **`/docs` is public.** The OpenAPI document and Scalar assets are intentionally unauthenticated; `/api/v1` routes are not.
- **Scalar renders only tags listed in `x-tagGroups`.** When the extension is present, the sidebar is built from each group's tag names; a tag declared in `tags` but omitted from every group disappears from the nav. Add new reference tags to the `Workspace` group in `src/api/rest/openapi.ts`.
- **MCP is POST-only and stateless.** There is no session to continue. Every request authenticates, builds a server, handles one payload, and closes the transport.
- **MCP tool failures are model-facing, not HTTP failures.** An `isError` text result still returns `200`; only auth, parse, and transport failures return HTTP errors.
- **Chat context is metadata, not retrieval.** `POST /api/chat/send` accepts only `{ type, id }` and resolves the title server-side for history. The prompt note contains only the type and id; there are no `documentIds` or attachments; extra request fields are ignored.
- **Chat mode gates writes.** Ask mode has only the read tools. Work (`edit`) adds create, rename, move, and update tools, board trash/restore, and confirm-first deletes. The mode lives in the request and the tool registry, not in the prompt.
- **Chat note edits require a revision.** `read_note` returns `revision` and `versionToken`; the note update tools pass one back. A stale value is a `conflict` tool result, not a silent overwrite.
- **Version history is manual-only.** Only `POST /api/v1/documents/:id/versions` commits a version. Autosave, chat writes, and MCP writes never create one. Version detail loads the body separately from the paginated list. `documents.published` and `document_versions` no longer exist; do not reintroduce either.
- **`chat_edits` is server-owned.** It has no public create/update/delete rules. Bun writes it after checking conversation ownership; board/task cards are informational and cannot be undone.
- **Sources are event data.** No `X-RAG-Sources` header exists, but new assistant messages do carry server-collected `sources` in the stream and in `messages.sources`. Sources come from content reads and successful writes, not list-only searches. Do not derive sources from model text.
- **Chat tool errors are model-facing, not HTTP errors.** `list_notes` etc. return `{ ok: false, code, message }` inside the stream; the chat `POST` still succeeds. Undo and other JSON routes do use HTTP statuses, including `409` for newer work.
- **Persisted chat tool activity is allowlisted.** Only `CHAT_TOOL_NAMES` entries (read and write) and `success`/`error` statuses survive `sanitizeTools()`; args and outputs are never stored. MCP tool activity is not persisted in conversations.
- **Messages are records.** `conversations.messages` no longer exists. Appending a message writes a `messages` row and touches the conversation's `updated` timestamp so the sidebar order stays current.
- **Deleting a board moves it to trash.** `DELETE /api/v1/boards/:id` and chat confirmation soft-delete it; permanent delete is `/api/v1/trash/permanent-delete-board` from Trash.
- **Task deletion still works on a trashed board.** The trash rule blocks create/update, not delete; this is intentional so cleanup stays possible.
- **A `403` and a `404` can look identical through the services.** PocketBase hides unauthorized records; the shared client maps both to a generic `not_found`.
- **Cross-author folders are rejected twice.** The workspace service checks folder ownership before the write; `relation_guards.js` checks the incoming relation again for direct API calls.
- **A trashed folder does not trash its boards.** Boards are rehomed to the root and keep their tasks and trash state.
- **Trash is soft delete.** `move-*` keeps the document/folder id and attachments; `trash_documents`/`trash_folders` are read-only views. Permanently deleting is a separate route.
- **Direct deletes are disabled on notes and folders.** `documents.deleteRule` and `folders.deleteRule` are `null`; use `/api/v1/trash/move-*` and then restore or permanently delete.
- **Rate limits apply before handlers.** `/api/*`, `/api/v1`, `/docs`, and `/mcp` all pass through `checkRateLimit()`; a `429` includes `Retry-After`. The `/api/v1` bucket is still stored under the legacy `pbMaxPerMinute` settings key; update it through `PATCH /api/v1/admin/rate-limits` so the limiter reloads with the write.

## Related docs

- [`architecture.md`](architecture.md) — topology, request flow, and data flows.
- [`ai.md`](ai.md) — chat tools, MCP, privacy lock, providers, and failures.
- [`pocketbase.md`](pocketbase.md) — collection rules, migrations, and settings.
- [`security.md`](security.md) — auth layers, MCP authorization, browser facade safety, and CSP.
- [`frontend.md`](frontend.md) — routes and client calls that consume these endpoints.
