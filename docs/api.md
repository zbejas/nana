# API

Nana has two HTTP surfaces:

- **Bun API** — `/api/*`, implemented in `src/api/`, registered in `src/index.ts`.
- **PocketBase API** — collection/auth routes and custom `/api/*` routes inside PocketBase. The browser reaches these through the Bun proxy at `/pb/...`.

All non-public Bun endpoints require a PocketBase user token:

```http
Authorization: <pocketbase-auth-token>
```

`verifyAuth()` validates it against PocketBase `auth-refresh` and returns the user ID. PocketBase collection routes enforce their own API rules; admin routes additionally call `requireAdmin()`.

## Conventions

| Topic | Convention |
| --- | --- |
| Content type | JSON unless the response is a stream, file, or ZIP. |
| Errors | Bun handlers return `{ "error": "message" }` with an HTTP status. PocketBase returns its standard error envelope. |
| Auth failure | Missing or invalid user token (`401`); authenticated non-admin on an admin route (`403`). |
| Rate limit | `429` with `Retry-After` when `settings.rate_limits.enabled` is true. |
| SSE | `/api/chat/send` disables the Bun request timeout and streams the AI SDK UI message protocol. |
| Browser URLs | Always same-origin `/pb`, never `:8090`. |

## Bun routes

### `GET /api/app/version`

Public. Returns:

```json
{
  "currentVersion": "0.2.0",
  "latestVersion": "0.2.0",
  "updateAvailable": false,
  "releasesUrl": "https://github.com/zbejas/nana/releases"
}
```

Reads `package.json`, checks GitHub Releases (falls back to the latest tag), and caches for 15 minutes. Only `GET` is allowed.

### `POST /api/export`

Requires auth. Request:

```json
{
  "documentIds": ["id"],
  "folderIds": ["id"],
  "zipName": "optional-name"
}
```

At least one document or folder is required. A single document with no attachments returns `text/markdown`; everything else returns a ZIP containing Markdown and attachments. Folder exports include descendants. See `src/api/export/`.

### `POST /api/chat/send`

Requires auth. Request:

```json
{
  "conversationId": "optional-existing-id",
  "message": "user text",
  "documentIds": ["optional", "explicit", "rag", "docs"],
  "regenerate": false
}
```

- Omit `conversationId` to create a new conversation. The first message becomes the initial title; a smarter title is generated after the response.
- `documentIds` comes from `#` document mentions. It runs semantic search scoped to those documents and falls back to raw document content if embeddings are unavailable.
- Automatic RAG across all documents is currently disabled in `src/api/chat/index.ts`; `useRag` is present in the request type but the automatic path is not active.
- `regenerate: true` trims the previous user/assistant exchange before re-sending.

The response is an SSE stream using `toUIMessageStreamResponse()` with these headers:

| Header | Meaning |
| --- | --- |
| `X-Conversation-Id` | Conversation to continue. |
| `X-Is-New-Conversation` | `"true"` when a new conversation was created. |
| `X-Model-Name` | Active model name. |
| `X-RAG-Sources` | JSON array of `{ id, title }` when explicit-document RAG produced sources. |

The assistant message is persisted in `onFinish`, including reasoning (when present), sources, and model name. Title generation runs in the background.

### Chat conversations

| Route | Method | Response |
| --- | --- | --- |
| `/api/chat/conversations` | GET | The current user's conversations, newest first. |
| `/api/chat/conversations/:id` | GET | `{ conversation, messages }`. |
| `/api/chat/conversations/:id` | DELETE | `204` on success. |

### Embeddings

All require auth. See [`ai-and-embeddings.md`](ai-and-embeddings.md) for the pipeline.

| Route | Method | Body | Result |
| --- | --- | --- | --- |
| `/api/embeddings/embed` | POST | `{ "documentId": "id", "auto": false }` | `{ success: true, chunksEmbedded }` or `{ success: true, skipped: true }` when auto-embed is disabled. |
| `/api/embeddings/embed-all` | POST | `{}` | `{ success, totalDocuments, totalChunks, errors }` for the current user. |
| `/api/embeddings/search` | POST | `{ "query": "text", "topk": 5 }` | `{ results: [{ documentId, chunkIndex, chunkText, score }] }`, filtered by similarity threshold. |
| `/api/embeddings/status` | GET | — | `{ provider, totalVectors, embeddingModel, dimensions }`. |
| `/api/embeddings/delete` | DELETE | `{ "documentId": "optional" }` | `{ success: true }`; omit `documentId` to delete all embeddings for the user. |

### Admin

`POST /api/admin/rate-limits/reload` requires auth and reloads `settings.rate_limits` into the in-memory limiter. It returns `{ success: true, config }`.

### Proxy and assets

| Route | Method | Behavior |
| --- | --- | --- |
| `/pb/*` | any | Forward to PocketBase preserving method, headers, query, and body. Enables auto-embed/trash embedding sync. |
| `/manifest.webmanifest` | GET | PWA manifest. |
| `/sw.js` | GET | Minimal service worker. |
| `/nana.svg`, `/nana-192.png`, `/nana-512.png` | GET | Icons. |
| `/pdfjs/pdf.worker.min.mjs` | GET | PDF.js worker from `node_modules`. |
| `/*` | GET | Production static files with SPA fallback, or the development HMR entry. |

## PocketBase routes

These paths are shown as PocketBase sees them. From the browser, prefix them with `/pb` (for example `/pb/api/trash/move-document`).

### Public

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/check-users` | GET | `{ hasUsers, totalUsers }`; drives onboarding vs sign-in. |
| `/api/public/documents/:shareToken` | GET | Public document payload. Validates `is_public`, `is_private`, and expiry. |
| `/api/public/documents/:shareToken/files/:filename` | GET | Document attachment when `share_attachments` is true. |
| `/api/public/folders/:shareToken` | GET | Folder tree plus descendant folders/documents. Private subtrees and private documents are skipped. |
| `/api/public/folders/:shareToken/files/:documentId/:filename` | GET | Attachment for a document in a shared folder. |

### Trash

All require a user token and ownership checks.

| Route | Body | Result |
| --- | --- | --- |
| `POST /api/trash/move-document` | `{ "documentId": "id" }` | `{ trashDocumentId }` |
| `POST /api/trash/restore-document` | `{ "trashDocumentId": "id" }` | `{ documentId, folderId }` |
| `POST /api/trash/permanent-delete-document` | `{ "trashDocumentId": "id" }` | Deletes the trash record and its versions. |
| `POST /api/trash/move-folder` | `{ "folderId": "id" }` | `{ trashFolderId, movedDocumentIds }` |
| `POST /api/trash/restore-folder` | `{ "trashFolderId": "id" }` | Restores the folder subtree and documents. |
| `POST /api/trash/permanent-delete-folder` | `{ "trashFolderId": "id" }` | Permanently deletes the folder subtree. |

### Admin

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

Standard PocketBase endpoints under `/api/collections/...` are used by the browser SDK:

- `users` — auth, registration, password reset, email change, OAuth.
- `folders`, `documents`, `document_versions`, `conversations` — CRUD governed by collection rules.
- `settings` — admin-only key/value store.
- `trash_*` — readable but not writable through the API; mutations go through trash routes.

See [`pocketbase.md`](pocketbase.md) for schema, rules, and hooks.

## Public share payloads

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

## Related docs

- [`architecture.md`](architecture.md) — request lifecycle and data flows.
- [`security.md`](security.md) — auth, proxy, rate limiting, CSP.
- [`ai-and-embeddings.md`](ai-and-embeddings.md) — chat and vector pipeline details.
- [`pocketbase.md`](pocketbase.md) — hooks, guards, collections, migrations.
