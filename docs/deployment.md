# Deployment — build, containers, upgrades, and operations

## Overview

Nana ships as one container with two processes: PocketBase on `:8090` and Bun on `:3000`. Only `:3000` should be public. Migrations run before either process starts, so upgrades include schema changes and data backfills.

## Key files

| File | Purpose |
| --- | --- |
| `build.ts` | Bundles `src/**/*.html` into `dist/` with `bun-plugin-tailwind`. |
| `docker/Dockerfile` | Multi-stage image: base, builder, development, testing, production. |
| `docker/docker-entrypoint.sh` | Runs migrations, starts PocketBase and Bun, prefixes logs, handles shutdown. |
| `docker/docker-test-entrypoint.sh` | Resets a disposable database and runs the phased integration suite. |
| `compose.yml` | Production image, port `3000`, bind-mounted `./pocketbase/pb_data`. |
| `docker/compose.dev.yml` | Development build with source and hook watches, ports `3000` and `8090`. |
| `docker/compose.test.yml` | Isolated test container; no host ports or volumes. |
| `src/lib/config.ts` | Server environment configuration. |
| `pocketbase/pb_hooks/bootstrap.js` | Superuser, `site_url`, and `meta.appURL` bootstrap. |
| `pocketbase/pb_migrations/0000018_created_boards.js` | Boards schema and task backfill. |
| `pocketbase/pb_migrations/0000019_remove_embedding_settings.js` | Deletes the obsolete embedding setting. |

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

Production detection is `NODE_ENV=production` **and** `existsSync(dist/index.html)`. Without the built files, Bun runs the development SPA.

### Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | Bun server. |
| `POCKETBASE_URL` | `http://127.0.0.1:8090` | Bun → PocketBase. |
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
| `app-base` | Bun slim plus the PocketBase binary downloaded for `TARGETARCH`. |
| `builder` | Install production dependencies and run `bun run build.ts`. |
| `development` | Full source and dev dependencies; runs the development entrypoint. |
| `testing` | Full source; runs the test entrypoint on a disposable database. |
| `production` | Production dependencies, built `dist/`, hooks/migrations, production entrypoint. |

The Bun and PocketBase versions are pinned as `ARG BUN_VERSION` and `ARG PB_VERSION` at the top of `docker/Dockerfile`. Bump those ARGs rather than adding version pins elsewhere.

### Entrypoint

`docker/docker-entrypoint.sh`:

1. Runs `PB_MIGRATING=1 pocketbase migrate up`.
2. Starts PocketBase on `0.0.0.0:8090`.
3. Starts Bun (`bun run dev` in development, `bun src/index.ts` in production).
4. Prefixes logs with `[PocketBase]` / `[Bun]`.
5. Traps `SIGTERM`/`SIGINT` and shuts both processes down.

Keep the dual-process and graceful-shutdown behavior. Migrations run on every boot; the entrypoint does not start serving until they finish.

### Compose files

| File | Use |
| --- | --- |
| `compose.yml` | Production; pulls `ghcr.io/zbejas/nana:latest`, exposes `:3000`, mounts `./pocketbase/pb_data`. |
| `docker/compose.dev.yml` | Development; builds the `development` stage, exposes `:3000` and `:8090`, watches `src/`, `pb_hooks/`, `pb_migrations/`. |
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

Do not uncomment `8090:8090` on a public host unless you intentionally want to expose the PocketBase admin UI. Prefer the Bun proxy and the app's admin settings.

### Persistence

`pocketbase/pb_data/` contains:

- `data.db` — SQLite database.
- `auxiliary.db` — auxiliary PocketBase data.
- attachments and thumbnails.
- `superuser_credentials.json` — generated credentials when env vars are absent.
- logs and generated types, depending on runtime.
- **Legacy only:** a `zvec/` directory may remain from an older release. Nothing reads or writes it now.

Back up the whole directory before upgrades. Never mount it into the test container.

### Boards migration and archive behavior

Migration `0000018_created_boards.js` runs automatically on the first boot after upgrading:

1. Creates `boards` and its author/archived index.
2. Adds `tasks.board` as an optional relation.
3. Creates one `My board` per author that has tasks with no board (or reuses that author's first existing board on a retry), then moves those tasks onto it.
4. Makes `tasks.board` required and applies the archive-aware rules.

Existing tasks keep their `status` and `board_order`; only the relation is written. The migration does not create a default board for every user, and it does not touch tasks already assigned to a board.

After the upgrade:

- The board index shows all active boards; the archive is at `/board/archive`.
- Archive a board before deleting it. PocketBase rejects deleting an active board.
- Permanent delete is available only from the archive and cascades that board's tasks.
- Notes linked through `tasks.document` remain in the library.
- New users create their own boards; there is no automatic default board.

Migration `0000019_remove_embedding_settings.js` deletes the obsolete `embedding_config` record. It does not delete vector files on disk. No embedding service, model, or vector store is used after this release.

### Upgrades

1. Back up `pocketbase/pb_data/`.
2. Pull the new image/tag.
3. Start the container; the entrypoint runs migrations before serving.
4. Check logs for migration errors and superuser bootstrap.
5. Verify the board index: existing tasks should appear under `My board` (or their existing board), with status and order preserved.
6. Verify the archive flow: active boards cannot be deleted; archived boards can be restored or deleted forever.
7. Verify the active AI provider/model in Settings → Workspace → AI. There is nothing to configure for embeddings.

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
- After each upgrade, open `/board` and `/board/archive` once to confirm the board data and archive state.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| App serves the dev SPA in production | `NODE_ENV=production` and `dist/index.html` both exist. |
| `502` on `/pb/*` | PocketBase is running and `POCKETBASE_URL` is correct. |
| AI calls fail at startup | `ai_config` exists and has an active provider/model. |
| Chat tools return `unauthorized` | The user token expired; sign in again. |
| Chat tools return `not_found` | The record belongs to another user, is missing, or the board is archived. |
| Task edits fail after an upgrade | The task's board is archived; restore the board or delete the task. |
| Board delete fails | The board is still active; archive it first. |
| Boards missing after an upgrade | Check the `0000018` migration log and whether tasks had an empty `board`. |
| Migrations fail | Check file numbering, syntax, and `_migrations` state; restore the backup before retrying. |
| PDF previews unavailable | `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` exists in the image. |
| Cannot sign in after restore | Superuser credentials in `pb_data` match the expected environment. |
| Disk usage stayed high after removing embeddings | The legacy `pocketbase/pb_data/zvec` directory is still present. |

## Gotchas & invariants

- **Migrations run on boot, not on `migrate up` only.** The entrypoint always runs `migrate up` before starting PocketBase; a failed migration prevents serving.
- **`0000018` backfills only tasks with an empty board.** It creates `My board` per author with such tasks, then enforces the relation. Do not expect an empty board for every user.
- **Archiving is not deleting.** Archive first; permanent delete is blocked for active boards and only cascades tasks once the board is archived. Notes are never cascaded.
- **`0000019` removes a setting, not files.** Legacy Zvec files remain until the manual cleanup above.
- **`DEBUG` is server-side.** `build.ts` forces the browser define to `false`; setting `DEBUG=true` will not produce browser console debug logs.
- **The test container must never see host `pb_data`.** It deletes and recreates its own database.
- **A missing `dist/index.html` silently serves the dev SPA** even with `NODE_ENV=production`.
- **The image pins the Bun and PocketBase versions in ARGs.** Bumping a dependency in `package.json` alone does not change the runtime.

## Related docs

- [`development.md`](development.md) — local commands and workflow.
- [`pocketbase.md`](pocketbase.md) — migrations, bootstrap, schema, and settings.
- [`ai.md`](ai.md) — provider configuration and read-tool behavior.
- [`security.md`](security.md) — exposure, secrets, and runtime data.
- [`architecture.md`](architecture.md) — process topology and runtime modes.
- [`testing.md`](testing.md) — Docker test stack and gate.
