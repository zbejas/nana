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
| `src/api/rest/` | Elysia `/api/v1`, OpenAPI docs, and REST auth. |
| `src/api/mcp/` | MCP server and tool registration. |
| `src/api/workspace/` | Shared folder/note/board/task services and the AI privacy lock. |
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
- PocketBase is loopback-only inside the container; there is no direct admin URL. Use the app's settings for normal admin work.
- API reference: <http://localhost:3000/docs> (OpenAPI JSON at `/docs/json`)
- Workspace JSON API: `/api/v1` (authenticated)
- MCP endpoint: `POST /mcp` (authenticated)
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
| Board folder or folder-trash behavior | `guards/05-board-folders.test.ts`, `routes/08-board-folder-trash.test.ts`, and the folder view on desktop and mobile. |
| Chat or tool behavior | `tests/api/chat-tools.test.ts` plus the chat API tests. Shared-note access/registry changes also touch the chat and PocketBase group rules. |
| REST `/api/v1` or OpenAPI behavior | `tests/api/rest-api.test.ts` and the `/docs` page. |
| MCP transport or tool behavior | `tests/api/mcp.test.ts`. |
| Private-lock behavior | `tests/unit/ai-visibility.test.ts` plus the chat, REST, and MCP integration files. |
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
- **Styling:** theme-aware Tailwind utilities over the Graphite tokens; reuse `src/components/ui/` before adding a primitive. See [`design.md`](design.md).
- **PocketBase hooks:** CommonJS `require()`, synchronous, `$os.getenv()`, `$app`.
- **Bun:** stay on 1.4.4 or newer. Bun 1.3.x can emit a production `dist/index.html` that points at the wrong entry chunk, leaving the SPA blank. The Docker and CI pins are 1.4.4.
- **Migrations:** append-only; the next free number is `0000036`. Use `migrate((app) => {}, (app) => {})`, a safe `down()`, and idempotent guards.

### Common tasks

#### Add a Bun application API route

1. Add the handler under `src/api/<area>/`.
2. Register the path in `src/index.ts` (inside `routes`).
3. Call `verifyAuth()` unless the route is intentionally public.
4. Add rate limiting if it is expensive or exposed.
5. Add tests under `tests/api/`; pure helpers also get a `tests/unit/` case.
6. Update [`api.md`](api.md) and the route list in [`architecture.md`](architecture.md) if the surface changed.

For a workspace route, do not add a parallel handler: add it to the Elysia app under `/api/v1` and call the shared service.

#### Add an Elysia REST route

1. Add the TypeBox schema to `src/api/rest/schemas.ts`.
2. Call an existing service in `src/api/workspace/` with `surface: "user"`; add a service function rather than writing PocketBase calls in the route.
3. Register the route on the `v1` Elysia app in `src/api/rest/index.ts` with `params`, `body`, `query`, and `response` schemas.
4. `/api/v1` routes inherit `authenticateApiRequest()` from the scoped `derive`; do not add a second auth path.
5. Add coverage to `tests/api/rest-api.test.ts` and update the endpoint table in [`api.md`](api.md). The OpenAPI page is generated from the schemas.

#### Add an MCP tool

1. Add the tool in `src/api/mcp/index.ts` using a Zod input schema and a clear `description`.
2. Call a shared service in `src/api/workspace/` with `surface: "ai"` and the caller's `ToolContext`. Never call PocketBase directly from the tool.
3. Use `runWorkspace()` or `fromToolResult()` so failures become `isError` results, not HTTP errors.
4. Preserve author scoping and the private lock. Hidden records must return `not_found`.
5. Add coverage to `tests/api/mcp.test.ts` and update the tool table in [`api.md`](api.md).
6. Do not add the tool to the chat set unless the chat contract also needs it. Chat has its own ask/edit tool registry; MCP is the separate external write surface.

#### Add a PocketBase hook or route

1. Create the module under the relevant `pocketbase/pb_hooks/` directory.
2. `require()` it from its parent module and ensure that parent is required by `index.pb.js`.
3. Use `requireAdmin`, `parseRequestBody`, `escapeHtml`, `sanitizeUrl` from `utils.js`.
4. Add tests under `tests/pocketbase/`; use the factories in `tests/helpers/factories.ts`.
5. Update [`pocketbase.md`](pocketbase.md) and [`api.md`](api.md) for new routes.

#### Change UI

1. Read [`design.md`](design.md) and reuse the primitives in `src/components/ui/`.
2. Use semantic tokens (`bg-surface`, `border-line`, `text-ink`, `bg-signal-soft`, `text-signal`); no raw colour families, `dark:`/`light:` variants, gradients, blur, or serif faces.
3. Check the change in both themes and at a mobile width.
4. If the change introduces data entry, use `InlineForm` in place or a `SidePanel`; do not open a centred dialog. `Dialog` (or `Sheet` on touch) is reserved for warnings/destructive confirmations and previews.
5. Update [`frontend.md`](frontend.md) when routes, state, or component structure changes.

#### Add a migration

1. Create `pocketbase/pb_migrations/0000036_<description>.js`.
2. Use the `migrate(up, down)` format.
3. Guard field/collection additions and removals.
4. Include a real `down()`.
5. Verify against a fresh test database; never edit an already-applied migration.
6. Update [`pocketbase.md`](pocketbase.md) if schema or settings behavior changes.

#### Change boards or tasks

1. Read [`pocketbase.md`](pocketbase.md) for the board/task rules and [`frontend.md`](frontend.md) for the UI split.
2. Keep the browser UI on the standard PocketBase collection endpoints. External automation uses the `/api/v1` facade, which calls the shared workspace services; do not add `/api/boards` or `/api/tasks` aliases.
3. Preserve the required `tasks.board` relation, the board trash-first delete rule, and the optional `boards.folder` relation.
4. If you change the backfill, keep `0000018`'s order: optional relation → backfill → required relation → rules.
5. Remember that permanently deleting a trashed board cascades tasks but never notes.
6. Incoming folder/parent/board/document writes need `guards/relation_guards.js`; folder trash must rehome boards, never delete them.
7. Update `tests/pocketbase/guards/03-task-rules.test.ts`, `04-board-rules.test.ts`, `05-board-folders.test.ts`, and `06-relation-integrity.test.ts`; add folder-trash coverage in `routes/08-board-folder-trash.test.ts`, then run the Docker suite.

#### Change AI tools

1. Read [`ai.md`](ai.md) first. Chat has `ask` (read-only) and `edit` (note/board/task writes) modes; MCP is the separate external write surface.
2. Keep chat tools scoped to `context.authHeader` / `context.userId`. Never use the superuser token for a tool; `chat_edits` persistence is the server-owned exception.
3. Add or preserve ownership scoping: filter lists on `author` (or `board.author` for tasks), and verify the owner on single-record reads, even when PocketBase rules also enforce it.
4. Apply the private lock. Lists use `aiVisibilityConditions()`; reads and writes check `noteIsLocked()` / `boardIsLocked()` and return `not_found` for hidden records.
5. Keep queries bounded (`perPage`, line windows, byte caps). Note/board reads keep the 8-second signal; task reads and writes use the workspace client's 30-second default.
6. Register read tools in `readTools`; register create/update/delete tools only in the `mode === "edit"` branch of `createChatTools()`. Ask mode must never receive a write tool. Delete tools create pending cards; do not add a direct delete path.
7. A strict `noteScope` is a separate registry: `read_note` only at view/comment, plus `append_note`/`edit_note`/`update_note` at edit. Do not filter the workspace tool set; remove the other tools. Force `ask` below edit access and keep the bound note server-selected.
8. Route chat writes through `src/api/workspace/` with `actor: "ai"`. Note edits need a revision/`versionToken`, and section edits must use `src/lib/markdown/sections.ts`; do not add whole-note replacement.
9. Record applied writes in `chat_edits` and emit an `edit` event. Do not fail a completed workspace write because the audit row failed.
10. If you add or rename a chat tool, update `CHAT_READ_TOOL_NAMES` or `CHAT_WRITE_TOOL_NAMES` in `src/api/chat/tool-names.ts` and the label map in `src/components/chat/ChatToolStrip.tsx`; persisted activity is allowlisted. MCP tool names are not persisted.
11. Persist only `{ name, status, error? }` for chat tool activity; `error` is bounded failure text, never raw inputs, outputs, or note text.
12. Keep `stopWhen(stepCountIs(8))` unless you have measured the read/write fan-out; the default stops after one step.
13. Handle missing provider/model configuration with actionable errors.
14. Add or update `tests/api/chat-tools.test.ts`, `tests/api/chat-write-tools.test.ts`, `tests/api/chat-group.test.ts`, and `tests/api/chat.test.ts` for chat; use `tests/api/mcp.test.ts` for MCP. Verify with `DEBUG=true` when diagnosing provider failures.

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
- **Trashed boards block task writes.** A task update returns an error while the board is in trash; deletes still work. This is enforced by PocketBase rules plus `pb_hooks/guards/relation_guards.js`.
- **Incoming relations need the request guard.** The update rule sees the stored record, not the incoming one. `relation_guards.js` validates `folder`, `parent`, `board`, and `document` for ownership and trashed state.
- **Folder moves need their own guard.** PocketBase relation rules see the stored record, so `relation_guards.js` validates the incoming `parent` and rejects cycles. Folder trash must rehome boards to the root; `boards.folder` does not cascade.
- **Private is an AI lock, not an owner lock.** `loadAiVisibility()` applies to chat and MCP. `/api/v1` and the browser client deliberately show private records to their owner.
- **MCP is stateless and POST-only.** A new server and transport handle one request; there is no session to reuse. `/mcp` is not chat and does not share chat's ask/edit tool registry.
- **`/docs` is public.** The OpenAPI document and self-hosted Scalar assets need no token. `/api/v1` and `/mcp` do.
- **The browser uses `/api/v1`, not PocketBase.** `/api/v1` has a typed workspace API and a PocketBase-shaped browser facade; `/pb` returns `404`. Server code talks to loopback PocketBase directly through `serverConfig.pocketbaseUrl`.
- **The integration suite shares one database.** Use `tests/helpers/factories.ts` for unique users and records. Only the onboarding test may rely on an empty database.
- **Admin tests restore instance settings.** Snapshot with `snapshotAdminSettings()` and restore in `afterAll`; never leave SMTP, OAuth, attachment, or app-url changes behind for the next file.
- **Board deletion is two-step.** Active board → trash → permanent delete. The delete cascades tasks; do not add a client-side task loop.
- **Migration `0000018` backfills only empty boards.** It creates `My board` for authors with unassigned tasks, then makes `tasks.board` required. Do not create a default board for every user in a later migration without a product decision.
- **Superuser credentials are bootstrapped.** Tests read `pb_data/superuser_credentials.json`; changing env credentials changes the login.
- **Migration compatibility hook:** old filenames are rewritten in `_migrations` on startup. Don't rename historical migrations.
- **No embeddings or vector store.** Chat and MCP use their tool sets; do not reintroduce auto-embed, `embedding_config`, or background indexing.
- **The test container resets its database.** Never mount host `pb_data` into the test compose.
- **`tests/preload.ts` is opt-in.** The Docker entrypoint and `bun run test:integration` pass it with `--preload`; a bare `bun test` does not wait for services.
- **Rate-limit admin routes are role-checked.** `GET`/`PATCH /api/v1/admin/rate-limits` and the legacy `POST /api/admin/rate-limits/reload` require the PocketBase admin flag; the `PATCH` persists and reloads together.
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
- **The next migration is `0000036`.** Do not reuse applied migrations; `0000035_group_chat` is the current head.
- **Board and task data is user data.** Never use `pb_data` fixtures from the host in tests, and never edit an applied migration in place.
- **`useDocumentData()` is a single call site.** Moving it into a page duplicates subscriptions and breaks the initial-load order.
- **The root AddToBoard host is the only picker.** New entry points set `addToBoardRequestAtom`; they do not open their own picker.
- **The chat tool set is a security boundary.** Ask mode is read-only; Work mode adds the bounded create/update set and confirm-first delete tools. Chat writes must use the caller token, workspace services, note revision checks, `X-Nana-Actor: ai`, and `chat_edits`. A strict shared-note scope is a separate registry with only the bound-note tools. MCP is the separate external write surface.
- **A folder delete never deletes boards.** `boards.folder` has `cascadeDelete: false`; the trash routes rehome boards to the root.
- **Trash is soft delete.** Notes and folders keep their id, attachments, and versions while `deleted_at` is set. Use `/api/trash/*`; direct deletes are superuser-only.
- **Hard-deleting a folder cascades.** `folders.parent` and `documents.folder` cascade, so permanent folder delete removes the subtree. Soft delete does not.
- **Tasks have no author field.** Ownership is `board.author`; do not reintroduce a second source of truth.

## Related docs

- [`architecture.md`](architecture.md) — system map and request flow.
- [`testing.md`](testing.md) — test stack and conventions.
- [`deployment.md`](deployment.md) — build and release details.
- [`pocketbase.md`](pocketbase.md) — hook/migration rules and board lifecycle.
- [`frontend.md`](frontend.md) — React/Jotai conventions, board folders, and chat.
- [`api.md`](api.md) — application routes, `/api/v1`, and MCP.
- [`ai.md`](ai.md) — chat, MCP, privacy lock, and providers.
