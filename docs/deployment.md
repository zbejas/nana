# Deployment — build, containers, upgrades, and operations

## Overview

Nana ships as one container with two processes: PocketBase bound to `127.0.0.1:8090` and Bun/Elysia on `:3000`. Only `:3000` is public; PocketBase is loopback-only inside the container. Migrations run before either process starts, so upgrades include schema changes and data backfills.

## Key files

| File | Purpose |
| --- | --- |
| `build.ts` | Bundles `src/**/*.html` into `dist/` with `bun-plugin-tailwind`. |
| `docker/Dockerfile` | Multi-stage image: base, builder, development, testing, production. |
| `docker/docker-entrypoint.sh` | Runs migrations, starts PocketBase and Bun, prefixes logs, handles shutdown. |
| `docker/docker-test-entrypoint.sh` | Resets a disposable database and runs the unit phase plus the phased integration suite. |
| `compose.yml` | Production image, port `3000`, bind-mounted `./pocketbase/pb_data`. |
| `docker/compose.dev.yml` | Development build with source and hook watches, port `3000`; PocketBase stays loopback-only. |
| `docker/compose.test.yml` | Isolated test container; no host ports or volumes. |
| `src/lib/config.ts` | Server environment configuration. |
| `pocketbase/pb_hooks/bootstrap.js` | Superuser, `site_url`, and `meta.appURL` bootstrap. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Boards schema and task backfill. |
| `pocketbase/pb_migrations/0000019_remove_embedding_settings.js` | Deletes the obsolete embedding setting. |
| `pocketbase/pb_migrations/0000020_boards_in_folders.js` | Adds the optional board folder relation, private flag, and author/folder index. |
| `pocketbase/pb_migrations/0000022_relational_remodel.js` | Soft-delete trash, messages records, relation indexes/cascades, and redundant-relation cleanup. |

## How it works

### Build

```bash
bun install
bun run build          # build.ts -> dist/
```

`build.ts` finds HTML entry points under `src/`, bundles with `bun-plugin-tailwind`, writes to `dist/`, and enables splitting. The production build defines `process.env.NODE_ENV` as `production` and `process.env.DEBUG` as `false` for the **client** bundle; server logging still honors the runtime `DEBUG` variable.

Run the built app locally:

```bash
NODE_ENV=production bun src/index.ts
```

Requirements:

- `dist/index.html` must exist.
- PocketBase must be running at `POCKETBASE_URL` (default `http://127.0.0.1:8090`).
- Migrations must already have run once.
- **`git` must be installed and on `PATH`.** Version history shells out to git with argument arrays. The production and development images install it in `app-base`; a bare-metal or custom-container deployment must provide it.

Production detection is `NODE_ENV=production` **and** `existsSync(dist/index.html)`. Without the built files, Bun runs the development SPA.

### Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | Bun server. |
| `POCKETBASE_URL` | `http://127.0.0.1:8090` | Bun → PocketBase. |
| `NANA_VERSIONING_DIR` | `<cwd>/pocketbase/pb_data/versioning` | Bare git repositories for note version history. Keep it inside the persisted `pb_data` volume. |
| `NODE_ENV` | — | Production static serving and logging. |
| `RAM_CACHE` | `false` | Export cache: RAM instead of disk. |
| `PB_SUPERUSER_EMAIL` | generated | Bootstrap superuser. |
| `PB_SUPERUSER_PASSWORD` | generated | Bootstrap superuser. |
| `DEBUG` | `false` | Verbose server logs in production. |
| `SITE_URL` | — | PocketBase bootstrap seeds `site_url` and `meta.appURL`. |
| `TZ` | compose default | Container timezone. |

All Bun-side environment access goes through `src/lib/config.ts`. PocketBase hooks use `$os.getenv()`.

### Docker image

`docker/Dockerfile` has these stages:

| Stage | Purpose |
| --- | --- |
| `app-base` | Bun slim, `git`, and the PocketBase binary downloaded for `TARGETARCH`. |
| `builder` | Install production dependencies and run `bun run build.ts`. |
| `development` | Full source and dev dependencies; runs the development entrypoint. |
| `testing` | Full source; runs the test entrypoint on a disposable database. |
| `production` | Production dependencies, built `dist/`, hooks/migrations, production entrypoint. |

The Bun and PocketBase versions are pinned as `ARG BUN_VERSION` and `ARG PB_VERSION` at the top of `docker/Dockerfile`. Bump those ARGs rather than adding version pins elsewhere.

### Entrypoint

`docker/docker-entrypoint.sh`:

1. Runs `PB_MIGRATING=1 pocketbase migrate up`.
2. Starts PocketBase on `127.0.0.1:8090` (loopback only).
3. Starts Bun (`bun run dev` in development, `bun src/index.ts` in production).
4. Prefixes logs with `[PocketBase]` / `[Bun]`.
5. Traps `SIGTERM`/`SIGINT` and shuts both processes down.

Keep the dual-process and graceful-shutdown behavior. Migrations run on every boot; the entrypoint does not start serving until they finish.

### Compose files

| File | Use |
| --- | --- |
| `compose.yml` | Production; pulls `ghcr.io/zbejas/nana:latest`, exposes `:3000`, mounts `./pocketbase/pb_data`. |
| `docker/compose.dev.yml` | Development; builds the `development` stage, exposes `:3000`, watches `src/`, `pb_hooks/`, `pb_migrations/`. PocketBase stays loopback-only. |
| `docker/compose.test.yml` | Isolated test container; no host ports/volumes; runs the test entrypoint. |

Production compose:

```yaml
services:
  nana:
    image: ghcr.io/zbejas/nana:latest
    ports:
      - "3000:3000"
    volumes:
      - ./pocketbase/pb_data:/app/pocketbase/pb_data
```

Do not publish `8090`. PocketBase listens on the container loopback only, so a published port would not reach it anyway; the app's admin settings are the supported surface. This is deliberate: a public PocketBase port would bypass Elysia's auth, rate limits, and validation.

### Persistence

`pocketbase/pb_data/` contains:

- `data.db` — SQLite database.
- `auxiliary.db` — auxiliary PocketBase data.
- attachments and thumbnails.
- `versioning/` — one bare git repository per note with saved versions (`<noteId>.git`).
- `superuser_credentials.json` — generated credentials when env vars are absent.
- logs and generated types, depending on runtime.
- **Legacy only:** a `zvec/` directory may remain from an older release. Nothing reads or writes it now.

Back up the whole directory before upgrades; `versioning/` is part of the same persistent volume, and deleting it permanently discards note version history. Never mount it into the test container.

### Boards migration and trash behavior

Migration `0000018_created_boards.js` runs automatically on the first boot after upgrading:

1. Creates `boards` and its author/trash-flag index.
2. Adds `tasks.board` as an optional relation.
3. Creates one `My board` per author that has tasks with no board (or reuses that author's first existing board on a retry), then moves those tasks onto it.
4. Makes `tasks.board` required and applies the trash-aware rules.

Existing tasks keep their `status` and `board_order`; only the relation is written. The migration does not create a default board for every user, and it does not touch tasks already assigned to a board.

After the upgrade:

- The timeline, sidebar, and normal folder views show active boards; trashed boards are at `/board/trash` and in the folder view Trash section.
- A private board is still visible to its owner but is hidden from AI chat and MCP.
- Move a board to trash before deleting it forever. PocketBase rejects permanent delete of an active board.
- Permanent delete is available only for trashed boards and cascades their tasks.
- Notes linked through `tasks.document` remain in the library.
- New users create their own boards; there is no automatic default board.

Migration `0000019_remove_embedding_settings.js` deletes the obsolete `embedding_config` record. It does not delete vector files on disk. No embedding service, model, or vector store is used after this release.

Migration `0000020_boards_in_folders.js` adds `boards.folder` as an optional relation (`cascadeDelete: false`), `boards.is_private`, and `idx_boards_author_folder`. It does not move or backfill existing boards: they stay at the workspace root until someone files them. Folder trash rehomes boards to the root instead of deleting them, so the upgrade cannot remove board data.

Migration `0000021_add_board_public_sharing.js` adds the board public-share fields. Existing boards stay unshared. A trashed board’s public link stops serving without deleting the token, so restoring the board restores its previous link.

Migration `0000022_relational_remodel.js` upgrades existing data in place:

- Copies legacy `trash_documents`/`trash_folders` back into `documents`/`folders` as soft-deleted records, reuses their original ids, reuploads attachments, and moves legacy version rows into the then-current `document_versions` store (dropped later by `0000032`).
- Converts `conversations.messages` JSON arrays into `messages` records.
- Drops the legacy trash collections and creates the `trash_documents`/`trash_folders` views.
- Removes `tasks.author`, `document_versions.created_by`, and `folders.published`; ownership now comes from `tasks.board` and `document_versions.document`.
- Adds relation indexes and partial unique indexes on share tokens.
- Rewrites collection rules and `cascadeDelete` flags.

Back up `pb_data` before the first boot on this migration. The `down()` moves soft-deleted rows back into legacy trash collections and restores the removed fields, but it is not a substitute for a backup.

### Upgrades

1. Back up `pocketbase/pb_data/`.
2. Pull the new image/tag.
3. Start the container; the entrypoint runs migrations before serving.
4. Check logs for migration errors and superuser bootstrap.
5. Verify the timeline and sidebar: existing tasks should appear under `My board` (or their existing board), with status and order preserved.
6. Verify the board trash flow: deleting an active board moves it to trash; trashed boards can be restored or deleted forever.
7. Verify boards in folders: create a folder, drag a board into it, and confirm the board remains after trashing the folder (it returns to the root).
8. Verify trash: move a note to trash, confirm it disappears from the library but keeps its id in Trash, restore it, then permanently delete it. Check that its version repository and attachments are gone after permanent delete.
9. Verify version history: save a version, edit the note, save again, open **Version history**, and restore the first version. Confirm the body restores while the title/tags stay.
10. Verify the active AI provider/model in Settings → Workspace → AI. There is nothing to configure for embeddings.

Migration `0000032_remove_document_versions.js` drops the legacy `document_versions` collection and `documents.published` and does not convert old rows. Version history starts empty and begins with the first **Save version** after the upgrade. A `down()` restores the schema, not the discarded data.

Migration `0000035_group_chat.js` adds shared-note chat metadata and rules. Existing conversations are backfilled to `scope = "personal"` with their user-message authors/labels; note conversations are created on first open. There is no operator action beyond the normal migration run, and the `down()` restores the previous rules and drops the added fields.

Migrations are append-only. Do not rename or remove historical migration files; `bootstrap.js` has a temporary compatibility rewrite for old filenames.

#### Manual Zvec cleanup (optional)

Older releases wrote vector files under `pocketbase/pb_data/zvec`. The current app never reads them, and migration `0000019` intentionally leaves them alone. To reclaim disk after confirming the upgrade:

```bash
# 1. Stop the stack
docker compose down

# 2. Back up the whole data directory
tar -czf "nana-pb-data-$(date +%Y%m%d).tar.gz" pocketbase/pb_data

# 3. Remove only the legacy vector directory
rm -rf pocketbase/pb_data/zvec

# 4. Start again
docker compose up -d
```

If you run the processes without compose, stop Bun and PocketBase first. Never remove `pb_data/zvec` before the backup, and never remove the rest of `pb_data`.

### Releases

The version in `package.json` drives `/api/app/version`, the About tab, and releases.

Release flow:

1. Bump `package.json` in a PR (patch for fixes, minor for features, major for breaking).
2. Merge the version change to `master`.
3. `.github/workflows/release.yml` detects the change, builds and pushes the Docker image, then creates tag `<version>` and GitHub release `v<version>` with generated notes.

The workflow is idempotent: if the release already exists it is a no-op, so editing `package.json` without bumping the version never double-releases. Re-run it with `force` checked to rebuild the image for an already-released version.

`.github/workflows/docker-publish.yml` also runs when a GitHub release is published manually. It builds `linux/amd64` and `linux/arm64` images for the `production` target and pushes semver tags (`X.Y.Z`, `X.Y`, `X`) plus `latest` for the default branch to GHCR.

### Operations checklist

- Confirm only `:3000` is published.
- Mount persistent storage at `/app/pocketbase/pb_data`.
- Set `SITE_URL` if email links or OAuth redirects depend on the public URL.
- Set `PB_SUPERUSER_EMAIL`/`PB_SUPERUSER_PASSWORD` in managed deployments, or securely retain the generated credentials file.
- Set `DEBUG=true` temporarily when diagnosing chat provider or tool failures. It enables server-side verbose logs only; the browser bundle is built with `DEBUG=false`.
- Monitor disk for attachments and SQLite. A legacy `zvec/` directory is safe to remove after a backup.
- Restart after changing PocketBase hooks/migrations or the Dockerfile.
- After each upgrade, open `/timeline` and `/board/trash` once to confirm the board data and trash state.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| App serves the dev SPA in production | `NODE_ENV=production` and `dist/index.html` both exist. |
| `502` on `/api/v1/*` | PocketBase is running and `POCKETBASE_URL` is correct. |
| AI calls fail at startup | `ai_config` exists and has an active provider/model. |
| Chat tools return `unauthorized` | The user token expired; sign in again. |
| Chat tools return `not_found` | The record belongs to another user, is missing, or the board is trashed. |
| Task edits fail after an upgrade | The task's board is trashed; restore the board or delete the task. |
| Permanent board delete fails | The board is still active; move it to trash first. |
| Boards missing after an upgrade | Check the `0000018` migration log and whether tasks had an empty `board`. |
| Migrations fail | Check file numbering, syntax, and `_migrations` state; restore the backup before retrying. |
| PDF previews unavailable | `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` exists in the image. |
| Cannot sign in after restore | Superuser credentials in `pb_data` match the expected environment. |
| Disk usage stayed high after removing embeddings | The legacy `pocketbase/pb_data/zvec` directory is still present. |

## Gotchas & invariants

- **Migrations run on boot, not on `migrate up` only.** The entrypoint always runs `migrate up` before starting PocketBase; a failed migration prevents serving.
- **`0000018` backfills only tasks with an empty board.** It creates `My board` per author with such tasks, then enforces the relation. Do not expect an empty board for every user.
- **Trashing is not deleting forever.** Move a board to trash first; permanent delete is blocked for active boards and only cascades tasks once the board is trashed. Notes are never cascaded.
- **`0000019` removes a setting, not files.** Legacy Zvec files remain until the manual cleanup above.
- **`DEBUG` is server-side.** `build.ts` forces the browser define to `false`; setting `DEBUG=true` will not produce browser console debug logs.
- **The test container must never see host `pb_data`.** It deletes and recreates its own database.
- **A missing `dist/index.html` silently serves the dev SPA** even with `NODE_ENV=production`.
- **The image pins the Bun and PocketBase versions in ARGs.** Bumping a dependency in `package.json` alone does not change the runtime.
- **Keep Bun on the 1.4 line or newer.** Bun 1.3.x writes the wrong entry chunk into `dist/index.html` when code splitting is enabled, which produces a blank SPA even though `bun run build` succeeds. The Docker and CI pins are deliberately on 1.4.4; after changing the pin, load `/` and confirm the React root mounts before shipping.

## Related docs

- [`development.md`](development.md) — local commands and workflow.
- [`pocketbase.md`](pocketbase.md) — migrations, bootstrap, schema, and settings.
- [`ai.md`](ai.md) — provider configuration and chat/MCP tool behavior.
- [`security.md`](security.md) — exposure, secrets, and runtime data.
- [`architecture.md`](architecture.md) — process topology and runtime modes.
- [`testing.md`](testing.md) — unit and Docker integration layers and the shipping gate.
