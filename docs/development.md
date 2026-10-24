# Development

## Prerequisites

- **Bun** — runtime, package manager, and build tool.
- **Docker + Compose** — the supported way to run PocketBase + Bun together and to run integration tests.
- Optional: a local PocketBase binary if you prefer not to use the dev container.

Install dependencies:

```bash
bun install
```

## Running locally

### Full stack (recommended)

```bash
docker compose -f docker/compose.dev.yml up --build
```

- Bun: <http://localhost:3000>
- PocketBase admin: <http://localhost:8090>
- Watch sync: `src/`, `pb_hooks/`, `pb_migrations/`
- Rebuild: `package.json` or Dockerfile changes

The container mounts `pocketbase/pb_data`, so local data persists between runs.

### Bun only

```bash
bun run dev
```

This starts `bun --hot src/index.ts` on `:3000` and expects PocketBase at `127.0.0.1:8090`. It does **not** start PocketBase. Use this only if you already have PocketBase running with the repo's hooks and migrations.

### Production build locally

```bash
bun run build
NODE_ENV=production bun src/index.ts
```

`NODE_ENV=production` alone is not enough; `dist/index.html` must exist or the server stays in development mode.

## Verification

| Change | Minimum verification |
| --- | --- |
| Docs/comments only | Link check, no build needed. |
| TS/JS code | `bun run build`; run the affected tests. |
| Behavior change | Full Docker integration suite. |
| PocketBase hook/migration/guard/route | Full Docker integration suite + updated tests. |
| UI | Build, run the dev stack, check desktop and mobile. |
| Docker/build/release | Build the image and run the production target if possible. |

Integration suite:

```bash
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

## Code conventions

- **TypeScript strict mode**, ESM, browser + Bun targets. No `any` unless the surrounding code already uses it for an external boundary.
- **Config:** read `serverConfig` / `clientConfig` from `src/lib/config.ts`; never read `process.env` elsewhere.
- **Logging:** `createLogger("Module")` from `src/lib/logger.ts`; no raw `console.log` in application code.
- **Server errors:** return JSON `{ error }` with an appropriate status; log details with the module logger.
- **Auth:** `verifyAuth()` on protected Bun routes; `requireAdmin()` on admin PocketBase routes.
- **Frontend state:** Jotai atoms; use `useAtomValue` / `useSetAtom`; keep `useDocumentData()` at `AppContent` only.
- **Styling:** Theme-aware Tailwind utilities over the Ember & Ink tokens; reuse `src/components/ui/` before adding a primitive. See [`../DESIGN.md`](../DESIGN.md).
- **PocketBase hooks:** CommonJS `require()`, synchronous, `$os.getenv()`, `$app`.
- **Migrations:** append-only; the next free number is `0000018`. Use `migrate((app) => {}, (app) => {})`, a safe `down()`, and idempotent guards.

## Common tasks

### Add a Bun API route

1. Add the handler under `src/api/<area>/`.
2. Register the path in `src/index.ts` (inside `routes`).
3. Call `verifyAuth()` unless the route is intentionally public.
4. Add rate limiting if it is expensive or exposed.
5. Add tests under `tests/api/`.
6. Update [`api.md`](api.md) and the route list in [`architecture.md`](architecture.md) if the surface changed.

### Add a PocketBase hook or route

1. Create the module under the relevant `pocketbase/pb_hooks/` directory.
2. `require()` it from its parent module and ensure that parent is required by `index.pb.js`.
3. Use `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl` from `utils.js`.
4. Add tests under `tests/pocketbase/`.
5. Update [`pocketbase.md`](pocketbase.md) and [`api.md`](api.md) for new routes.

### Change UI

1. Read [`../DESIGN.md`](../DESIGN.md) and reuse the primitives in `src/components/ui/`.
2. Use semantic tokens (`bg-surface`, `border-line`, `text-ink`, `bg-ember-soft`); no raw colour families or `dark:`/`light:` variants.
3. Check the change in both themes and at a mobile width.
4. If the change introduces a modal, use `Dialog` (or `Sheet` on touch) so focus, Escape, scroll lock, and stacking stay consistent.
5. Update [`frontend.md`](frontend.md) when routes, state, or component structure change.

### Add a migration

1. Create `pocketbase/pb_migrations/0000018_<description>.js`.
2. Use the `migrate(up, down)` format.
3. Guard field/collection additions and removals.
4. Include a real `down()`.
5. Verify against a fresh test database; never edit an already-applied migration.
6. Update [`pocketbase.md`](pocketbase.md) if schema or settings behavior changes.

### Add a frontend feature

1. Decide whether state belongs in Jotai (`src/state/atoms.ts`) or local component state.
2. Reuse existing data hooks; do not add a second initial loader.
3. Keep realtime/lazy-loading behavior intact.
4. Use `createLogger` in client modules.
5. Check keyboard access, focus handling, empty/loading/error states, and mobile layout.
6. Update [`frontend.md`](frontend.md) if the architecture or conventions change.

### Change AI or embeddings behavior

1. Read [`ai-and-embeddings.md`](ai-and-embeddings.md) first.
2. Keep auto-embed fire-and-forget.
3. Keep `userId` filtering in every Zvec query.
4. Handle missing provider/model configuration with actionable errors.
5. Add or update tests; verify with `DEBUG=true` when diagnosing.

## Sharp edges

- **Production needs both** `NODE_ENV=production` and `dist/index.html`. Missing `dist` silently runs the dev SPA.
- **`bun run dev` does not start PocketBase.** Use the dev compose stack unless you already have PocketBase running.
- **SSE needs `server.timeout(req, 0)`.** Chat and PocketBase realtime connections are cut off otherwise.
- **Zvec holds native RocksDB locks.** HMR disposes collections; `SIGTERM`/`SIGINT` closes them. Don't bypass either.
- **Superuser credentials are bootstrapped.** Tests read `pb_data/superuser_credentials.json`; changing env credentials changes the login.
- **Migration compatibility hook:** old filenames are rewritten in `_migrations` on startup. Don't rename historical migrations.
- **Automatic RAG is disabled.** Only explicit `documentIds` from `#` mentions trigger retrieval.
- **The test container resets its database.** Never mount host `pb_data` into the test compose.
- **`src/api/admin/rate-limits/reload` is auth-only**, not role-checked. Be deliberate if you change or rely on it.
- **No destructive git.** No `git reset --hard`, `git checkout --`, forced cleans, or deleting unmerged branches without preserving the work first.

## Git and change hygiene

- Keep changes scoped to the task.
- Do not commit `dist/`, `node_modules/`, `cache/`, logs, or `pocketbase/pb_data/` (except `types.d.ts`).
- Preserve unmerged work before deleting branches; archive it if necessary.
- If a task is partial, say so explicitly in the report rather than leaving a placeholder/TODO-only commit.

## Working with subagents

For larger tasks:

- Delegate research across disjoint areas to an `explore` agent.
- Delegate isolated implementation or verification slices to a `general` agent.
- Keep orchestration, cross-cutting decisions, and final review in the main session.
- Give each subagent the relevant doc path and file boundaries.
- Review their output; do not assume a subagent's summary is correct.

## Related docs

- [`architecture.md`](architecture.md) — system map and request flow.
- [`testing.md`](testing.md) — test stack and conventions.
- [`deployment.md`](deployment.md) — build and release details.
- [`pocketbase.md`](pocketbase.md) — hook/migration rules.
- [`frontend.md`](frontend.md) — React/Jotai conventions.
