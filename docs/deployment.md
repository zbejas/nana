# Deployment

Nana ships as one container with two processes: PocketBase on `:8090` and Bun on `:3000`. Only `:3000` should be public.

## Build

```bash
bun install
bun run build          # build.ts -> dist/
```

`build.ts` finds `src/**/*.html`, bundles with `bun-plugin-tailwind`, writes to `dist/`, and enables splitting. Production define values force `process.env.NODE_ENV` and `DEBUG` for the client bundle.

Run the built app locally:

```bash
NODE_ENV=production bun src/index.ts
```

Requirements:

- `dist/index.html` must exist.
- PocketBase must be running at `POCKETBASE_URL` (default `http://127.0.0.1:8090`).
- Migrations must already have run once.

Production detection is `NODE_ENV=production` **and** `existsSync(dist/index.html)`. Without the built files, Bun runs the development SPA.

## Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | Bun server. |
| `POCKETBASE_URL` | `http://127.0.0.1:8090` | Bun → PocketBase. |
| `NODE_ENV` | — | Production static serving and logging. |
| `RAM_CACHE` | `false` | Export cache: RAM instead of disk. |
| `PB_SUPERUSER_EMAIL` | generated | Bootstrap superuser. |
| `PB_SUPERUSER_PASSWORD` | generated | Bootstrap superuser. |
| `DEBUG` | `false` | Verbose logs in production. |
| `SITE_URL` | — | PocketBase bootstrap seeds `site_url` and `meta.appURL`. |
| `TZ` | compose default | Container timezone. |

All Bun-side environment access goes through `src/lib/config.ts`. PocketBase hooks use `$os.getenv()`.

## Docker image

`docker/Dockerfile` has five stages:

| Stage | Purpose |
| --- | --- |
| `app-base` | Bun slim + PocketBase binary downloaded for `TARGETARCH`. |
| `builder` | Install production dependencies and run `bun run build.ts`. |
| `development` | Full source, dev dependencies, runs the dev entrypoint. |
| `testing` | Full source, runs the test entrypoint on a disposable database. |
| `production` | Production dependencies, built `dist/`, hooks/migrations, entrypoint. |

Bun and PocketBase versions are pinned at the top of the file:

```dockerfile
ARG BUN_VERSION=1.3.13
ARG PB_VERSION=0.37.2
```

Bump those ARGs rather than adding version pins elsewhere.

### Entrypoint

`docker/docker-entrypoint.sh`:

1. Runs `PB_MIGRATING=1 pocketbase migrate up`.
2. Starts PocketBase on `0.0.0.0:8090`.
3. Starts Bun (`bun run dev` in development, `bun src/index.ts` in production).
4. Prefixes logs with `[PocketBase]` / `[Bun]`.
5. Traps `SIGTERM`/`SIGINT` and shuts both processes down.

Keep the dual-process and graceful-shutdown behavior.

## Compose files

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

## Persistence

`pocketbase/pb_data/` contains:

- `data.db` — SQLite database.
- `auxiliary.db` — auxiliary PocketBase data.
- attachments and thumbnails.
- `zvec/` — vector collections.
- `superuser_credentials.json` — generated credentials when env vars are absent.
- logs/types, depending on runtime.

Back up the whole directory before upgrades. Never mount it into the test container.

## Releases

The version in `package.json` drives `/api/app/version` and the About tab.

Release flow:

1. Bump `package.json`.
2. Merge the version change.
3. Create a matching Git tag and GitHub release.
4. Publishing the release triggers `.github/workflows/docker-publish.yml`.

The workflow builds `linux/amd64` and `linux/arm64` images for the `production` target and pushes semver tags plus `latest` for the default branch to GHCR.

## Upgrades

1. Back up `pocketbase/pb_data/`.
2. Pull the new image/tag.
3. Start the container; the entrypoint runs migrations before serving.
4. Check logs for migration errors and superuser bootstrap.
5. Verify AI/embeddings settings if the version changed provider behavior.

Migrations are append-only. Do not rename or remove historical migration files; `bootstrap.js` has a temporary compatibility rewrite for old filenames.

## Operations checklist

- Confirm only `:3000` is published.
- Mount persistent storage at `/app/pocketbase/pb_data`.
- Set `SITE_URL` if email links or OAuth redirects depend on the public URL.
- Set `PB_SUPERUSER_EMAIL`/`PB_SUPERUSER_PASSWORD` in managed deployments, or securely retain the generated credentials file.
- Set `DEBUG=true` temporarily when diagnosing AI, RAG, or embedding failures.
- Monitor disk for attachments, SQLite, and the Zvec directory.
- Restart after changing PocketBase hooks/migrations or the Dockerfile.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App serves the dev SPA in production | `NODE_ENV=production` and `dist/index.html` both exist. |
| `502` on `/pb/*` | PocketBase is running and `POCKETBASE_URL` is correct. |
| AI calls fail at startup | `ai_config` exists and has an active provider/model. |
| Embeddings fail | `embedding_config`, provider embedding model, dimensions, and logs. |
| Zvec lock/error on restart | Old process still running or HMR did not close collections; restart cleanly. |
| PDF previews unavailable | `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` exists in the image. |
| Cannot sign in after restore | Superuser credentials in `pb_data` match the expected environment. |
| Migrations fail | Check file numbering, syntax, and `_migrations` state; restore the backup before retrying. |

## Related docs

- [`development.md`](development.md) — local commands and workflow.
- [`pocketbase.md`](pocketbase.md) — migrations, bootstrap, and settings.
- [`security.md`](security.md) — exposure, secrets, and runtime data.
- [`architecture.md`](architecture.md) — process topology and runtime modes.
