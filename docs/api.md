# API — Bun and PocketBase surfaces

## Overview

Nana exposes two HTTP surfaces. Bun owns `/api/*` application endpoints. PocketBase owns collection/auth routes and custom `/api/*` routes inside the backend. The browser reaches PocketBase through the Bun proxy at `/pb/...`, so there is one public origin.

All non-public Bun endpoints require a PocketBase user token:

```http
Authorization: <pocketbase-auth-token>
```

`verifyAuth()` validates the token against PocketBase `auth-refresh` and returns the user ID. PocketBase collection routes enforce their own API rules; admin routes additionally call `requireAdmin()`.

## Key files

| File | Role |
| --- | --- |
| `src/index.ts` | Bun route table, rate-limit checks, security headers, proxy mount. |
| `src/api/auth.ts` | `verifyAuth()` and `AuthError`. |
| `src/api/pocketbase-proxy.ts` | Transparent `/pb/*` forwarding; no side effects. |
| `src/api/chat/index.ts` | Chat request parsing, SSE response, conversation dispatch. |
| `src/api/chat/tools/` | Read-only `list_notes`, `read_note`, `list_boards`, `read_board`. |
| `src/api/export/` | Markdown and ZIP export. |
| `src/api/app-version.ts` | Cached GitHub Releases lookup. |
| `src/lib/boards/` | Browser-side board CRUD and summaries over the standard collection API. |
| `src/lib/tasks/` | Browser-side task CRUD, ordering, and note import. |
| `pocketbase/pb_hooks/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users. |
| `pocketbase/pb_migrations/` | Collection schema and API rules. |

## How it works

### Conventions

| Topic | Convention |
| --- | --- |
| Content type | JSON unless the response is a stream, file, or ZIP. |
| Errors | Bun handlers return `{ "error": "message" }` with an HTTP status. PocketBase returns its standard error envelope. |
| Auth failure | Missing or invalid user token (`401`); authenticated non-admin on an admin route (`403`). |
| Rate limit | `429` with `Retry-After` when `settings.rate_limits.enabled` is true. |
| SSE | `/api/chat/send` disables the Bun request timeout and streams the AI SDK UI message protocol. |
| Browser URLs | Always same-origin `/pb`, never `:8090`. |

### Bun routes

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

Conversation list/view/delete are author-scoped by PocketBase rules. Bun creates a conversation with the author derived from the token, and every route forwards the caller's token. Responses include the stored message objects, including any legacy fields tolerated on read.

#### Admin

`POST /api/admin/rate-limits/reload` requires auth and reloads `settings.rate_limits` into the in-memory limiter. It returns `{ success: true, config }`. It is guarded by `verifyAuth()` only, not an admin-role check.

#### Proxy and assets

| Route | Method | Behavior |
| --- | --- | --- |
| `/pb/*` | any | Forward to PocketBase preserving method, headers, query, and body. No side effects. |
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
| `POST /api/trash/move-folder` | `{ "folderId": "id" }` | `{ trashFolderId, movedDocumentIds }` |
| `POST /api/trash/restore-folder` | `{ "trashFolderId": "id" }` | Restores the folder subtree and documents. |
| `POST /api/trash/permanent-delete-folder` | `{ "trashFolderId": "id" }` | Permanently deletes the folder subtree. |

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

Standard PocketBase endpoints under `/api/collections/...` are used by the browser SDK. Boards and tasks have **no custom Bun routes**; they use the standard collection endpoints.

| Collection | Browser path | Access |
| --- | --- | --- |
| `users` | `/pb/api/collections/users/...` | Auth, registration, password reset, email change, OAuth. |
| `folders`, `documents`, `document_versions`, `conversations` | `/pb/api/collections/...` | CRUD governed by collection rules. |
| `boards` | `/pb/api/collections/boards/records` | Author-scoped CRUD; delete only while archived. |
| `tasks` | `/pb/api/collections/tasks/records` | Author-scoped CRUD; create/update require an active board owned by the author. |
| `settings` | `/pb/api/collections/settings/records` | Admin-only key/value store. |
| `trash_*` | `/pb/api/collections/trash_*/records` | Readable but not writable; mutations go through trash routes. |

#### Board records

```json
{
  "name": "Release",
  "description": "Ship the next version",
  "archived": false,
  "author": "user_record_id"
}
```

- `name` is required (max 120); `description` is optional (max 500).
- `archived` defaults to false. Archiving is a normal `PATCH`; there is no separate archive route.
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

- **Boards and tasks are not custom Bun routes.** Use `/pb/api/collections/boards/records` and `/pb/api/collections/tasks/records`; do not add `/api/boards` or `/api/tasks`.
- **`/pb` is a transparent proxy.** It does not add auth, rewrite rules, or run background work. PocketBase decides access.
- **Chat has no `documentIds`.** A request containing extra fields is ignored; only `conversationId`, `message`, and `regenerate` are read.
- **No RAG headers or sources.** Clients must not expect `X-RAG-Sources` or a `sources` field in new assistant messages.
- **Tool errors are model-facing, not HTTP errors.** `list_notes` etc. return `{ ok: false, code, message }` inside the stream; the chat `POST` still succeeds.
- **Persisted tool activity is allowlisted.** Only `CHAT_TOOL_NAMES` entries and `success`/`error` statuses survive `sanitizeTools()`; args and outputs are never stored.
- **Deleting an active board fails.** Archive it first, then delete from `/board/archive`.
- **Task deletion still works on an archived board.** The archived-board rule blocks create/update, not delete; this is intentional so cleanup stays possible.
- **A `403` and a `404` can look identical through tools.** PocketBase hides unauthorized records; `pbGet()` maps both to a generic `not_found`.
- **Rate limits apply before handlers.** `/api/*` and `/pb/*` both pass through `checkRateLimit()`; a `429` includes `Retry-After`.

## Related docs

- [`architecture.md`](architecture.md) — topology, request flow, and data flows.
- [`ai.md`](ai.md) — chat tools, providers, persistence, and failures.
- [`pocketbase.md`](pocketbase.md) — collection rules, migrations, and settings.
- [`security.md`](security.md) — auth layers, proxy safety, and tool isolation.
- [`frontend.md`](frontend.md) — routes and client calls that consume these endpoints.
