# AGENTS.md — Nana

Nana ("Not Another Notes App") is a self-hosted document workspace: a Bun server, a React 19 SPA, and PocketBase for data, auth, hooks, and admin APIs. The browser talks only to the Bun origin; browser PocketBase requests are proxied through `/pb/*`. Server-side code talks to PocketBase directly.

**Start here, then read the subsystem doc you are touching.** The knowledge base lives in [`docs/`](docs/README.md); [`docs/architecture.md`](docs/architecture.md) is the best orientation.

## Documentation map

| Doc | Covers | Read when… |
| --- | --- | --- |
| [`docs/README.md`](docs/README.md) | Docs index and documentation rules | Finding the right doc |
| [`docs/architecture.md`](docs/architecture.md) | System topology, request flow, data flows, source map | Starting any work |
| [`docs/api.md`](docs/api.md) | Bun API routes, PocketBase routes, request/response shapes | Adding or changing an endpoint |
| [`docs/frontend.md`](docs/frontend.md) | React app, routing, auth, Jotai, editor, UI conventions | Changing UI or client state |
| [`docs/pocketbase.md`](docs/pocketbase.md) | Hooks, migrations, collections, settings, guards, trash, sharing | Changing schema or backend behavior |
| [`docs/ai-and-embeddings.md`](docs/ai-and-embeddings.md) | Chat, providers, RAG, chunking, `@zvec`, auto-embed | Touching AI features |
| [`docs/security.md`](docs/security.md) | Auth layers, proxy, CSP, rate limits, sanitization, secrets | Changing auth, access, or exposure |
| [`docs/testing.md`](docs/testing.md) | Docker test stack, test layout, helpers, conventions | Adding or fixing tests |
| [`docs/deployment.md`](docs/deployment.md) | Build, Docker, compose, releases, operations | Building, shipping, or debugging deploys |
| [`docs/development.md`](docs/development.md) | Local setup, workflow, sharp edges, definition of done | Beginning implementation |

The user-facing install and feature guide is [`README.md`](README.md).

## Repository layout

```text
src/
  index.ts              Bun HTTP server, routes, CSP, graceful shutdown
  frontend.tsx          React entry point (Jotai + AuthProvider)
  App.tsx               React Router, layout, mobile navigation, lazy pages
  api/                  Server handlers: proxy, chat, embeddings, export, version
  components/           UI components (editor, sidebar, folder view, modals, PWA)
  pages/                Route-level pages
  state/                Jotai atoms + data/realtime/lazy-loading hooks
  lib/                  Config, auth, logger, document/folder CRUD, settings
pocketbase/
  pb_hooks/             PocketBase JSVM hooks, routes, guards, mailers, cron
  pb_migrations/        Sequential schema/data migrations
  pb_data/              Runtime data (gitignored except generated types.d.ts)
tests/                  Integration tests (Bun test, real HTTP, Docker only)
docker/                 Dockerfile, entrypoints, dev/test compose files
docs/                   Engineering knowledge base (this map)
```

## Command cheat sheet

| Task | Command | Notes |
| --- | --- | --- |
| Install dependencies | `bun install` | Uses `bun.lock`; Bun is the only package manager. |
| Full dev stack | `docker compose -f docker/compose.dev.yml up --build` | PocketBase + Bun with file-sync watch. Normal development path. |
| Bun dev server only | `bun run dev` | HMR on `:3000`; expects PocketBase at `127.0.0.1:8090`. |
| Production build | `bun run build` | Runs `build.ts`, cleans and writes `dist/`. |
| Production server | `NODE_ENV=production bun src/index.ts` | Requires `dist/index.html` and a running PocketBase. |
| Production container | `docker compose up -d` | Uses `ghcr.io/zbejas/nana:latest`; mounts `./pocketbase/pb_data`. |
| Build production image | `docker build -f docker/Dockerfile --target production .` | Multi-stage build. |
| Integration tests | `docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test` | Fresh PB database, runs `bun test`, exits with the test status. |
| Follow dev logs | `docker compose -f docker/compose.dev.yml logs -f nana` | PocketBase and Bun logs are prefixed. |

There is no separate lint, format, or typecheck script. `tsconfig.json` is strict; `bun run build` must succeed before shipping.

## Architecture at a glance

```text
Browser (same origin only)
  │
  ▼
Bun :3000 ── src/index.ts
  ├── /pb/* ──────────────▶ PocketBase :8090
  │                          ├── collections + API rules
  │                          └── pb_hooks: routes, guards, mailers, cron
  ├── /api/chat/* ────────▶ AI SDK providers + PB conversations
  ├── /api/embeddings/* ──▶ @zvec vectors + PB documents
  ├── /api/export ────────▶ PB documents/attachments → Markdown/ZIP
  ├── /api/app/version ───▶ GitHub Releases API
  └── /* ─────────────────▶ React SPA (dev: HMR, prod: dist/)
```

## Non-negotiable rules

1. **Read the relevant doc before editing code.** [`docs/README.md`](docs/README.md) tells you which one.
2. **The code wins over docs.** If they disagree, fix the doc in the same change.
3. **Update docs with behavior.** Routes, schema, config, commands, or architecture changes update the affected doc(s) and any index links.
4. **Never touch `pocketbase/pb_data/`** except the generated `types.d.ts`. It contains the live SQLite database, attachments, vector store, and credentials. Tests use a disposable copy.
5. **No destructive git.** No `git reset --hard`, `git checkout --`, forced cleans, or deleting unmerged branches without preserving the work first.
6. **All browser PocketBase access goes through `/pb`.** Client code uses the PocketBase SDK at `/pb`; server code uses `serverConfig.pocketbaseUrl`.
7. **Use `verifyAuth()` for protected Bun APIs** and `requireAdmin()` for admin-only PocketBase routes.
8. **Use `serverConfig` / `clientConfig`** from `src/lib/config.ts`; never read `process.env` elsewhere.
9. **Use `createLogger()`** instead of `console.log` in application code.
10. **Call `useDocumentData()` exactly once**, in `AppContent` (`src/App.tsx`). Never call it in a child component.
11. **Register every new PocketBase hook or route** in its parent module and in `pocketbase/pb_hooks/index.pb.js`.
12. **Migrations are append-only**, numbered `0000015+`, with a safe `down()` and idempotent guards. Never rename existing migration files.
13. **Preserve the streaming and fire-and-forget paths**: SSE chat, realtime PB proxy, auto-embed, and export caching.
14. **No secrets in the repo.** Use environment variables and the generated credentials file under `pb_data/`.
15. **Verify the change.** Run the Docker integration suite for behavior changes; check desktop and mobile for UI changes; build before shipping.

## Workflow

1. **Recon** — inspect the relevant code and current git state. Do not assume old notes are current.
2. **Plan** — for multi-file work, write a short todo list and identify cross-cutting changes (migration → hook → proxy/API → atoms/hooks → components → tests).
3. **Implement** — follow existing patterns, keep the change scoped, and avoid unrelated refactors.
4. **Verify** — run the test suite for behavior changes, build with `bun run build`, and check UI on desktop and mobile.
5. **Report** — list changed files, what was verified, and any remaining risk or follow-up.

For larger tasks, delegate research or isolated implementation slices to subagents and review their output.

## Definition of done

- The behavior is implemented and matches the existing architecture.
- Relevant docs in `docs/` (and `README.md` for user-facing changes) are updated.
- Integration tests are added or updated for API, hook, guard, migration, trash, or share changes.
- `bun run build` succeeds; the Docker test suite passes when behavior changed.
- No generated files, runtime data, secrets, or unrelated changes are included.
