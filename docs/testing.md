# Testing — unit and integration layers

## Overview

Nana has two test layers. **Unit tests** exercise pure modules directly, run without any services, and are fast enough for a tight edit loop. **Integration tests** start a real PocketBase instance and a real Bun server, then exercise HTTP the same way the browser does. There are no mocked database or HTTP layers.

The Docker suite runs both layers in an isolated container with a disposable database. It is the behavior gate; `bun run build` is the shipping gate.

## Key files

| File | Purpose |
| --- | --- |
| `tests/unit/` | Pure-function tests; no server, no PocketBase, no preload. |
| `tests/pocketbase/bootstrap.test.ts` | First checks on a fresh database: health, credentials, schema limits. |
| `tests/pocketbase/guards/` | Collection rules and request guards: users, trash, versions, tasks, boards. |
| `tests/pocketbase/hooks/` | Document hooks: stats, versions, cascades. |
| `tests/pocketbase/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users. |
| `tests/api/` | Bun routes plus the chat read tools: version, export, chat, security, static, chat tools. |
| `tests/helpers/setup.ts` | URLs, credentials, auth, signup, unique names. |
| `tests/helpers/client.ts` | HTTP and PocketBase collection helpers with status assertions. |
| `tests/helpers/factories.ts` | Isolated users and records for integration files. |
| `tests/helpers/settings.ts` | Snapshot/restore for global admin settings. |
| `tests/preload.ts` | Waits for PocketBase and Bun before integration files run. |
| `docker/compose.test.yml` | Isolated test container; no host ports or volumes. |
| `docker/docker-test-entrypoint.sh` | Resets the database, runs migrations, starts both processes, runs all phases. |
| `.github/workflows/tests.yml` | CI: unit + build, then the Docker suite with logs on failure. |

### Layout

```text
tests/
  preload.ts
  helpers/
    setup.ts
    client.ts
    factories.ts
    settings.ts
  unit/
    board-dates.test.ts
    chat-activity.test.ts
    chat-input-schemas.test.ts
    chat-tools-text.test.ts
    document-utils.test.ts
    export-documents.test.ts
    folder-tree.test.ts
    sanitize.test.ts
    tasks-text.test.ts
  pocketbase/
    bootstrap.test.ts
    guards/
      00-user-guards.test.ts
      01-trash-guards.test.ts
      02-version-guards.test.ts
      03-task-rules.test.ts
      04-board-rules.test.ts
    hooks/03-document-hooks.test.ts
    routes/04-trash-routes.test.ts
    routes/05-admin-routes.test.ts
    routes/06-public-shares.test.ts
    routes/07-misc-routes.test.ts
  api/
    chat-tools.test.ts
    chat.test.ts
    export.test.ts
    security.test.ts
    static.test.ts
    version.test.ts
```

Numeric prefixes in `pocketbase/guards/` preserve the bootstrap ordering. Do not add ordering prefixes elsewhere.

## How it works

### Layers

| Layer | Location | Runs against | Use it for |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | Imported modules only | Parsing, formatting, bounds, schemas, sanitizers, pure builders. |
| PocketBase integration | `tests/pocketbase/` | Real PocketBase via the Bun `/pb` proxy | Rules, guards, hooks, migrations, custom PocketBase routes. |
| Bun integration | `tests/api/` | Real Bun origin + real PocketBase | Bun routes, proxying, security headers, export, chat, read tools. |

Unit tests must not import a module that performs network I/O at import time. Integration tests must not replace PocketBase or Bun with a fake.

### Commands

| Command | What it runs |
| --- | --- |
| `bun run test:unit` | All unit files; no services required. |
| `bun run test:unit:coverage` | Unit files with Bun's line coverage. |
| `bun run test:integration` | PocketBase and Bun integration files against a stack already running on `:3000`. |
| `bun run test:docker` | Isolated container: unit phase + all integration phases on a fresh database. |
| `bun run test` | Full local gate: unit tests, then the Docker suite. |
| `bun run build` | Production bundle; required before shipping. |

`bun run test:docker` is the same command developers use directly:

```bash
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

Do not point the test stack at real data. The entrypoint deletes and recreates its own `pb_data`.

### Docker suite phases

`docker/docker-test-entrypoint.sh`:

1. Runs the unit phase.
2. Deletes and recreates `/app/pocketbase/pb_data`.
3. Runs `PB_MIGRATING=1 pocketbase migrate up`.
4. Starts PocketBase on `:8090` and Bun on `:3000`, logging to `/tmp/nana-pocketbase.log` and `/tmp/nana-bun.log`.
5. Waits up to 30 seconds for each port.
6. Runs the integration phases with `tests/preload.ts`.

| Phase | Files | Ordering reason |
| --- | --- | --- |
| 1/4 Unit | `tests/unit/` | No services; quick signal on pure-logic breakage. |
| 2/4 Bootstrap + guards | `bootstrap.test.ts` + `guards/` | First-user onboarding must reach the fresh database before lockdown and fixtures. |
| 3/4 Hooks + routes | `hooks/` + `routes/` | Hooks and custom routes after bootstrap; admin tests restore global settings when done. |
| 4/4 Bun API | `api/` | Routes, proxy, export, chat, and tools after PocketBase is seeded. |

On failure the entrypoint prints the tail of both server logs. On success it reports per-phase and total duration.

### Isolation model

Integration files share one database but not fixture records.

- **Create users per file.** `createUser()`, `createAdmin()`, and `createUnverifiedAdmin()` use unique emails. Never create a fixed user in a later file.
- **The only fixed user is the onboarding user** in `00-user-guards.test.ts`, because first signup only works once. If the database already has users (for example a dev stack), those first-user assertions no-op.
- **Create records per file.** Notes, folders, boards, tasks, and conversations come from factories. Assertions use returned IDs, not global counts.
- **Do not depend on another file's records.** File order is fixed, but data dependency is not acceptable.
- **Restore global settings.** Admin route tests snapshot SMTP, attachment, OAuth, and `meta` settings in `beforeAll` and restore them in `afterAll` via `tests/helpers/settings.ts`.
- **The database is disposable.** Tables are not cleaned between files; use unique fixtures rather than cleanup loops.

### Helpers

`tests/helpers/setup.ts`:

| Export | Purpose |
| --- | --- |
| `BASE_URL`, `PB_API`, `PUBLIC_API` | Origin and proxied PocketBase URLs. |
| `TEST_PASSWORD` | Shared fixture password. |
| `uniqueSuffix()`, `uniqueEmail(prefix)` | Collision-resistant fixture names. |
| `authHeaders(token, json?)` | Authorization header shorthand. |
| `waitForServer(url)` | Poll until a URL returns 200. |
| `getSuperuserCredentials()` | Env credentials or the generated `pb_data/superuser_credentials.json`. |
| `authenticateSuperuser()` | Superuser token. |
| `createTestUser(superuserToken, opts)` | Low-level user create; prefer factories. |
| `authenticateUser(email, password)` | Token plus public record. |
| `signupUser(opts)` | Direct public signup request for lockdown tests. |

`tests/helpers/client.ts`:

| Helper | Purpose |
| --- | --- |
| `bunRequest(path)`, `pbRequest(path)` | Fetch through the Bun origin or `/pb` proxy. |
| `expectStatus(res, status, label?)` | Assert status and include the response body on failure. |
| `readJson(res)`, `expectJsonError(res, status, contains?)` | Parse JSON or assert the `{ error }` envelope. |
| `postJson()`, `patchJson()` | JSON requests to Bun routes. |
| `pbCreate()`, `pbUpdate()`, `pbDelete()`, `pbGetRecord()` | Standard collection writes and reads. |
| `pbList()`, `pbFindFirst()`, `pbRecordExists()` | List, first-match, and existence helpers. |

`tests/helpers/factories.ts`:

| Factory | Returns |
| --- | --- |
| `getSuperuserToken()` | Cached per test file. |
| `createUser(prefix, opts)` | Authenticated user with `id`, `email`, `token`, `password`, `admin`, `verified`. |
| `createAdmin(prefix)`, `createUnverifiedAdmin(prefix)` | Admin variants with the expected verified state. |
| `createNote(user, opts)` | Document record; supports tags, folder, privacy, and share flags. |
| `createNoteWithAttachment(user, filename, bytes, contentType?)` | Document with a real `attachments` upload. |
| `createFolder(user, opts)` | Folder record; supports `parent`. |
| `createBoard(user, opts)` | Board record; supports `archived`. |
| `createTask(user, boardId, opts)` | Task with status, order, labels, due date, and optional note link. |
| `publishNote(user, id, content?)` | Update with `published: true`, triggering a version. |
| `superuserUpdate(collection, id, body)` | Share flags and other privileged fixture setup. |
| `createConversation(user, opts)` | Chat conversation record. |

### Writing unit tests

Import the module directly and cover the behavior at its edges. Good unit candidates are the pure modules already used by the server: `src/api/chat/tools/text.ts`, `src/api/export/documents.ts`, `src/lib/tasks/text.ts`, `src/lib/folders/utils.ts`, `src/lib/documents/utils.ts`, `src/components/board/dates.ts`, and `src/lib/sanitize.ts`.

```ts
import { expect, test } from "bun:test";
import { sanitizeFilename } from "../../src/api/export/documents";

test("falls back to Untitled after cleaning punctuation-only names", () => {
    expect(sanitizeFilename("...")).toBe("Untitled");
});
```

Do not add a unit test when the behavior only exists in PocketBase rules, hooks, or Bun routes; cover those in integration.

### Writing integration tests

Create fixtures, make the request, and assert status plus shape. Use `expectStatus()` so a failure includes the server body.

```ts
import { beforeAll, expect, test } from "bun:test";
import { expectStatus, pbRequest, readJson } from "../helpers/client";
import { createNote, createUser, type TestUser } from "../helpers/factories";

let user: TestUser;
let noteId: string;

beforeAll(async () => {
    user = await createUser("example");
    noteId = (await createNote(user, { title: "Example" })).id;
});

test("owner can read their note", async () => {
    const res = await pbRequest(`/collections/documents/records/${noteId}`, {
        headers: { Authorization: user.token },
    });
    await expectStatus(res, 200);
    expect(await readJson<{ title: string }>(res)).toMatchObject({ title: "Example" });
});
```

Rules:

- One behavior per `test()`. Names read as specifications.
- Always assert the HTTP status. Do not accept `[200, 500]` or `expect(res.ok).toBe(false)` when a precise code exists.
- Use factories and unique IDs. Do not assume a record from another file exists.
- Use `tests/helpers/settings.ts` if a test changes instance settings.
- Add tests in the same phase as the code: PocketBase changes under `tests/pocketbase/`, Bun changes under `tests/api/`.

### Change-to-test map

| Change | Add or update |
| --- | --- |
| Pure parser, formatter, bounds, schema, sanitizer | `tests/unit/` |
| New Bun API route | `tests/api/` |
| Chat route, provider validation, conversation persistence | `tests/api/chat.test.ts` |
| Chat read tool, bounds, or scoping | `tests/api/chat-tools.test.ts` + `tests/unit/chat-*` |
| Export format, filename, folder path, attachment | `tests/api/export.test.ts` + `tests/unit/export-documents.test.ts` |
| Security headers, CSP, proxy forwarding | `tests/api/security.test.ts` |
| Manifest, service worker, icons, SPA fallback | `tests/api/static.test.ts` |
| New PocketBase hook | `tests/pocketbase/hooks/` |
| Guard or permission change | `tests/pocketbase/guards/` |
| New PocketBase route | `tests/pocketbase/routes/` |
| Trash move/restore/delete | `tests/pocketbase/guards/01-trash-guards.test.ts` + `routes/04-trash-routes.test.ts` |
| Public sharing, expiry, attachment exposure | `tests/pocketbase/routes/06-public-shares.test.ts` |
| Task rules, board moves, ordering | `tests/pocketbase/guards/03-task-rules.test.ts` |
| Board archive/delete/cascade | `tests/pocketbase/guards/04-board-rules.test.ts` |
| Auth/bootstrap/signup lockdown | `tests/pocketbase/bootstrap.test.ts` + `guards/00-user-guards.test.ts` |
| Migration or schema change | Assert the collection/field exists and behaves correctly in the owning integration file |

### Chat tool coverage

`tests/api/chat-tools.test.ts` builds two users with independent notes, boards, and tasks, then calls the executors with each user's `ToolContext`.

| Area | Assertions |
| --- | --- |
| `list_notes` | Author scoping; metadata without `content`; paging and sorting; tag and title search; filter injection is inert; missing token → `unauthorized`; invalid token returns an empty guest page without leaking; malformed folder id → `invalid_input`. |
| `read_note` | Line paging and `nextOffset`; long-line clipping and `truncated`; tail read has `hasMore: false`; another user's note → generic `not_found`; malformed ids and out-of-range windows. |
| `list_boards` | Active boards by default; exact open/done/total and per-column counts; archived opt-in; paging; another user's boards never appear. |
| `read_board` | Column paging; whole-board order; task summaries expose `dueDate`, `labels`, `noteId`, sanitized excerpt; another user's board and archived boards → `not_found`; malformed ids and columns. |

The unit suite also covers the pure tool helpers (`tests/unit/chat-tools-text.test.ts`), the input schemas (`tests/unit/chat-input-schemas.test.ts`), and tool-activity summarization (`tests/unit/chat-activity.test.ts`).

### Coverage and CI

`bun run test:unit:coverage` reports line coverage for the pure modules. Coverage is a signal, not a gate; integration behavior still needs an integration assertion.

`.github/workflows/tests.yml` runs two jobs:

- **Unit tests and production build** on the Bun version pinned in `docker/Dockerfile`. The job also runs `bun run build`.
- **Docker integration suite** via the same compose command developers use, with container logs printed on failure.

### Debugging

- Run the compose command in the foreground to see phase output.
- `docker compose -f docker/compose.test.yml logs --no-color nana-test` shows the test container's logs.
- The entrypoint writes server logs to `/tmp/nana-pocketbase.log` and `/tmp/nana-bun.log` inside the container and prints their tails on failure.
- To run integration tests against a running dev stack: start the dev stack, then `bun run test:integration`. `TEST_BASE_URL` overrides `http://127.0.0.1:3000`; `PB_CREDENTIALS_PATH` overrides the credentials file. This mutates the dev database with fixture records, so prefer the container.
- If a test hangs, check `tests/preload.ts` and the entrypoint's 30-second port waits.
- The container's `pb_data` is disposable; never copy it into the host.

## Gotchas & invariants

- **`tests/preload.ts` only runs when passed.** The Docker entrypoint and `bun run test:integration` pass `--preload ./tests/preload.ts`. A bare `bun test tests/api` does not wait for services and will race startup.
- **First-user onboarding is order-sensitive.** `00-user-guards.test.ts` is the only file that may call `signupUser()` without an admin token. It no-ops when `check-users` already reports users, so do not make other tests depend on a fresh database.
- **Never reuse a fixed email outside onboarding.** Every other user comes from `createUser()` and gets a unique email. Two files sharing `test@test.local` will fail with a 400 on the second create.
- **Global settings are not per-test.** Admin route tests snapshot and restore SMTP, attachment, OAuth, and `meta` settings. A new admin test that mutates settings must use the same helper.
- **Admin routes return real 403s.** `requireAdmin()` throws `ForbiddenError`, and the route handlers map known errors through `sendError()` in `pb_hooks/utils.js`. Assert `403`; a `500` means an error-mapping regression.
- **Trash routes return `400` for every failure.** Missing IDs, unknown IDs, and records owned by someone else all come back as `400 { error }`. They do not use 403/404.
- **Task board moves need the request guard.** PocketBase applies relation rules to the stored record, so `task_guards.js` checks the new `board` value on update. Without it a user can move a task onto another user's board. Test both cross-author and archived-board moves.
- **Protected file downloads need a file token.** `GET /api/files/...` with only an `Authorization` header returns 404. Create one with `POST /api/files/token`, then append `?token=...`.
- **Expired public shares are disabled on read.** A 404 for an expired token also clears `is_public` and `public_share_token`; assert the stored record, not just the response.
- **The suite is not mocked.** A unit test does not prove a guard, route, or tool is wired. Add the integration assertion.
- **The suite starts from an empty database.** It exercises the current schema, not legacy upgrade paths. To verify the `0000018` task-to-board backfill, migrate a disposable data directory to `0000017`, create a user and a boardless task, apply `0000018`, then confirm the task lands on that author's `My board` with its status and order intact.
- **`bun run build` is separate.** The suite runs TypeScript sources; a passing suite does not prove the production bundle builds.
- **The test container must never mount host `pb_data`.** The entrypoint deletes and recreates its own copy.

## Related docs

- [`pocketbase.md`](pocketbase.md) — hooks, guards, routes, migrations.
- [`api.md`](api.md) — endpoint contracts.
- [`ai.md`](ai.md) — chat tool contracts and failure modes.
- [`security.md`](security.md) — auth, proxy, CSP, rate limits.
- [`deployment.md`](deployment.md) — Docker stages and runtime behavior.
- [`development.md`](development.md) — workflow and definition of done.
