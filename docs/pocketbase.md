# PocketBase

PocketBase is the source of truth for data, auth, schema, and server-side behavior. Nana customizes it through JavaScript hooks and migrations in `pocketbase/`.

## Runtime constraints

PocketBase hooks run in the **JSVM**, not Node.js:

- CommonJS `require()` only; no ESM imports.
- Hooks are synchronous; do not use `async`/`await` inside them.
- Environment variables use `$os.getenv()`, not `process.env`.
- The app instance is `$app`; filesystem/path/security helpers are `$os`, `$filepath`, `$security`.
- `toString(...)` converts byte values; `Record` and collection APIs are PocketBase's JS API.
- API request guards only apply to API calls. Internal `$app.save()` / `$app.delete()` bypass them.

## Hook entry point

`pocketbase/pb_hooks/index.pb.js` is the only file PocketBase loads automatically. Every hook module must be required there:

```js
require(`${__hooks}/bootstrap.js`);
require(`${__hooks}/public_sharing_cron.js`);
require(`${__hooks}/documents/calculate_stats.js`);
require(`${__hooks}/documents/create_version.js`);
require(`${__hooks}/routes/trash.js`);
require(`${__hooks}/guards/user_guards.js`);
```

Groups:

| Directory | Contents |
| --- | --- |
| `bootstrap.js` | Seed `site_url` from `SITE_URL`, sync `meta.appURL`, provision the superuser, first-user/signup bootstrap, legacy migration filename compatibility. |
| `documents/` | Word count/reading time and version snapshots. |
| `guards/` | User signup/deletion, trash immutability, version immutability. |
| `mailer/` | Password reset, email change, OTP, auth alert templates. |
| `routes/` | Custom HTTP routes (trash, admin, public shares, check-users). |
| `templates/` | HTML/text email templates. |
| `public_sharing_cron.js` | Clears expired public shares every 15 minutes. |

## Migrations

Files are sequential and zero-padded: `0000001_...` through `0000015_...`. **The next migration is `0000016_<description>.js`.**

Use the migration API, not `module.exports`:

```js
migrate((app) => {
  const collection = app.findCollectionByNameOrId("documents")
  if (!collection.fields.getByName("my_field")) {
    collection.fields.add(new TextField({ name: "my_field" }))
    app.save(collection)
  }
  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("documents")
  if (collection.fields.getByName("my_field")) {
    collection.fields.removeByName("my_field")
    app.save(collection)
  }
  return null
})
```

Rules:

- Always include a safe `down()`.
- Guard additions/removals so retries are idempotent.
- Never rename an existing migration. `bootstrap.js` contains a temporary compatibility hook that rewrites old filenames in the `_migrations` table.
- For data migrations, use `findFirstRecordByFilter` / `findRecordsByFilter` and tolerate missing records when the schema may not be seeded yet.

## Collections

| Collection | Purpose | Notes |
| --- | --- | --- |
| `users` | Auth collection | `admin` boolean; first user is auto-verified and admin. |
| `folders` | Nested folder tree | Self-referencing `parent`; `published` flag retained alongside public-share fields. |
| `documents` | Markdown documents | Content, attachments, tags, stats, folder relation, sharing fields. |
| `document_versions` | Version snapshots | Created when a document is saved with `published = true`. |
| `conversations` | Chat history | Messages stored inline as JSON; author-scoped. |
| `settings` | Admin key/value store | `site_url`, `ai_config`, `embedding_config`, `rate_limits`. |
| `trash_documents` | Trashed documents | Copy of document plus `original_*`, `deleted`, `deleted_at`, `deleted_by`. |
| `trash_folders` | Trashed folders | Copy of folder plus original parent/folder IDs. |
| `trash_document_versions` | Trashed versions | References the trash document; original IDs preserved. |

### Content size limits

`content` is a PocketBase `editor` field. When `maxSize` is `0`, PocketBase applies a hard 5 MB cap and rejects larger saves with `validation_content_size_limit`. Migration `0000015_raise_content_size_limit.js` raises the limit to 100 MB on `documents`, `document_versions`, `trash_documents`, and `trash_document_versions`. Keep all four in sync: a version snapshot with a smaller limit than the document fails to save large notes.

### Document and folder rules

- Documents and folders are author-scoped: `@request.auth.id != '' && author = @request.auth.id`.
- Public sharing does **not** loosen collection rules. Public pages use the dedicated `/api/public/*` routes, which validate tokens and expiry in server code.
- `document_versions` is author-scoped via `document.author = @request.auth.id`; writes are blocked by guards.
- Trash collections are readable by their owner but blocked for create/update/delete through the API.

### Settings keys

| Key | Shape |
| --- | --- |
| `site_url` | `{ url: "https://nana.example.com" }` |
| `ai_config` | `activeProvider`, `providers.{openai,google,ollama}`, generation params, `systemPrompt`, `titlePrompt`. |
| `embedding_config` | `chunkingStrategy`, `chunkSize`, `chunkOverlap`, `topk`, `similarityThreshold`, `embeddingDimensions`, `autoEmbed`. |
| `rate_limits` | `enabled`, `pbMaxPerMinute`, `appMaxPerMinute`. |

The `settings` collection is admin-only. Server-side code reads it with the auto-provisioned superuser token.

SMTP, OAuth, and instance-level settings are stored in PocketBase's built-in app settings (`$app.settings()`), not the `settings` collection. Attachment limits are schema fields on `documents.attachments` and `trash_documents.attachments`.

## Trash pattern

There is no soft-delete flag on live records. Moving to trash:

1. Copy the record into `trash_documents` or `trash_folders` (and versions into `trash_document_versions`).
2. Preserve original IDs, folder relationships, and deletion metadata.
3. Physically delete the original record(s).
4. Restore copies the records back and deletes the trash copies.
5. Permanent delete removes the trash records and their attachments/versions.

Trash routes are in `pocketbase/pb_hooks/routes/trash/`; shared logic lives in `trash_helpers.js`. Guards make the trash collections immutable through the API, so all mutations go through these routes.

## Guards and invariants

| Guard | Behavior |
| --- | --- |
| First user | Auto-assigned `admin = true` and `verified = true`. |
| Signup lock | After the first user exists, `users.createRule` becomes admin-only. |
| Admin grant | Only verified admins may set `admin = true` on another user. |
| Verified deletion | Verified users cannot be deleted. |
| Trash | Direct API create/update/delete on `trash_*` is rejected. |
| Versions | Direct API create/update/delete on `document_versions` is rejected. |

## Versions

`documents/create_version.js` runs on document update:

1. If `published` is not true, do nothing.
2. Load the old record from the database.
3. Compute the next `version_number`.
4. Copy the old content into `document_versions` with a formatted summary and `source_created_at`.
5. Set `published = false` on the document.

Version history is surfaced in the editor's version preview and restore UI. Restores and trash operations are internal, so they bypass the request guards.

## Public sharing

Fields added to `documents` and `folders`:

| Field | Meaning |
| --- | --- |
| `is_public` | Sharing enabled. |
| `public_share_token` | Unique 20-byte hex token. |
| `public_expires_at` | Optional expiry. |
| `is_private` | Hide this record (and, for folders, its entire subtree). |
| `share_attachments` | Allow public attachment downloads. |

Behavior:

- Tokens are generated client-side with `crypto.getRandomValues` (20 bytes → 40 hex chars).
- `ensureActivePublicShare()` rejects missing, private, and expired shares; expired shares are disabled on read.
- Folder shares collect descendant folders and documents, skipping private subtrees/documents.
- A cron runs every 15 minutes to clear expired shares.
- Public attachment routes verify the share, `share_attachments`, and document membership in the shared tree.

## Superuser and bootstrap

On startup (not during `migrate up`):

- If `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` are set, use them.
- Otherwise read `pb_data/superuser_credentials.json`.
- Otherwise generate a random superuser and write the credentials file with mode `0600`.
- The superuser is created/updated in `_superusers`.

The Bun server reads the same credentials to obtain a token for admin-only settings and AI configuration. Never commit this file or log its contents.

`bootstrap.js` also seeds `site_url` from `SITE_URL` and syncs PocketBase `meta.appURL`, which is used for OAuth redirect URIs.

## Adding backend behavior

1. Add or update the schema in a new migration (`0000015+`).
2. Add hooks/routes under the relevant `pb_hooks/` directory.
3. Require the new module from `index.pb.js` (or from a parent module that is already required).
4. Use `requireAdmin(c)`, `parseRequestBody(c)`, `escapeHtml()`, and `sanitizeUrl()` from `utils.js`.
5. Add integration tests under `tests/pocketbase/`.
6. Update this doc and [`api.md`](api.md) if behavior is externally visible.

## Related docs

- [`api.md`](api.md) — PocketBase custom routes and payloads.
- [`security.md`](security.md) — auth, admin checks, public-share safety.
- [`testing.md`](testing.md) — how to test hooks, guards, and routes.
- [`architecture.md`](architecture.md) — where PocketBase sits in the request flow.
