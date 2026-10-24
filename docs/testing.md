# Testing — integration suite and gates

## Overview

Nana uses **integration tests**, not unit tests with mocks. The suite starts a real PocketBase instance and a real Bun server, then exercises HTTP endpoints the same way the browser does. Chat tool tests call the tool executors against that real stack.

## Key files

| File | Purpose |
| --- | --- |
| `docker/compose.test.yml` | Isolated test container; no host ports or volumes. |
| `docker/docker-test-entrypoint.sh` | Resets the database, runs migrations, starts both processes, runs the phases. |
| `tests/preload.ts` | Waits for PocketBase health and the Bun server. |
| `tests/helpers/setup.ts` | `BASE_URL`, `PB_API`, auth and user helpers. |
| `tests/pocketbase/bootstrap.test.ts` | First-user bootstrap and signup lockdown. |
| `tests/pocketbase/guards/` | User, trash, version, task, and board guards. |
| `tests/pocketbase/hooks/` | Document hooks. |
| `tests/pocketbase/routes/` | Trash, admin, public-share, and misc routes. |
| `tests/api/bun-api.test.ts` | Version, rate-limit reload, export, manifest, service worker, and chat route basics. |
| `tests/api/chat-tools.test.ts` | `list_notes`, `read_note`, `list_boards`, `read_board` against the real stack. |

## How it works

### Run the suite

```bash
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

The command builds the `testing` stage, runs the suite in an isolated container, and exits with the test status. It does not expose ports or mount the host `pb_data`.

Do not point the test stack at a real database. The entrypoint deletes and recreates its own `pb_data`.

The shipping gate is the same change plus `bun run build`:

```bash
bun run build
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

### What the entrypoint does

`docker/docker-test-entrypoint.sh`:

1. Deletes and recreates `/app/pocketbase/pb_data`.
2. Runs `PB_MIGRATING=1 pocketbase migrate up`.
3. Starts PocketBase on `:8090` and Bun on `:3000`.
4. Waits for both to become ready.
5. Runs the phases:

| Phase | Files | Why separate |
| --- | --- | --- |
| Bootstrap + guards | `tests/pocketbase/bootstrap.test.ts` + `tests/pocketbase/guards/` | Fresh-database ordering matters; first-user bootstrap must run before lockdown tests. |
| Hooks + routes | `tests/pocketbase/hooks/` + `tests/pocketbase/routes/` | Hooks and custom routes after bootstrap. |
| Bun API | `tests/api/` | Routes and tools after PocketBase is fully seeded. |

`tests/preload.ts` waits for PocketBase health and the Bun server before the suite starts. The entrypoint waits up to 30 seconds for each process.

### Layout

```text
tests/
  preload.ts
  helpers/setup.ts
  api/
    bun-api.test.ts
    chat-tools.test.ts
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
```

Numeric prefixes are used when order matters. Keep the convention when adding ordered tests.

### Helpers

`tests/helpers/setup.ts` exports:

| Helper | Purpose |
| --- | --- |
| `BASE_URL` | `http://127.0.0.1:3000` |
| `PB_API` | `${BASE_URL}/pb/api` |
| `waitForServer(url)` | Poll until a URL responds with 200. |
| `getSuperuserCredentials()` | Read `pb_data/superuser_credentials.json`. |
| `authenticateSuperuser()` | Get a superuser token from PocketBase. |
| `createTestUser(token, opts)` | Create a user with the superuser token. |
| `authenticateUser(email, password)` | Sign in and return `{ token, record }`. |
| `signupUser(opts)` | Direct public signup request. |

Always use these helpers and the `BASE_URL` / `PB_API` constants. Never hardcode hosts.

### Test style

```ts
import { describe, test, expect, beforeAll } from "bun:test";
import { BASE_URL, authenticateSuperuser } from "../helpers/setup";

describe("My route", () => {
  let token: string;

  beforeAll(async () => {
    token = await authenticateSuperuser();
  });

  test("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE_URL}/api/my-route`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
```

- One behavior per `test()`.
- Test names should read as specifications.
- Assert status codes and response shapes.
- Use real HTTP; do not mock PocketBase or Bun.
- Tests may create data and rely on the fresh database, but should not depend on cleanup between files.

### Chat tool coverage

`tests/api/chat-tools.test.ts` builds two users with their own notes, boards, and tasks, then calls the executors with each user's `ToolContext`:

| Area | Assertions |
| --- | --- |
| `list_notes` | Returns only the caller's notes; metadata has no `content`; paging/sorting; tag filter; filter-string injection is inert; missing token → `unauthorized`; an invalid token returns an empty guest page (PocketBase rule behavior) and never leaks records; malformed folder id → `invalid_input`. |
| `read_note` | Line paging with `nextOffset`; long-line clipping and `truncated`; tail read has `hasMore: false`; another user's note → generic `not_found`. |
| `list_boards` | Active boards only by default; exact open/done/total and per-column counts; `includeArchived: true`; another user's boards never appear. |
| `read_board` | Column paging; task summaries expose `dueDate`, `labels`, `noteId`, sanitized excerpt; another user's board and archived boards → `not_found`; malformed id → `invalid_input`. |

These tests import the executor functions directly but hit the real PocketBase and Bun services. Keep them in `tests/api/` so they run in the API phase.

`tests/api/bun-api.test.ts` covers the chat route boundary: `401` without auth, `400` for missing message/invalid JSON, and a non-401 provider/config failure when `ai_config` is absent. It does not call a live model.

### Board and task coverage

`tests/pocketbase/guards/03-task-rules.test.ts` covers:

- Unauthenticated, cross-author, boardless, wrong-board, and archived-board creation rejection.
- Unknown status rejection.
- Author-scoped list/view/update/delete.
- Column move and reorder.
- Archived-board update rejection and delete allowance.

`tests/pocketbase/guards/04-board-rules.test.ts` covers:

- Author-scoped list/create/update.
- Cross-author create/read/update/delete rejection.
- Archive and restore.
- Rejection of deleting an active board.
- Permanent delete of an archived board, with task cascade and untouched neighbours.

### What to test

| Change | Add or update |
| --- | --- |
| New Bun API route | `tests/api/` |
| Chat route or provider behavior | `tests/api/bun-api.test.ts` |
| Chat read tool, bounds, or scoping | `tests/api/chat-tools.test.ts` |
| New PocketBase hook | `tests/pocketbase/hooks/` |
| Guard/permission change | `tests/pocketbase/guards/` |
| New PocketBase route | `tests/pocketbase/routes/` |
| Trash move/restore/delete | `tests/pocketbase/guards/01-trash-guards.test.ts` + routes |
| Public sharing | `tests/pocketbase/routes/06-public-shares.test.ts` |
| Migration/schema change | Assert the collection/field exists and behaves correctly |
| Task rules | `tests/pocketbase/guards/03-task-rules.test.ts` |
| Board rules or archive flow | `tests/pocketbase/guards/04-board-rules.test.ts` |
| Auth/bootstrap change | `tests/pocketbase/bootstrap.test.ts` + user guards |

### Debugging

- Run the compose command in the foreground to see phased output.
- `docker compose -f docker/compose.test.yml logs` shows the test container logs.
- The test entrypoint suppresses PocketBase/Bun logs to keep output readable; temporarily remove the redirects if you need server logs.
- If a test depends on first-user state, keep it in the bootstrap phase or create the user explicitly with the superuser helper.
- If a test hangs, check `tests/preload.ts` readiness and the entrypoint's 30-second server waits.
- The test container's `pb_data` is disposable; never copy it into the host.

### CI

There is no test workflow in `.github/workflows/`; the release workflow builds images. Run the Docker suite and `bun run build` locally before shipping behavior changes. If CI is added later, it should use the same compose command so the environment matches.

## Gotchas & invariants

- **The suite is not mocked.** A passing unit test is not evidence; add an integration assertion for guard, route, or tool changes.
- **Board tests need their own boards.** Task creation requires `board`; create active, archived, owner, and other-user boards explicitly. A boardless fixture now fails validation.
- **Archived-board tests must seed first, then archive.** Creating tasks on an archived board is rejected; create them while active, then `PATCH archived: true`.
- **Deleting a board in a test cascades its tasks.** Query the tasks with the superuser token to assert the cascade; do not assume the board delete removed only the board.
- **Chat tool tests hit real PocketBase.** They need the seeded users and records before the assertions; do not replace `pbGet()` with a mock.
- **`bun-api.test.ts` does not run a model.** Chat route tests cover validation and auth, not generated text; tool behavior lives in `chat-tools.test.ts`.
- **The test container deletes `pb_data`.** Never mount host data into `docker/compose.test.yml`.
- **Phase order matters.** Bootstrap/signup lockdown is first; tool tests are in the API phase after PocketBase is seeded.
- **The suite starts from an empty database.** It exercises the current schema, not the `0000018` legacy-task backfill. To verify that migration, migrate a disposable data directory to `0000017`, create a user and a boardless task, then apply `0000018` and confirm the task lands on that author's `My board` with its status and order intact.
- **`bun run build` is separate.** The suite executes TypeScript sources; a passing suite does not prove the production bundle builds.

## Related docs

- [`pocketbase.md`](pocketbase.md) — hooks, guards, routes, migrations.
- [`api.md`](api.md) — endpoint contracts.
- [`ai.md`](ai.md) — chat tool contracts and failure modes.
- [`deployment.md`](deployment.md) — Docker stages and runtime behavior.
- [`development.md`](development.md) — workflow and definition of done.
