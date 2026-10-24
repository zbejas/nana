# PocketBase — schema, rules, hooks, and migrations

## Overview

PocketBase is the source of truth for data, auth, schema, and server-side behavior. Nana customizes it through JavaScript hooks and append-only migrations in `pocketbase/`. Boards and tasks are ordinary collections; their archive and cascade behavior is enforced by collection rules and relation settings, not by custom routes.

## Key files

| Path | Purpose |
| --- | --- |
| `pocketbase/pb_hooks/index.pb.js` | The only file PocketBase loads automatically; requires every active hook module. |
| `pocketbase/pb_hooks/bootstrap.js` | Seeds `site_url`, syncs `meta.appURL`, provisions the superuser, handles first-user/signup bootstrap and legacy migration filenames. |
| `pocketbase/pb_hooks/documents/` | Word count/reading time and version snapshots. |
| `pocketbase/pb_hooks/guards/` | User signup/deletion, trash immutability, version immutability. |
| `pocketbase/pb_hooks/mailer/` | Password reset, email change, OTP, auth-alert templates. |
| `pocketbase/pb_hooks/routes/` | Custom routes: trash, admin, public shares, check-users. |
| `pocketbase/pb_hooks/templates/` | HTML and text email templates. |
| `pocketbase/pb_hooks/public_sharing_cron.js` | Clears expired public shares every 15 minutes. |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, site/sender helpers. |
| `pocketbase/pb_migrations/0000016_created_tasks.js` | Creates `tasks` with its original author/status/order index. |
| `pocketbase/pb_migrations/0000017_tighten_task_rules.js` | Makes task creation author-scoped. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Creates `boards`, adds the required `tasks.board` relation, backfills tasks, and applies archive rules. |
| `pocketbase/pb_migrations/0000019_remove_embedding_settings.js` | Deletes the obsolete `embedding_config` setting. |
| `pocketbase/pb_migrations/0000015_raise_content_size_limit.js` | Raises editor content limits to 100 MB. |

## How it works

### Runtime constraints

PocketBase hooks run in the **JSVM**, not Node.js:

- CommonJS `require()` only; no ESM imports.
- Hooks are synchronous; do not use `async`/`await` inside them.
- Environment variables use `$os.getenv()`, not `process.env`.
- The app instance is `$app`; filesystem/path/security helpers are `$os`, `$filepath`, `$security`.
- `toString(...)` converts byte values; `Record` and collection APIs are PocketBase's JS API.
- API request guards only apply to API calls. Internal `$app.save()` / `$app.delete()` bypass them.

### Hook entry point

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

### Migrations

Files are sequential and zero-padded. **The next migration is `0000020_<description>.js`.**

| Migration | Purpose |
| --- | --- |
| `0000001_init_users.js` | Users collection and first-user fields. |
| `0000002_created_folders.js` | Folder tree. |
| `0000003_created_trash_collections.js` | Trash document/folder/version collections. |
| `0000004_created_settings.js` | Admin key/value `settings` collection and `site_url`. |
| `0000005_set_smtp_meta.js` | SMTP metadata. |
| `0000006_created_ai_settings.js` | Seed `ai_config`. |
| `0000007_created_chat_collections.js` | `conversations` collection. |
| `0000008_created_rate_limits_setting.js` | Seed `rate_limits`. |
| `0000009_created_embedding_settings.js` | Historical `embedding_config` seed; removed by `0000019`. |
| `0000010_sync_trash_attachment_settings.js` | Keep trash attachment settings aligned. |
| `0000011_preserve_document_version_timestamps.js` | Preserve `source_created_at` on version snapshots. |
| `0000012_add_public_sharing.js` | Public-share fields and tokens. |
| `0000013_add_privacy_and_attachment_sharing.js` | `is_private` and `share_attachments`. |
| `0000014_add_ai_system_prompt.js` | Add `systemPrompt`/`titlePrompt` defaults. |
| `0000015_raise_content_size_limit.js` | Raise editor fields to 100 MB. |
| `0000016_created_tasks.js` | Tasks collection and status/order index. |
| `0000017_tighten_task_rules.js` | Author-scoped task creation. |
| `0000018_created_boards.js` | Boards collection, required task board relation, backfill, archive rules. |
| `0000019_remove_embedding_settings.js` | Delete the obsolete `embedding_config` record. |

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
- For data migrations, use `findRecordsByFilter` and tolerate missing records when the schema may not be seeded yet.
- Migrations are append-only; start the next one at `0000020`.

### Collections

| Collection | Purpose | Notes |
| --- | --- | --- |
| `users` | Auth collection | `admin` boolean; first user is auto-verified and admin. |
| `folders` | Nested folder tree | Self-referencing `parent`; `published` flag retained alongside public-share fields. |
| `documents` | Markdown documents | Content, attachments, tags, stats, folder relation, sharing fields. |
| `document_versions` | Version snapshots | Created when a document is saved with `published = true`. |
| `boards` | Task boards | Author-scoped; name, description, archived flag. |
| `tasks` | Board work items | Author-scoped; required board relation, fixed status set, optional priority/due date/labels, optional source document. |
| `conversations` | Chat history | Messages stored inline as JSON; author-scoped. |
| `settings` | Admin key/value store | `site_url`, `ai_config`, `rate_limits`. |
| `trash_documents` | Trashed documents | Copy of document plus `original_*`, `deleted`, `deleted_at`, `deleted_by`. |
| `trash_folders` | Trashed folders | Copy of folder plus original parent/folder IDs. |
| `trash_document_versions` | Trashed versions | References the trash document; original IDs preserved. |

### Content size limits

`content` is a PocketBase `editor` field. When `maxSize` is `0`, PocketBase applies a hard 5 MB cap and rejects larger saves with `validation_content_size_limit`. Migration `0000015_raise_content_size_limit.js` raises the limit to 100 MB on `documents`, `document_versions`, `trash_documents`, and `trash_document_versions`. Keep all four in sync: a version snapshot with a smaller limit than the document fails to save large notes. The editor warns at 5 MB and switches to a hard-limit message at 100 MB; keep `ContentSizeWarning.tsx` in sync if the migration changes.

### Board schema and rules

`boards` fields:

| Field | Type | Rules |
| --- | --- | --- |
| `name` | Text | Required, max 120. |
| `description` | Text | Optional, max 500. |
| `archived` | Bool | Defaults false. |
| `author` | Relation → `users` | Required, `cascadeDelete: false`, max 1. |
| `created`, `updated` | Autodate | Managed by PocketBase. |

Indexes:

- `idx_boards_author_archived` on `(author, archived)`.
- No separate slug or unique-name constraint; board names are labels, not identifiers.

Rules:

| Operation | Rule |
| --- | --- |
| List / view / create / update | `@request.auth.id != '' && author = @request.auth.id` |
| Delete | `@request.auth.id != '' && author = @request.auth.id && archived = true` |

A board is archived with a normal `PATCH { "archived": true }`. Restore is `PATCH { "archived": false }`. Permanent delete is only possible after archiving and cascades the board's tasks. Tasks deleted this way are not moved to trash.

### Task schema and rules

`tasks` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | Text | Required, max 240. |
| `description` | Editor | Markdown body. |
| `status` | Select | Required: `backlog`, `next`, `progress`, `done`. |
| `priority` | Select | Optional: `low`, `medium`, `high`, `urgent`. |
| `due_date` | Date | Optional. |
| `board_order` | Number | Optional, minimum 0. |
| `labels` | JSON | String array. |
| `author` | Relation → `users` | Required, `cascadeDelete: false`. |
| `board` | Relation → `boards` | Required after `0000018`, `cascadeDelete: true`. |
| `document` | Relation → `documents` | Optional, `cascadeDelete: false`. |

Indexes:

- `idx_tasks_author_status_order` on `(author, status, board_order)` from `0000016`.
- `idx_tasks_board_status_order` on `(board, status, board_order)` from `0000018`.

Rules:

| Operation | Rule |
| --- | --- |
| List / view / delete | `@request.auth.id != '' && author = @request.auth.id` |
| Create / update | `@request.auth.id != '' && author = @request.auth.id && board.author = @request.auth.id && board.archived = false` |

The split is deliberate: an archived board freezes task creation and updates, but the owner can still delete tasks from it. Deleting an active board is rejected before the cascade can run. Deleting an archived board cascades its tasks; deleting a note does not touch tasks that reference it.

`status` and `priority` are single selects. The UI sends `""` for an unset priority. `board_order` is scoped to a column by the client; `persistTaskPositions()` writes only rows whose status or order changed and never sends `board`.

### Archive and permanent-delete lifecycle

1. The board detail edit dialog calls `archiveBoard()` (`PATCH archived: true`).
2. The active index filters `archived = false`; the archive route filters `archived = true`.
3. An archived board detail renders a restore state only; task writes are blocked by rule and the client does not load tasks for it.
4. Restore clears `archived` and leaves every task intact.
5. Permanent delete is exposed only on `/board/archive`, after a `ConfirmDialog`. PocketBase enforces `archived = true` and cascades `tasks.board`.
6. Notes linked through `tasks.document` remain in the library; only the tasks are removed.

### Settings keys

| Key | Shape |
| --- | --- |
| `site_url` | `{ url: "https://nana.example.com" }` |
| `ai_config` | `activeProvider`, `providers.{openai,google,ollama}`, generation params, `systemPrompt`, `titlePrompt`. See [`ai.md`](ai.md). |
| `rate_limits` | `enabled`, `pbMaxPerMinute`, `appMaxPerMinute`. |

`embedding_config` no longer exists after `0000019_remove_embedding_settings.js`. A fresh install seeds it in `0000009` and removes it in `0000019`, so the final database has no record; upgrades delete the existing record. Legacy `pb_data/zvec` files are intentionally not removed by the migration; [`deployment.md`](deployment.md) owns the manual cleanup.

The `settings` collection is admin-only. Server-side code reads it with the auto-provisioned superuser token. Chat tools do not use that token.

SMTP, OAuth, and instance-level settings are stored in PocketBase's built-in app settings (`$app.settings()`), not the `settings` collection. Attachment limits are schema fields on `documents.attachments` and `trash_documents.attachments`.

### Trash pattern

There is no soft-delete flag on live records. Moving to trash:

1. Copy the record into `trash_documents` or `trash_folders` (and versions into `trash_document_versions`).
2. Preserve original IDs, folder relationships, and deletion metadata.
3. Physically delete the original record(s).
4. Restore copies the records back and deletes the trash copies.
5. Permanent delete removes the trash records and their attachments/versions.

Trash routes are in `pocketbase/pb_hooks/routes/trash/`; shared logic lives in `trash_helpers.js`. Guards make the trash collections immutable through the API, so all mutations go through these routes. Tasks and boards do not use this trash flow.

### Guards and invariants

| Guard | Behavior |
| --- | --- |
| First user | Auto-assigned `admin = true` and `verified = true`. |
| Signup lock | After the first user exists, `users.createRule` becomes admin-only. |
| Admin grant | Only verified admins may set `admin = true` on another user. |
| Verified deletion | Verified users cannot be deleted. |
| Trash | Direct API create/update/delete on `trash_*` is rejected. |
| Versions | Direct API create/update/delete on `document_versions` is rejected. |
| Board delete | Only archived boards can be deleted. |
| Task board | Create/update require an authored, active board. |

### Versions

`documents/create_version.js` runs on document update:

1. If `published` is not true, do nothing.
2. Load the old record from the database.
3. Compute the next `version_number`.
4. Copy the old content into `document_versions` with a formatted summary and `source_created_at`.
5. Set `published = false` on the document.

Version history is surfaced in the editor's version preview and restore UI. Restores and trash operations are internal, so they bypass the request guards.

### Public sharing

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

### Superuser and bootstrap

On startup (not during `migrate up`):

- If `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` are set, use them.
- Otherwise read `pb_data/superuser_credentials.json`.
- Otherwise generate a random superuser and write the credentials file with mode `0600`.
- The superuser is created/updated in `_superusers`.

The Bun server reads the same credentials to obtain a token for admin-only settings and AI configuration. Never commit this file or log its contents. Chat read tools never receive this token.

`bootstrap.js` also seeds `site_url` from `SITE_URL` and syncs PocketBase `meta.appURL`, which is used for OAuth redirect URIs.

### Adding backend behavior

1. Add or update the schema in a new migration (`0000020+`).
2. Add hooks/routes under the relevant `pb_hooks/` directory.
3. Require the new module from `index.pb.js` (or from a parent module that is already required).
4. Use `requireAdmin(c)`, `parseRequestBody(c)`, `escapeHtml()`, and `sanitizeUrl()` from `utils.js`.
5. Add integration tests under `tests/pocketbase/`.
6. Update this doc and [`api.md`](api.md) if behavior is externally visible.

## Gotchas & invariants

- **`0000018` backfills only unassigned tasks.** It creates a `boards` row named `My board` per author that actually has a task with `board = ""` (or reuses that author's first existing board if the migration is retried), moves those tasks onto it, then makes the field required. It does not create a default board for every new user.
- **The board field is added optional first.** Existing tasks cannot satisfy a required relation before the backfill. Preserve that order if you ever rewrite the migration.
- **The down migration removes the relation before deleting boards.** Deleting boards first would cascade every task. `0000018` removes the field and index, resets task rules, then deletes the boards collection.
- **Deleting an active board returns an error.** The delete rule requires `archived = true`; the UI only exposes delete on the archive page. Do not “fix” this by loosening the rule.
- **Archived boards block task updates, not deletes.** A `PATCH` on a task whose board is archived fails; `DELETE` still succeeds for the owner. This keeps cleanup possible.
- **`tasks.board` cascades; `tasks.document` does not.** Deleting a board removes its tasks; deleting a note leaves its tasks and their note link dangling.
- **`0000019` is destructive and one-way for custom settings.** It deletes every `embedding_config` record. The `down()` re-seeds defaults, not the previous custom values.
- **Zvec files are not deleted by a migration.** `pb_data/zvec` can survive upgrades; remove it manually after stopping the stack, per [`deployment.md`](deployment.md).
- **Board names are not unique.** `boards` has no unique-name index; two boards can share a name. Do not use the name as an id.
- **Do not add a board/task custom route.** The standard collection endpoints and rules already enforce archive and ownership.

## Related docs

- [`api.md`](api.md) — collection routes and board/task payloads.
- [`architecture.md`](architecture.md) — where PocketBase sits in the request flow.
- [`security.md`](security.md) — auth, admin checks, public-share safety.
- [`testing.md`](testing.md) — guard, route, and migration tests.
- [`deployment.md`](deployment.md) — migration-on-boot and Zvec cleanup.
