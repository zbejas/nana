# API — Bun, Elysia REST, MCP, and PocketBase surfaces

## Overview

Nana exposes four HTTP surfaces through one Bun origin:

- **Bun application API** — `/api/chat`, `/api/export`, `/api/app/version`, and `/api/admin`.
- **Elysia REST API** — `/api/v1` for folders, notes, boards, and tasks, with public OpenAPI docs at `/docs` and `/docs/json`.
- **MCP** — `POST /mcp`, a stateless Streamable HTTP endpoint for AI clients.
- **PocketBase** — collection/auth routes and custom `/api/*` routes, reached by the browser through the `/pb` proxy.

The browser uses the PocketBase SDK at `/pb` for normal reads and writes. `/api/v1` and `/mcp` are for external clients and automation; they authenticate with a PocketBase user token and call PocketBase with that same token.

`/api/v1` and `/mcp` accept the user token raw or as a Bearer token:

```http
Authorization: <pocketbase-auth-token>
Authorization: Bearer <pocketbase-auth-token>
```

`verifyAuth()` validates tokens for the application API. `authenticateApiRequest()` validates them for `/api/v1` and `/mcp`, accepts either form, and uses the refreshed token for downstream calls. PocketBase collection routes enforce their own API rules; admin routes additionally call `requireAdmin()`.

## Key files

| File | Role |
| --- | --- |
| `src/index.ts` | Bun route table, Elysia mount, MCP mount, rate-limit checks, security headers, proxy mount. |
| `src/api/rest/index.ts` | Elysia `/api/v1` routes, OpenAPI metadata, self-hosted Swagger UI assets, REST error mapping. |
| `src/api/rest/auth.ts` | `authenticateApiRequest()`; raw/Bearer token handling and `auth-refresh`. |
| `src/api/rest/schemas.ts` | TypeBox request, query, params, and response schemas. |
| `src/api/mcp/index.ts` | MCP server construction, folder/note/board/task tool registrations, stateless transport, JSON-RPC errors. |
| `src/api/workspace/` | Shared folder, note, board, and task services used by REST and MCP. |
| `src/api/workspace/privacy.ts` | `loadAiVisibility()`, `aiVisibilityConditions()`, and the record lock helpers. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase REST client and status mapping. |
| `src/api/auth.ts` | `verifyAuth()` and `AuthError`. |
| `src/api/pocketbase-proxy.ts` | Transparent `/pb/*` forwarding; no side effects. |
| `src/api/chat/index.ts` | Chat request parsing, SSE response, conversation dispatch. |
| `src/api/chat/tools/` | Read-only `list_notes`, `read_note`, `list_boards`, `read_board`, shared with MCP reads. |
| `src/api/export/` | Markdown and ZIP export. |
| `src/api/app-version.ts` | Cached GitHub Releases lookup. |
| `src/lib/boards/` | Browser-side board CRUD, folder/privacy fields, and summaries over the standard collection API. |
| `src/lib/tasks/` | Browser-side task CRUD, ordering, and note import. |
| `pocketbase/pb_hooks/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users. |
| `pocketbase/pb_hooks/guards/board_guards.js` | Board folder ownership on API create/update. |
| `pocketbase/pb_migrations/` | Collection schema and API rules. |

## How it works

### Conventions

| Topic | Convention |
| --- | --- |
| `/api/v1` content type | JSON; camelCase response fields. |
| `/api/v1` errors | `{ "error": "message" }` with an HTTP status. |
| `/api/v1` auth | Raw user token or `Authorization: Bearer <token>`; invalid or expired tokens return `401`. |
| `/api/v1` validation | Path/query/body schemas return `422`; malformed JSON returns `400`. |
| MCP | JSON-RPC over Streamable HTTP; tool failures are `isError` results, not HTTP failures. |
| Application API errors | Bun handlers return `{ "error": "message" }`; PocketBase returns its standard error envelope. |
| Auth failure | Missing or invalid user token (`401`); authenticated non-admin on an admin route (`403`). |
| Rate limit | `429` with `Retry-After` when `settings.rate_limits.enabled` is true. `/pb` uses the PB limiter; everything else uses the app limiter. |
| SSE | `/api/chat/send` disables the Bun request timeout and streams the AI SDK UI message protocol. |
| Browser URLs | Always same-origin `/pb`, never `:8090`. |

### Elysia REST API

`/api/v1` is the **owner surface**. It uses the workspace services with `surface: "user"`, so the owner sees their private notes, boards, folders, and private-folder contents. The AI visibility lock applies only to chat and MCP. This is deliberate: an owner editing their own workspace must be able to see and change private records.

It is a server-side facade over the same PocketBase collections; it does not replace the browser SDK calls.

#### Authentication and docs

Every `/api/v1` route calls `authenticateApiRequest()` before the handler:

1. Extract the raw token or the value after `Bearer`.
2. POST it to PocketBase `auth-refresh` (8-second timeout).
3. Use the returned record id as the author and the refreshed token for downstream PocketBase calls.
4. Return `401 { "error": "..." }` when the header is missing, the token is invalid/expired, or PocketBase cannot verify it.

`GET /docs` serves Swagger UI and `GET /docs/json` serves the OpenAPI document. Both are **public**; `/api/v1` itself is not. The UI assets are served from `swagger-ui-dist` at `/docs/swagger-ui-bundle.js` and `/docs/swagger-ui.css`, so the CSP needs no external script or style origin. The spec uses `APP_VERSION`, tags for Folders, Notes, Boards, and Tasks, and a `bearerAuth` HTTP security scheme.

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

#### Proxy, docs, and assets

| Route | Method | Behavior |
| --- | --- | --- |
| `/pb/*` | any | Forward to PocketBase preserving method, headers, query, and body. No side effects. |
| `/api/v1/*` | any | Elysia REST API. Authenticated per route. |
| `/docs`, `/docs/json` | GET | Public Swagger UI and OpenAPI document. |
| `/docs/swagger-ui-bundle.js`, `/docs/swagger-ui.css` | GET | Self-hosted Swagger UI assets. |
| `/mcp` | POST | Stateless MCP endpoint. |
| `/manifest.webmanifest` | GET | PWA manifest. |
| `/sw.js` | GET | Minimal service worker. |
| `/nana.svg`, `/nana-192.png`, `/nana-512.png` | GET | Icons. |
| `/pdfjs/pdf.worker.min.mjs` | GET | PDF.js worker from `node_modules`. |
| `/*` | GET | Production static files with SPA fallback, or the development HMR entry. |

### PocketBase routes

These paths are shown as PocketBase sees them. From the browser, prefix them with `/pb` (for example `/pb/api/trash/move-document`).

#### Public

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/check-users` | GET | `{ hasUsers, totalUsers }`; drives onboarding vs sign-in. |
| `/api/public/documents/:shareToken` | GET | Public document payload. Validates `is_public`, `is_private`, and expiry. |
| `/api/public/documents/:shareToken/files/:filename` | GET | Document attachment when `share_attachments` is true. |
| `/api/public/folders/:shareToken` | GET | Folder tree plus descendant folders/documents. Private subtrees and private documents are skipped. |
| `/api/public/folders/:shareToken/files/:documentId/:filename` | GET | Attachment for a document in a shared folder. |

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

Standard PocketBase endpoints under `/api/collections/...` are used by the browser SDK. The UI keeps using them for boards and tasks as well; `/api/v1` is a separate server-side facade, not a replacement.

| Collection | Browser path | Access |
| --- | --- | --- |
| `users` | `/pb/api/collections/users/...` | Auth, registration, password reset, email change, OAuth. |
| `folders`, `documents`, `document_versions`, `conversations` | `/pb/api/collections/...` | CRUD governed by collection rules. |
| `boards` | `/pb/api/collections/boards/records` | Author-scoped CRUD; delete only while archived; optional folder; private flag. |
| `tasks` | `/pb/api/collections/tasks/records` | Author-scoped CRUD; create/update require an active board owned by the author. |
| `settings` | `/pb/api/collections/settings/records` | Admin-only key/value store. |
| `trash_*` | `/pb/api/collections/trash_*/records` | Readable but not writable; mutations go through trash routes. |

#### Board records

```json
{
  "name": "Release",
  "description": "Ship the next version",
  "archived": false,
  "folder": "optional_folder_id",
  "is_private": false,
  "author": "user_record_id"
}
```

- `name` is required (max 120); `description` is optional (max 500).
- `archived` defaults to false. Archiving is a normal `PATCH`; there is no separate archive route.
- `folder` is optional. It must belong to the caller; `board_guards.js` checks the incoming relation. An empty value means the workspace root.
- `is_private` hides the board from chat and MCP, not from its owner.
- `author` is required and set on create. Ownership cannot be changed later.
- A board may only be deleted while `archived = true`; that delete cascades its tasks.
- List and view are author-scoped. Use `filter=archived=false` for the active index and `filter=archived=true` for the archive.

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

Folder response includes `rootFolder`, `folders`, `documents`, and `entryDocumentId`. Expired shares are disabled on read and swept by a 15-minute cron.

## Gotchas & invariants

- **`/api/v1` is not PocketBase.** `/pb/api/...` is the proxied PocketBase collection API; `/api/v1` is an Elysia facade with its own DTOs, validation, and error envelope. Do not mix their paths.
- **The browser UI still uses collection endpoints.** Do not rewrite the SDK calls to `/api/v1`, and do not add `/api/boards` or `/api/tasks` aliases beside the existing `/api/v1` routes.
- **Private records are visible on REST.** `/api/v1` is the owner surface. Only chat and MCP apply the private lock; do not add `aiVisibilityConditions()` to REST handlers.
- **`/docs` is public.** The OpenAPI document and Swagger UI assets are intentionally unauthenticated; `/api/v1` routes are not.
- **MCP is POST-only and stateless.** There is no session to continue. Every request authenticates, builds a server, handles one payload, and closes the transport.
- **MCP tool failures are model-facing, not HTTP failures.** An `isError` text result still returns `200`; only auth, parse, and transport failures return HTTP errors.
- **`/pb` is a transparent proxy.** It does not add auth, rewrite rules, or run background work. PocketBase decides access.
- **Chat has no `documentIds`.** A request containing extra fields is ignored; only `conversationId`, `message`, and `regenerate` are read.
- **No RAG headers or sources.** Clients must not expect `X-RAG-Sources` or a `sources` field in new assistant messages.
- **Chat tool errors are model-facing, not HTTP errors.** `list_notes` etc. return `{ ok: false, code, message }` inside the stream; the chat `POST` still succeeds.
- **Persisted chat tool activity is allowlisted.** Only `CHAT_TOOL_NAMES` entries and `success`/`error` statuses survive `sanitizeTools()`; args and outputs are never stored. MCP tool activity is not persisted in conversations.
- **Deleting an active board fails.** Archive it first, then delete from `/board/archive` or `DELETE /api/v1/boards/:id`.
- **Task deletion still works on an archived board.** The archived-board rule blocks create/update, not delete; this is intentional so cleanup stays possible.
- **A `403` and a `404` can look identical through the services.** PocketBase hides unauthorized records; the shared client maps both to a generic `not_found`.
- **Cross-author folders are rejected twice.** The workspace service checks folder ownership before the write; `board_guards.js` checks the incoming relation again for direct API calls.
- **A trashed folder does not trash its boards.** Boards are rehomed to the root and keep their tasks and archive state.
- **Rate limits apply before handlers.** `/api/*`, `/api/v1`, `/docs`, `/mcp`, and `/pb/*` all pass through `checkRateLimit()`; a `429` includes `Retry-After`.

## Related docs

- [`architecture.md`](architecture.md) — topology, request flow, and data flows.
- [`ai.md`](ai.md) — chat tools, MCP, privacy lock, providers, and failures.
- [`pocketbase.md`](pocketbase.md) — collection rules, migrations, and settings.
- [`security.md`](security.md) — auth layers, MCP authorization, proxy safety, and CSP.
- [`frontend.md`](frontend.md) — routes and client calls that consume these endpoints.
