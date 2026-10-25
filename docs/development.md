# Development — setup, workflow, and sharp edges

## Overview

Nana is developed against a real PocketBase and a real Bun server. Use the Docker dev stack for normal work; the Bun-only path is for people who already run PocketBase with the repo's hooks and migrations.

## Key files

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Routing map, non-negotiable rules, command cheat sheet. |
| `docs/README.md` | Documentation index and rules. |
| `package.json` | Scripts and dependencies; the only package manager is Bun. |
| `bunfig.toml` | Bun/Tailwind plugin configuration. |
| `build.ts` | Production bundle. |
| `docker/compose.dev.yml` | Recommended local stack. |
| `docker/compose.test.yml` | Isolated Docker test stack. |
| `tests/unit/` | Pure-function unit tests. |
| `tests/helpers/setup.ts` | Auth and HTTP environment for integration tests. |
| `tests/helpers/client.ts` | Status-asserting HTTP and PocketBase collection helpers. |
| `tests/helpers/factories.ts` | Isolated users and records for integration tests. |

## How it works

### Prerequisites

- **Bun** — runtime, package manager, and build tool.
- **Docker + Compose** — the supported way to run PocketBase + Bun together and to run integration tests.
- Optional: a local PocketBase binary if you prefer not to use the dev container.

Install dependencies:

```bash
bun install
```

### Running locally

Full stack (recommended):

```bash
docker compose -f docker/compose.dev.yml up --build
```

- Bun: <http://localhost:3000>
- PocketBase admin: <http://localhost:8090>
- Watch sync: `src/`, `pb_hooks/`, `pb_migrations/`
- Rebuild: `package.json` or Dockerfile changes

The container mounts `pocketbase/pb_data`, so local data persists between runs.

Bun only:

```bash
bun run dev
```

This starts `bun --hot src/index.ts` on `:3000` and expects PocketBase at `127.0.0.1:8090`. It does **not** start PocketBase. Use it only if PocketBase is already running with the repo's hooks and migrations.

Production build locally:

```bash
bun run build
NODE_ENV=production bun src/index.ts
```

`NODE_ENV=production` alone is not enough; `dist/index.html` must exist or the server stays in development mode.

### Verification

| Change | Minimum verification |
| --- | --- |
| Docs/comments only | Relative-link and path check; no build needed. |
| Pure logic / helper | `bun run test:unit` and `bun run build`. |
| TS/JS code | `bun run build`; run the affected tests. |
| Behavior change | Full Docker suite (`bun run test:docker`). |
| PocketBase hook/migration/guard/route | Full Docker suite + updated tests. |
| Board or task behavior | Board/task guard tests and the board pages on desktop and mobile. |
| Chat or tool behavior | `tests/api/chat-tools.test.ts` plus the chat API tests. |
| UI | Build, run the dev stack, check desktop and mobile in both themes. |
| Docker/build/release | Build the image and run the production target if possible. |

Unit tests:

```bash
bun run test:unit
```

Integration suite:

```bash
bun run test:docker
```

The suite is the gate for behavior changes. `bun run build` is the gate for shipping.

### Code conventions

- **TypeScript strict mode**, ESM, browser + Bun targets. No `any` unless the surrounding code already uses it for an external boundary.
- **Config:** read `serverConfig` / `clientConfig` from `src/lib/config.ts`; never read `process.env` elsewhere.
- **Logging:** `createLogger("Module")` from `src/lib/logger.ts`; no raw `console.log` in application code.
- **Server errors:** return JSON `{ error }` with an appropriate status; log details with the module logger.
- **Auth:** `verifyAuth()` on protected Bun routes; `requireAdmin()` on admin PocketBase routes.
- **Frontend state:** Jotai atoms; use `useAtomValue` / `useSetAtom`; keep `useDocumentData()` at `AppContent` only. Board tasks are route-local in `useBoardState`.
- **Styling:** theme-aware Tailwind utilities over the Graphite tokens; reuse `src/components/ui/` before adding a primitive. See [`../DESIGN.md`](../DESIGN.md).
- **PocketBase hooks:** CommonJS `require()`, synchronous, `$os.getenv()`, `$app`.
- **Migrations:** append-only; the next free number is `0000020`. Use `migrate((app) => {}, (app) => {})`, a safe `down()`, and idempotent guards.

### Common tasks

#### Add a Bun API route

1. Add the handler under `src/api/<area>/`.
2. Register the path in `src/index.ts` (inside `routes`).
3. Call `verifyAuth()` unless the route is intentionally public.
4. Add rate limiting if it is expensive or exposed.
5. Add tests under `tests/api/`; pure helpers also get a `tests/unit/` case.
6. Update [`api.md`](api.md) and the route list in [`architecture.md`](architecture.md) if the surface changed.

#### Add a PocketBase hook or route

1. Create the module under the relevant `pocketbase/pb_hooks/` directory.
2. `require()` it from its parent module and ensure that parent is required by `index.pb.js`.
3. Use `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl` from `utils.js`.
4. Add tests under `tests/pocketbase/`; use the factories in `tests/helpers/factories.ts`.
5. Update [`pocketbase.md`](pocketbase.md) and [`api.md`](api.md) for new routes.

#### Change UI

1. Read [`../DESIGN.md`](../DESIGN.md) and reuse the primitives in `src/components/ui/`.
2. Use semantic tokens (`bg-surface`, `border-line`, `text-ink`, `bg-signal-soft`, `text-signal`); no raw colour families, `dark:`/`light:` variants, gradients, blur, or serif faces.
3. Check the change in both themes and at a mobile width.
4. If the change introduces a modal, use `Dialog` (or `Sheet` on touch) so focus, Escape, scroll lock, and stacking stay consistent.
5. Update [`frontend.md`](frontend.md) when routes, state, or component structure changes.

#### Add a migration

1. Create `pocketbase/pb_migrations/0000020_<description>.js`.
2. Use the `migrate(up, down)` format.
3. Guard field/collection additions and removals.
4. Include a real `down()`.
5. Verify against a fresh test database; never edit an already-applied migration.
6. Update [`pocketbase.md`](pocketbase.md) if schema or settings behavior changes.

#### Change boards or tasks

1. Read [`pocketbase.md`](pocketbase.md) for the board/task rules and [`frontend.md`](frontend.md) for the UI split.
2. Keep `boards` and `tasks` on the standard PocketBase collection endpoints; there is no custom Bun board API.
3. Preserve the required `tasks.board` relation and the archive-first delete rule.
4. If you change the backfill, keep `0000018`'s order: optional relation → backfill → required relation → rules.
5. Remember that deleting an archived board cascades tasks but never notes.
6. Update `tests/pocketbase/guards/03-task-rules.test.ts` and `04-board-rules.test.ts`, then run the Docker suite.

#### Change AI or read tools

1. Read [`ai.md`](ai.md) first.
2. Keep tools read-only and scoped to `context.authHeader` / `context.userId`. Never use the superuser token for tools.
3. Add or preserve author scoping: filter lists on `author`, and verify `record.author` on single-record reads, even when PocketBase rules also enforce it.
4. Keep queries bounded (`perPage`, line windows, byte caps) and keep the 8-second tool timeout.
5. If you add or rename a tool, update `CHAT_TOOL_NAMES` in `src/api/chat/tools/index.ts` and the label map in `src/pages/ChatPage.tsx`; persisted activity is allowlisted.
6. Persist only `{ name, status }` for tool activity; never inputs, outputs, or note text.
7. Keep `stopWhen(stepCountIs(8))` unless you have measured the read fan-out; the default stops after one step.
8. Handle missing provider/model configuration with actionable errors.
9. Add or update `tests/api/chat-tools.test.ts`; verify with `DEBUG=true` when diagnosing provider failures.

#### Add a frontend feature

1. Decide whether state belongs in Jotai (`src/state/atoms.ts`) or local component state. Board task state stays in `useBoardState`.
2. Reuse existing data hooks; do not add a second initial loader.
3. Keep realtime/lazy-loading behavior intact.
4. Use `createLogger` in client modules.
5. Check keyboard access, focus handling, empty/loading/error states, and mobile layout.
6. Update [`frontend.md`](frontend.md) if the architecture or conventions change.

### Sharp edges

- **Production needs both** `NODE_ENV=production` and `dist/index.html`. Missing `dist` silently runs the dev SPA.
- **`bun run dev` does not start PocketBase.** Use the dev compose stack unless PocketBase is already running.
- **SSE needs `server.timeout(req, 0)`.** Chat and PocketBase realtime connections are cut off otherwise.
- **Tool loops need an explicit stop condition.** `streamText` stops after one step without `stopWhen(stepCountIs(8))`, so list → read chains fail.
- **Archived boards block task writes.** A task update returns an error while the board is archived; deletes still work. This is enforced by PocketBase rules plus `pb_hooks/guards/task_guards.js`.
- **Task moves need the request guard.** The update rule sees the stored board, not the incoming one. `task_guards.js` validates the new `board` relation for ownership and archived state.
- **The integration suite shares one database.** Use `tests/helpers/factories.ts` for unique users and records. Only the onboarding test may rely on an empty database.
- **Admin tests restore instance settings.** Snapshot with `snapshotAdminSettings()` and restore in `afterAll`; never leave SMTP, OAuth, attachment, or app-url changes behind for the next file.
- **Board deletion is two-step.** Active board → archive → permanent delete. The delete cascades tasks; do not add a client-side task loop.
- **Migration `0000018` backfills only empty boards.** It creates `My board` for authors with unassigned tasks, then makes `tasks.board` required. Do not create a default board for every user in a later migration without a product decision.
- **Superuser credentials are bootstrapped.** Tests read `pb_data/superuser_credentials.json`; changing env credentials changes the login.
- **Migration compatibility hook:** old filenames are rewritten in `_migrations` on startup. Don't rename historical migrations.
- **No embeddings or vector store.** Chat reads through the read tools; do not reintroduce auto-embed, `embedding_config`, or background indexing.
- **The test container resets its database.** Never mount host `pb_data` into the test compose.
- **`tests/preload.ts` is opt-in.** The Docker entrypoint and `bun run test:integration` pass it with `--preload`; a bare `bun test` does not wait for services.
- **`src/api/admin/rate-limits/reload` is auth-only**, not role-checked. Be deliberate if you change or rely on it.
- **No destructive git.** No `git reset --hard`, `git checkout --`, forced cleans, or deleting unmerged branches without preserving the work first.

### Git and change hygiene

- Keep changes scoped to the task.
- Do not commit `dist/`, `node_modules/`, `cache/`, logs, or `pocketbase/pb_data/` (except `types.d.ts`).
- Preserve unmerged work before deleting branches; archive it if necessary.
- If a task is partial, say so explicitly in the report rather than leaving a placeholder/TODO-only commit.

### Working with subagents

For larger tasks:

- Delegate research across disjoint areas to an `explore` agent.
- Delegate isolated implementation or verification slices to a `general` agent.
- Keep orchestration, cross-cutting decisions, and final review in the main session.
- Give each subagent the relevant doc path and file boundaries.
- Review their output; do not assume a subagent's summary is correct.

## Gotchas & invariants

- **`bun run build` is mandatory before shipping**, even when the Docker suite passes. The suite runs source, not the production bundle.
- **Docs-only changes still need a link check.** There is no docs build or Markdown linter; verify every relative link and every named path manually or with `grep`/`ls`.
- **The next migration is `0000020`.** Do not reuse `0000018`/`0000019`; they are applied.
- **Board and task data is user data.** Never use `pb_data` fixtures from the host in tests, and never edit an applied migration in place.
- **`useDocumentData()` is a single call site.** Moving it into a page duplicates subscriptions and breaks the initial-load order.
- **The root AddToBoard host is the only picker.** New entry points set `addToBoardRequestAtom`; they do not open their own dialog.
- **The chat tool set is a security boundary.** Read-only is deliberate; a write tool needs its own authorization design.

## Related docs

- [`architecture.md`](architecture.md) — system map and request flow.
- [`testing.md`](testing.md) — test stack and conventions.
- [`deployment.md`](deployment.md) — build and release details.
- [`pocketbase.md`](pocketbase.md) — hook/migration rules and board lifecycle.
- [`frontend.md`](frontend.md) — React/Jotai conventions and board/chat surfaces.
- [`ai.md`](ai.md) — chat providers and read tools.
