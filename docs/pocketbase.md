# PocketBase — schema, rules, hooks, and migrations

## Overview

PocketBase is the source of truth for data, auth, schema, and server-side behavior. It listens on `127.0.0.1:8090` inside the container and is never a public browser surface; the browser reaches it through the Elysia `/api/v1` facade. Nana customizes PocketBase through JavaScript hooks and append-only migrations in `pocketbase/`.

Notes and folders use **soft delete**: `deleted_at` marks a record as trashed, while the record keeps its id, attachments, versions, and relations. `trash_documents` and `trash_folders` are read-only view collections over that state. Boards archive instead of trashing. Chat messages are records in their own collection, not a JSON blob on the conversation.

## Key files

| Path | Purpose |
| --- | --- |
| `pocketbase/pb_hooks/index.pb.js` | The only file PocketBase loads automatically; requires every active hook module. |
| `pocketbase/pb_hooks/bootstrap.js` | Seeds `site_url`, syncs `meta.appURL`, provisions the superuser, handles first-user/signup bootstrap and legacy migration filenames. |
| `pocketbase/pb_hooks/documents/` | Word count/reading time and version snapshots. |
| `pocketbase/pb_hooks/guards/user_guards.js` | Signup lock, admin grant, verified/owned-user deletion guard. |
| `pocketbase/pb_hooks/guards/relation_guards.js` | Incoming relation checks for documents, folders, boards, tasks, and conversations. |
| `pocketbase/pb_hooks/guards/relation_helpers.js` | Shared ownership, folder-cycle, and task-relation helpers used inside guard callbacks. |
| `pocketbase/pb_hooks/mailer/` | Password reset, email change, OTP, auth-alert templates. |
| `pocketbase/pb_hooks/routes/trash.js` | Registers the soft-delete trash routes. |
| `pocketbase/pb_hooks/routes/trash_helpers.js` | Shared soft-delete, restore, cascade, and board-rehome helpers. |
| `pocketbase/pb_hooks/routes/trash/*.js` | Move, restore, and permanently delete documents/folders. |
| `pocketbase/pb_hooks/routes/public_shares.js` | Public document/folder/board routes. |
| `pocketbase/pb_hooks/routes/public_share_helpers.js` | Share lookup, expiry, serialization, folder-tree, and deleted-record filters. |
| `pocketbase/pb_hooks/templates/` | HTML and text email templates. |
| `pocketbase/pb_hooks/public_sharing_cron.js` | Clears expired public shares every 15 minutes. |
| `pocketbase/pb_hooks/utils.js` | `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl`, `sendError`, site/sender helpers. |
| `pocketbase/pb_migrations/0000022_relational_remodel.js` | Soft-delete trash, messages records, relation indexes/cascades, and removal of redundant relations. |

## How it works

### Runtime constraints

PocketBase hooks run in the **JSVM**, not Node.js:

- CommonJS `require()` only; no ESM imports.
- Hooks are synchronous; do not use `async`/`await` inside them.
- Environment variables use `$os.getenv()`, not `process.env`.
- The app instance is `$app`; filesystem/path/security helpers are `$os`, `$filepath`, `$security`.
- `toString(...)` converts byte values; `Record` and collection APIs are PocketBase's JS API.
- API request guards only apply to API calls. Internal `$app.save()` / `$app.delete()` bypass them.
- Module-scope helper bindings do not survive into hook callbacks. `require()` the helper inside each callback; see `relation_guards.js`.

### Hook entry point

`pocketbase/pb_hooks/index.pb.js` is the only file PocketBase loads automatically. Every hook module must be required there:

```js
require(`${__hooks}/bootstrap.js`);
require(`${__hooks}/public_sharing_cron.js`);
require(`${__hooks}/documents/calculate_stats.js`);
require(`${__hooks}/documents/create_version.js`);
require(`${__hooks}/routes/trash.js`);
require(`${__hooks}/guards/user_guards.js`);
require(`${__hooks}/guards/relation_guards.js`);
```

Groups:

| Directory | Contents |
| --- | --- |
| `bootstrap.js` | Seed `site_url` from `SITE_URL`, sync `meta.appURL`, provision the superuser, first-user/signup bootstrap, legacy migration filename compatibility. |
| `documents/` | Word count/reading time and version snapshots. |
| `guards/` | Signup lock, user deletion, owner locking, folder-cycle prevention, incoming relation ownership. |
| `mailer/` | Password reset, email change, OTP, auth alert templates. |
| `routes/` | Soft-delete trash routes and public share routes. |
| `templates/` | HTML/text email templates. |
| `public_sharing_cron.js` | Clears expired public shares every 15 minutes. |

### Migrations

Files are sequential and zero-padded. **The next migration is `0000032_<description>.js`.**

| Migration | Purpose |
| --- | --- |
| `0000001_init_users.js` | Users collection and first-user fields. |
| `0000002_created_folders.js` | Folder tree and notes. |
| `0000003_created_trash_collections.js` | Historical trash collections; removed by `0000022`. |
| `0000004_created_settings.js` | Admin key/value `settings` collection and `site_url`. |
| `0000005_set_smtp_meta.js` | SMTP metadata. |
| `0000006_created_ai_settings.js` | Seed `ai_config`. |
| `0000007_created_chat_collections.js` | `conversations` collection. |
| `0000008_created_rate_limits_setting.js` | Seed `rate_limits`. |
| `0000009_created_embedding_settings.js` | Historical `embedding_config` seed; removed by `0000019`. |
| `0000010_sync_trash_attachment_settings.js` | Keep historical trash attachment settings aligned. |
| `0000011_preserve_document_version_timestamps.js` | Preserve `source_created_at` on version snapshots. |
| `0000012_add_public_sharing.js` | Public-share fields and tokens. |
| `0000013_add_privacy_and_attachment_sharing.js` | `is_private` and `share_attachments`. |
| `0000014_add_ai_system_prompt.js` | Add `systemPrompt`/`titlePrompt` defaults. |
| `0000015_raise_content_size_limit.js` | Raise editor fields to 100 MB. |
| `0000016_created_tasks.js` | Tasks collection and status/order index. |
| `0000017_tighten_task_rules.js` | Author-scoped task creation. |
| `0000018_created_boards.js` | Boards collection, required task board relation, backfill, archive rules. |
| `0000019_remove_embedding_settings.js` | Delete the obsolete `embedding_config` record. |
| `0000020_boards_in_folders.js` | Add optional `boards.folder`, `boards.is_private`, and `idx_boards_author_folder`. |
| `0000021_add_board_public_sharing.js` | Add `boards.is_public`, `boards.public_share_token`, and `boards.public_expires_at`. |
| `0000022_relational_remodel.js` | Soft-delete trash views, `messages` records, relation indexes/cascades, and redundant-relation removal. |
| `0000023_user_sharing.js` | `shares`, `access_grants`, `comments`, and shared-read rules for documents, folders, boards, and tasks. |
| `0000024_api_keys.js` | `api_keys` collection: hashed long-lived credentials, access/scope fields, folder relation, usage timestamp. |
| `0000025_kanban_foundation.js` | Workflow columns, task status text, assignee/dates/recurrence/numbering, labels, relations, activity, task comments. |
| `0000026_sharing_repair.js` | Grant-only shared reads, permission-shaped write rules, access-grant rebuild, and private-boundary repair. |
| `0000027_chat_edits.js` | Document revisions/actor metadata, message context/sources/stopped, version snapshots, and `chat_edits`. |
| `0000028_kanban_hardening.js` | Repairs missing columns, counters, completion, comments index, and hardened collection rules for existing databases. |
| `0000029_chat_actions.js` | Adds `pending`/`cancelled` chat action statuses and the `folder` edit target. |
| `0000030_chat_attachments.js` | Adds owner-scoped `chat_attachments` with a protected file and `messages.attachments`. |
| `0000031_message_usage.js` | Adds `messages.usage`, the final-step token accounting used by the chat context ring. |

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
- Migrations are append-only; start the next one at `0000032`.
- View collections reject `SELECT *`; list explicit columns. When a source field is added, update the view query in the same migration.

### Collections

| Collection | Purpose | Notes |
| --- | --- | --- |
| `users` | Auth collection | `admin` boolean; first user is auto-verified and admin. |
| `folders` | Nested folder tree | Self-referencing `parent`; soft-delete fields; sharing fields. |
| `documents` | Markdown documents | Content, attachments, tags, stats, folder relation, soft-delete and sharing fields, `revision`, `last_edited_by`, `last_edit_source`. |
| `document_versions` | Version snapshots | Created on publish or AI edit; carries `source`, `snapshot`, `actor_type`, `actor_label`. |
| `boards` | Task boards | Author-scoped; name, description, icon, task counter, archived flag, optional folder, private and public-share fields. |
| `board_columns` | Ordered board workflow | `board`, `name`, stable `slug`, `position`, `icon`, `color`, `is_final`. |
| `tasks` | Board work items | Board-scoped; ownership derives from `board.author`; text `status`, priority, assignee, dates, labels, recurrence, task number, optional source document. |
| `labels` | Owner label definitions | Name + Graphite colour; tasks keep a JSON string array of label names. |
| `task_relations` | Task graph | `source`, `target`, `type` (`subtask|blocks|related`). |
| `task_activity` | Task audit | Task, board, actor, actor type/label, type, JSON data. Server writes only. |
| `conversations` | Chat threads | Author-scoped title, timestamps, rolling summary. |
| `messages` | Chat messages | Role, content, reasoning/model metadata, tool activity, context, attachment refs, sources, token usage, stopped, position. |
| `chat_attachments` | Chat attachment drafts and bound files | Owner-scoped protected file, name/MIME/size/kind, optional conversation/message, server-extracted text. |
| `shares` | Owner-managed direct grants | One row per resource/user; created and updated by the sharing route layer. |
| `access_grants` | Materialized direct + inherited grants | Read-only to the grantee; lets collection rules resolve folder inheritance without recursion. |
| `comments` | Internal comment storage | Targets `document`, `board`, or `task`; custom routes enforce target access and moderation; no public collection rules. |
| `chat_edits` | AI edit audit | Conversation, message, actor, target, tool, operations, summary, status; server writes only. |
| `sharing_repairs` | Grant repair queue | Written by fail-closed sharing/trash transitions and retried by cron. |
| `api_keys` | Long-lived machine credentials | `key_hash` (SHA-256), display prefix, `author`, `access`, `scope`, folder roots, `last_used_at`; no public rules. |
| `settings` | Admin key/value store | `site_url`, `ai_config`, `rate_limits`. |
| `trash_documents` | Read-only view | `documents WHERE deleted_at != ''`. |
| `trash_folders` | Read-only view | `folders WHERE deleted_at != ''`. |

### Relation map

| From | Field | To | Required | `cascadeDelete` | Notes |
| --- | --- | --- | --- | --- | --- |
| `folders` | `author` | `users` | yes | no | Owner; user deletion is blocked while content exists. |
| `folders` | `parent` | `folders` | no | yes | Self tree; hard delete removes descendants, soft delete does not. |
| `folders` | `deleted_by` | `users` | no | no | Audit field. |
| `documents` | `author` | `users` | yes | no | Owner. |
| `documents` | `folder` | `folders` | no | yes | Hard delete of a folder removes its notes; trash uses `deleted_at`. |
| `documents` | `deleted_by` | `users` | no | no | Audit field. |
| `document_versions` | `document` | `documents` | yes | yes | Versions die with the note. |
| `boards` | `author` | `users` | yes | no | Owner. |
| `boards` | `folder` | `folders` | no | no | Folder trash rehomes boards; never delete a board with a folder. |
| `board_columns` | `board` | `boards` | yes | yes | Columns die with the board. |
| `tasks` | `board` | `boards` | yes | yes | Task ownership derives from `board.author`. |
| `tasks` | `assignee` | `users` | no | no | Must already have board access. |
| `tasks` | `document` | `documents` | no | no | Permanent note delete clears the link; trash keeps it for restore. |
| `labels` | `author` | `users` | yes | yes | Owner label definitions. |
| `task_relations` | `source` / `target` | `tasks` | yes | yes | Self-links rejected; edits require source edit + target read. |
| `task_activity` | `task` / `board` | `tasks` / `boards` | yes | yes | Audit rows die with the task/board. |
| `comments` | `document` / `board` / `task` | matching record | no | yes | Exactly one target is expected; custom routes enforce it. |
| `chat_edits` | `conversation` / `message` | conversations / messages | yes / no | yes / yes | AI edit cards and undo; messages die with the conversation. |
| `chat_attachments` | `author` | `users` | yes | yes | Owner; deleting the user removes their attachment rows and files. |
| `chat_attachments` | `conversation` | `conversations` | no | yes | Bound rows die with the conversation. |
| `chat_attachments` | `message` | `messages` | no | yes | Bound rows die with the message. |
| `conversations` | `author` | `users` | yes | yes | Conversations and messages follow the user. |
| `messages` | `conversation` | `conversations` | yes | yes | Messages die with the conversation. |

The trash views mirror `documents` and `folders`; they do not add relations or storage. `tasks.author`, `document_versions.created_by`, and `folders.published` do not exist after `0000022`.

### Content size limits

`content` is a PocketBase `editor` field. When `maxSize` is `0`, PocketBase applies a hard 5 MB cap and rejects larger saves with `validation_content_size_limit`. Migration `0000015_raise_content_size_limit.js` raises the limit to 100 MB on `documents`, `document_versions`, and (through the view) `trash_documents`. Keep them in sync: a version snapshot with a smaller limit than the document fails to save large notes. The editor warns at 5 MB and switches to a hard-limit message at 100 MB; keep `ContentSizeWarning.tsx` in sync if the migration changes.

### Document and folder schema

`documents` fields:

| Field | Type | Rules |
| --- | --- | --- |
| `title` | Text | Required. |
| `slug` | Text | Required; generated from the title. Not a unique identifier. |
| `content` | Editor | Sanitized HTML/Markdown, 100 MB cap. |
| `attachments` | File | Protected; up to 20 files, 50 MB each. |
| `tags` | JSON | String array. |
| `published` | Bool | Version-request flag: set true on update to snapshot the previous content. |
| `author` | Relation → `users` | Required, `cascadeDelete: false`, max 1. |
| `word_count`, `reading_time` | Number | Computed by `documents/calculate_stats.js`. |
| `folder` | Relation → `folders` | Optional, `cascadeDelete: true`, max 1. Empty means the workspace root. |
| `is_private`, `is_public`, `share_attachments` | Bool | AI/privacy and public-share flags. |
| `public_share_token` | Text | Unique partial index over non-empty tokens. |
| `public_expires_at` | Date | Optional expiry. |
| `deleted_at` | Date | Non-empty means the note is in trash. |
| `deleted_by` | Relation → `users` | Optional audit field. |

`folders` fields: `name`, `author`, `color`, `parent`, `is_private`, `is_public`, `share_attachments`, `public_share_token`, `public_expires_at`, `deleted_at`, `deleted_by`, `created`, `updated`. `parent` cascades on hard delete; `deleted_at` drives the trash view.

Indexes:

- `idx_documents_author_deleted_folder` on `(author, deleted_at, folder)`.
- `idx_documents_author_deleted_updated` on `(author, deleted_at, updated)`.
- `idx_documents_share_token` unique partial on `public_share_token` where non-empty.
- `idx_folders_author_deleted_parent` on `(author, deleted_at, parent)`.
- `idx_folders_share_token` unique partial on `public_share_token` where non-empty.

Rules:

| Collection | List / view / update | Create | Delete |
| --- | --- | --- | --- |
| `documents` | `author = @request.auth.id && deleted_at = ''` | `author = @request.auth.id` | `null` (superuser/internal only) |
| `folders` | `author = @request.auth.id && deleted_at = ''` | `author = @request.auth.id` | `null` (superuser/internal only) |
| `document_versions` | `document.author = @request.auth.id && document.deleted_at = ''` | `null` | `null` |
| `trash_documents` / `trash_folders` (views) | `author = @request.auth.id` | read-only | read-only |

Normal API deletes are disabled on documents and folders. `POST /api/trash/move-*` sets the soft-delete fields; permanent delete is a separate route.

### Board schema and rules

`boards` fields:

| Field | Type | Rules |
| --- | --- | --- |
| `name` | Text | Required, max 120. |
| `description` | Text | Optional, max 500. |
| `icon` | Text | Optional board glyph key, max 40. |
| `task_counter` | Number | Allocates board-scoped task numbers; written server-side. |
| `archived` | Bool | Defaults false. |
| `folder` | Relation → `folders` | Optional, `cascadeDelete: false`, max 1. Empty means the workspace root. |
| `is_private` | Bool | Optional. Hides the board from chat and MCP; the owner still sees it. A private board cannot be public. |
| `is_public` | Bool | Optional. Enables the public board route when `is_private` is false. |
| `public_share_token` | Text | Optional, unique partial index over non-empty tokens. |
| `public_expires_at` | Date | Optional. Expired links are disabled on read and by the cleanup cron. |
| `author` | Relation → `users` | Required, `cascadeDelete: false`, max 1. |
| `created`, `updated` | Autodate | Managed by PocketBase. |

Indexes:

- `idx_boards_author_archived` on `(author, archived)`.
- `idx_boards_author_folder` on `(author, folder)`.
- `idx_boards_share_token` unique partial on `public_share_token` where non-empty.

Rules:

| Operation | Rule |
| --- | --- |
| List / view | Owner, or a non-private board with an `access_grants` row for the caller. Direct shares are materialized into grants by `0000026`. |
| Create | `author = @request.auth.id`. |
| Update | Owner or an `edit` grant; owner-only fields are enforced by `sharing/permission_guards.js`. |
| Delete | Owner and `archived = true`. |
| `board_columns` write | Owner only. |

A board is archived with a normal `PATCH { "archived": true }`. Restore is `PATCH { "archived": false }`. Permanent delete is only possible after archiving and cascades the board's tasks and columns. Tasks deleted this way are not moved to trash.

New boards are seeded with four default columns (`backlog`, `next`, `progress`, `done`) by `pb_hooks/boards/seed_columns.js`. A column slug is immutable while tasks reference it; a column cannot be deleted while tasks use it. `tasks.status` stores the column slug, or the virtual `planned`/`archived` statuses used by the backlog.

#### Board folder guard

PocketBase evaluates relation rules against the **stored** record, so the incoming `folder` needs an explicit ownership check. `guards/relation_guards.js` runs on board create and update:

- It skips requests with no auth or superuser auth; internal saves (trash rehoming, migrations) bypass request hooks.
- An empty `folder` is always allowed.
- A missing, trashed, or foreign folder throws `400`/`403`.

The Bun workspace service and the browser facade check the same ownership before a write, so REST, MCP, and `/api/v1/records` get a generic `not_found`; the guard is the second line of defence for direct API calls.

### Task schema and rules

`tasks` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | Text | Required, max 240. |
| `description` | Editor | Markdown body. |
| `status` | Text | Required column slug, or virtual `planned`/`archived`; validated by `tasks/status_guard.js`. |
| `priority` | Select | Optional: `low`, `medium`, `high`, `urgent`. |
| `assignee` | Relation → `users` | Optional; must already have board access. |
| `start_date`, `due_date` | Date | Optional. |
| `completed_at` | Date | Derived from `column.is_final`; cleared when the task leaves a final column. |
| `recurrence` | JSON | Optional recurrence object. |
| `task_number` | Number | Per-board number allocated server-side; not client-writable. |
| `board_order` | Number | Optional, minimum 0; scoped to a column by the client. |
| `labels` | JSON | String array of label names. |
| `board` | Relation → `boards` | Required, `cascadeDelete: true`. |
| `document` | Relation → `documents` | Optional, `cascadeDelete: false`. |

Tasks have no `author` field. Ownership is `board.author`; the board is required and cascades, so a task cannot outlive its board.

Indexes:

- `idx_tasks_board_status_order` on `(board, status, board_order)`.
- `idx_tasks_document` on `(document)`.

Rules:

| Operation | Rule |
| --- | --- |
| List / view | Owner, or a non-private board with an `access_grants` row for the caller. |
| Create / update | Owner or `edit` grant, and `board.archived = false`. |
| Delete | Owner, or an `edit` grant on an active board. |

The split is deliberate: an archived board freezes task creation and updates, but the owner can still delete tasks from it. Deleting an active board is rejected before the cascade can run. Deleting an archived board cascades its tasks; deleting a note clears the `document` link when the note is permanently deleted. Task numbering, completion, and activity are maintained by `pb_hooks/tasks/lifecycle.js` and `record_activity.js`; the unique index `(board, task_number)` prevents duplicate numbers.

PocketBase evaluates relation rules against the **stored** record, not the incoming relation value. Moving a task to another board therefore also passes through `guards/relation_guards.js`, which loads the new `board`, rejects archived boards, and validates a newly set or changed `document` (foreign and trashed notes are rejected). An existing link to a note that was trashed later does not block unrelated task edits. Keep that guard when changing task rules.

`status` and `priority` are single selects. The UI sends `""` for an unset priority. `board_order` is scoped to a column by the client; `persistTaskPositions()` writes only rows whose status or order changed and never sends `board`.

### Archive and permanent-delete lifecycle

1. The board detail settings panel calls `archiveBoard()` (`PATCH archived: true`).
2. The active index filters `archived = false`; the archive route filters `archived = true`.
3. An archived board detail renders a restore state only; task writes are blocked by rule and the client does not load tasks for it.
4. Restore clears `archived` and leaves every task intact.
5. Permanent delete is exposed only on `/board/archive`, after a `ConfirmDialog`. PocketBase enforces `archived = true` and cascades `tasks.board`.
6. Notes linked through `tasks.document` remain in the library; only the tasks are removed.
7. Archiving does not change `folder`. Archived boards keep their folder relation but are excluded from the timeline, sidebar, and folder view until restored.

### Trash pattern

There is no second copy of a note or folder. Moving to trash:

1. Set `deleted_at`, `deleted_by`, `is_public = false`, `public_share_token = ""`, and `public_expires_at = ""`.
2. Leave attachments, versions, ids, and relations in place.
3. Read the trash through the `trash_documents` / `trash_folders` views.
4. Restore clears the soft-delete fields. A note whose folder is still trashed is re-rooted to `""`.
5. Permanent delete removes the live record; versions cascade, attachments are deleted by PocketBase, and task `document` links are cleared first.

Folder soft delete:

- `move-folder` walks the subtree, marks every folder and its active documents, clears shares, and rehomes every board in the subtree to the root.
- `restore-folder` clears the subtree and every document trashed with it. A subtree whose parent is still trashed is re-rooted.
- `permanent-delete-folder` rehomes boards, clears task note links for the subtree, then hard-deletes the root folder. `folders.parent` and `documents.folder` cascade, so the subtree, notes, versions, and attachments go with it.

Tasks and boards do not use trash. Boards archive; deleting an archived board cascades tasks.

### Guards and invariants

| Guard | Behavior |
| --- | --- |
| First user | Auto-assigned `admin = true` and `verified = true`. |
| Signup lock | After the first user exists, `users.createRule` becomes admin-only. |
| Admin grant | Only verified admins may set `admin = true` on another user. |
| Verified deletion | Verified users cannot be deleted. |
| Owned-content deletion | A user that owns documents, folders, or boards cannot be deleted. Conversations cascade. |
| Owner lock | `author` cannot be changed on documents, folders, boards, or conversations. |
| Folder parent | The incoming parent must be owned, not trashed, and must not create a cycle. |
| Folder relation | Documents and boards can only point at the caller's active folders. |
| Task relation | A task's board must be the caller's and active; its note must be the caller's and not trashed. |
| Version writes | `document_versions` create/update/delete rules are `null`; only hooks and trash routes write them. |
| Trash views | `trash_documents` and `trash_folders` are read-only. |

### Versions

`documents/create_version.js` runs on document update:

1. If `published` is not true, do nothing.
2. Load the old record from the database.
3. Compute the next `version_number`.
4. Copy the old content into `document_versions` with a formatted summary and `source_created_at`.
5. Set `published = false` on the document.

Version history is surfaced in the editor's version preview and restore UI. Versions stay under the document while it is trashed; the `document_versions` rules hide them from the owner until the document is restored. Restores and trash operations are internal, so they bypass the request guards.

### Chat messages

`conversations` holds the thread metadata. `messages` holds one row per turn:

| Field | Type | Notes |
| --- | --- | --- |
| `conversation` | Relation → `conversations` | Required, `cascadeDelete: true`. |
| `role` | Select | `user` or `assistant`. |
| `content` | Editor | Sanitized message body. |
| `reasoning` | Text | Optional thinking text. |
| `model` | Text | Optional model identifier, max 120. |
| `tools` | JSON | Sanitized tool names and terminal statuses. |
| `context` | JSON | Optional page metadata `{ type, id, title }` on a user message. |
| `attachments` | JSON | Optional safe attachment refs `{ id, name, mimeType, size, kind }` on a user message. |
| `usage` | JSON | Optional `{ inputTokens, outputTokens, totalTokens, reasoningTokens?, cachedInputTokens? }` on an assistant message, taken from the final model step. |
| `sources` | JSON | Optional server-collected note/board links on an assistant message. |
| `stopped` | Bool | True when the user stopped the stream before it finished. |
| `position` | Number | Display order, minimum 0. Zero is valid, so the field is not `required`. |
| `created` | Autodate | Managed by PocketBase. |

Rules are `@request.auth.id != '' && conversation.author = @request.auth.id` for all operations. Appending a message also touches the conversation so `updated` drives the sidebar order. `trimLastExchange` deletes the newest assistant run and the preceding user turn.

#### Chat attachments

`chat_attachments` stores one protected file per row. It starts unbound (`conversation` and `message` empty) and is bound to the user message after `POST /api/chat/send` persists it.

| Field | Type | Notes |
| --- | --- | --- |
| `author` | Relation → `users` | Required, `cascadeDelete: true`, max 1. |
| `conversation` | Relation → `conversations` | Optional, `cascadeDelete: true`, max 1. |
| `message` | Relation → `messages` | Optional, `cascadeDelete: true`, max 1. |
| `file` | File | Required, protected, max 1, max 50 MB. |
| `name` | Text | Required, max 255; display name only. |
| `mime_type` | Text | Required, max 120; canonical detected type. |
| `size` | Number | Required, minimum 0. |
| `kind` | Select | Required: `image`, `pdf`, or `text`. |
| `text` | Text | Server-extracted text, max 1,000,000 chars; never returned to clients. |
| `created` | Autodate | Managed by PocketBase. |

Indexes: `idx_chat_attachments_author_message` on `(author, message)` and `idx_chat_attachments_conversation` on `(conversation)`.

Rules are `@request.auth.id != '' && author = @request.auth.id` for list, view, create, update, and delete. Only the chat upload route creates rows; the DELETE route removes unbound drafts. Files are protected and fetched with a short-lived PocketBase file token. Deleting a message or conversation cascades its rows and files through the optional relations; there is no background draft sweep, so an abandoned upload stays as an unbound row until the owner deletes it.

### User-to-user sharing

`shares` is the owner-managed grant; `access_grants` materializes direct and inherited access so collection rules do not recurse. Migration `0000026` makes the shared rules grant-only:

- A record is readable by its author or a non-private record with a matching `access_grants` row.
- Direct shares are copied into grants; a private record, a private folder, and every descendant are not shareable with people.
- Update rules require an `edit` grant; task create/update require edit and an active board; task delete allows the owner or an active-board editor.
- `sharing/permission_guards.js` enforces owner-only fields: `author`, `folder`/`parent`, privacy/public-share fields, archive state, and board columns/labels.
- `access_hooks.js` rebuilds grants on create/move/privacy/trash changes. A failed rebuild rolls the record write back; `sharing_repairs` and a cron retry queued repairs.
- `/api/v1/sharing/*` is a session-only proxy. API keys and MCP remain author-scoped and do not see shared records.
- Comments are stored in `comments` and served by custom routes; the collection has no public rules.

### Chat edits and revisions

`documents.revision` is the optimistic-concurrency token. `revision_guard.js` accepts an omitted revision from older clients but rejects a supplied stale one; AI note edits must supply it. Content/title/tags changes bump the revision and stamp `last_edited_by`/`last_edit_source` (`user`, `ai`, or `system`).

`document_versions` snapshots the old title, content, tags, folder, and privacy when `published` is set. AI note writes use `source: "ai"`, `actor_type: "ai"`, `actor_label: "Nana"`, and the same snapshot path. `chat_edits` records the tool, target, operations, summary, and status for the chat's edit cards and undo. `messages.context` stores the open-page metadata attached at send time; `messages.sources` stores server-derived note/board links; `messages.usage` stores the latest assistant turn's final-step token accounting.

### Public sharing

Fields on `documents`, `folders`, and `boards`:

| Field | Meaning |
| --- | --- |
| `is_public` | Sharing enabled. |
| `public_share_token` | Unique partial index over non-empty tokens. |
| `public_expires_at` | Optional expiry. |
| `is_private` | Hide this record from AI surfaces; for documents, folders, and boards, also reject public sharing. For folders, private subtrees are excluded from public folder shares. |
| `share_attachments` | Allow public attachment downloads. Documents and folders only; boards have no files. |
| `deleted_at` | Documents and folders only. Trashed records never resolve a public share. |

Behavior:

- Tokens are generated client-side with `crypto.getRandomValues` (20 bytes → 40 hex chars).
- `ensureActivePublicShare()` rejects missing, private, deleted, and expired shares; expired shares are disabled on read.
- Folder shares collect descendant folders, documents, and active boards with their tasks, skipping private subtrees/documents/boards, archived boards, and trashed records.
- Board shares return the board plus its tasks; archived boards, private boards, and boards without `is_public` return `404`.
- Public board tasks omit `author`, `board`, and the linked `document`; a task’s note keeps its own privacy and share state.
- Trashing a document or folder clears its share fields, so the link stops immediately.
- A cron runs every 15 minutes to clear expired shares.
- Public attachment routes verify the share, `share_attachments`, and document membership in the shared tree. Boards have no attachment route.

### API keys

`api_keys` stores credential metadata for the typed REST API and MCP. The secret itself is never stored.

| Field | Type | Rules |
| --- | --- | --- |
| `name` | Text | Required, max 80. |
| `key_prefix` | Text | Required, max 24. First 16 characters of the secret for display. |
| `key_hash` | Text | Required, max 128. SHA-256 hex, unique index `idx_api_keys_hash`. |
| `access` | Select | Required: `read` or `write`. |
| `scope` | Select | Required: `workspace`, `root`, or `folders`. |
| `folders` | Relation → `folders` | Optional, max 20, `cascadeDelete: false`. Scope roots for `folders`. |
| `last_used_at` | Date | Optional; touched at most once a minute on successful authentication. |
| `author` | Relation → `users` | Required, max 1, `cascadeDelete: true`. Deleting a user removes their keys. |
| `created`, `updated` | Autodate | Managed by PocketBase. |

Collection rules are all `null`: there is no public list, view, create, update, or delete. Bun verifies the caller, then reads or writes the collection with the cached superuser token. The hash lookup and user-token impersonation are the only superuser uses outside settings; the superuser token is never placed in a `ToolContext`.

The key's folder scope is enforced by the workspace services, not by PocketBase rules. The services load the owned folder tree, expand the selected roots, and hide the rest. Deleting or trashing a folder does not delete the key; the stale scope root simply grants nothing.

### Superuser and bootstrap

On startup (not during `migrate up`):

- If `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` are set, use them.
- Otherwise read `pb_data/superuser_credentials.json`.
- Otherwise generate a random superuser and write the credentials file with mode `0600`.
- The superuser is created/updated in `_superusers`.

The Bun server reads the same credentials to obtain a token for admin-only settings, AI configuration, API key lookup/exchange, and server-owned `chat_edits` rows. Never commit this file or log its contents. Chat workspace tools and `ToolContext` never receive this token; chat edit audit rows use it only after the caller's token has proved conversation ownership. A key is exchanged for the key owner's normal user token through impersonation.

`bootstrap.js` also seeds `site_url` from `SITE_URL` and syncs PocketBase `meta.appURL`, which is used for OAuth redirect URIs.

### Adding backend behavior

1. Add or update the schema in a new migration (`0000032+`).
2. Add hooks/routes under the relevant `pb_hooks/` directory.
3. Require the new module from `index.pb.js` (or from a parent module that is already required).
4. Use `requireAdmin(c)`, `parseRequestBody(c)`, `escapeHtml()`, and `sanitizeUrl()` from `utils.js`; admin route catch blocks should return `sendError(c, err, fallbackMessage)` so known failures keep 400/401/403/404.
5. Add integration tests under `tests/pocketbase/`.
6. Update this doc and [`api.md`](api.md) if behavior is externally visible.

## Gotchas & invariants

- **Trash views are views, not tables.** `trash_documents` and `trash_folders` are read-only and do not emit realtime events. Writes go through `/api/trash/*`. Do not add fields directly to a view; update its `viewQuery` in a migration.
- **A soft-delete transition is not a realtime event.** The record stops matching the live collection's list rule, so subscribers receive nothing. The browser explicitly bumps `refreshTriggerAtom` after move/restore/permanent delete and reloads loaded folder lists; other tabs refresh on their next data load.
- **View queries must list columns explicitly.** PocketBase rejects `SELECT *` for view collections. When a document or folder field is added, add it to `createTrashViews` in a new migration if the trash UI needs it.
- **Soft delete bypasses API rules.** `$app`-based routes and helpers must check `deleted_at` themselves. Public share lookup and folder collection do; add the same check to any new internal query.
- **Normal deletes are blocked on documents and folders.** `deleteRule` is `null`; use `POST /api/trash/move-*`, then restore or permanently delete. A direct API `DELETE` is superuser-only.
- **Permanent folder delete is a cascade.** `folders.parent` and `documents.folder` use `cascadeDelete: true`. Soft delete uses `$app.save`, so it never triggers that cascade; permanent delete uses `$app.delete` and intentionally removes the whole subtree.
- **Boards never cascade with folders.** `boards.folder` is `cascadeDelete: false`. Folder trash and permanent delete rehome boards to the root first.
- **Task links do not cascade.** `tasks.document` is `cascadeDelete: false`; permanently deleting a note clears the task's `document` field. Trashing a note keeps the link so a restore restores it.
- **`tasks.author` no longer exists.** Ownership is `board.author`; all task list/view/delete rules use the board relation. Do not reintroduce a second author source of truth.
- **`document_versions.created_by` no longer exists.** The document relation carries the owner. Version writes are superuser/internal only.
- **`folders.published` no longer exists.** Public folders use `is_public` and `public_share_token`. Do not add a second publish flag.
- **Messages are records.** There is no `conversations.messages` JSON field. Append through `src/api/chat/pocketbase.ts`; it also touches the conversation's `updated` timestamp.
- **`messages.position` is optional.** A `required` number field rejects zero in PocketBase, so position 0 is stored in an optional field and always written by the app.
- **Owner changes are rejected by a request guard.** The update rule only sees the stored author. `relation_guards.js` compares the incoming author with the original record.
- **Folder cycles are guarded.** The rule only sees the stored parent; the guard walks the parent chain and rejects self-parenting and deeper cycles.
- **Share tokens are unique by partial index, not by `TextField.unique`.** The old `unique: true` option did not create an index. Empty token values are allowed on many records.
- **User deletion is blocked when content exists.** Documents, folders, and boards do not cascade with the user; conversations and messages do. Delete or permanently remove content first, or keep the account.
- **Trashed versions stay in `document_versions`.** Rules hide them while `document.deleted_at != ''`. Permanent delete removes them through the document cascade; do not copy them to a second collection.
- **API keys are hashed, not encrypted.** `key_hash` is SHA-256 of the full `nana_…` secret. Never add the plaintext, a reversible encoding, or the hash to an API response. The hash lookup uses the superuser only after the key itself is presented.
- **`api_keys` has no public rules.** It is server-managed on purpose. Do not add it to the browser facade allowlist or expose it through a collection route.
- **API keys cascade with the user.** `api_keys.author` uses `cascadeDelete: true`; `api_keys.folders` does not cascade from folders, so a deleted scope root grants nothing.
- **The next migration is `0000032`.** `0000031_message_usage` is the current head; never edit an applied migration in place.

## Related docs

- [`api.md`](api.md) — collection routes, Elysia `/api/v1`, and board/task payloads.
- [`architecture.md`](architecture.md) — where PocketBase sits in the request flow.
- [`security.md`](security.md) — auth, admin checks, relation guards, public-share safety.
- [`testing.md`](testing.md) — guard, route, and migration tests.
- [`deployment.md`](deployment.md) — migration-on-boot and Zvec cleanup.
