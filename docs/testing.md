# Testing

Nana uses **integration tests**, not unit tests with mocks. The suite starts a real PocketBase instance and a real Bun server, then exercises HTTP endpoints the same way the browser does.

## Run the suite

```bash
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

The command builds the `testing` stage, runs the suite in an isolated container, and exits with the test status. It does not expose ports or mount the host `pb_data`.

Do not point the test stack at a real database. The entrypoint deletes and recreates its own `pb_data`.

## What the entrypoint does

`docker/docker-test-entrypoint.sh`:

1. Deletes and recreates `/app/pocketbase/pb_data`.
2. Runs `PB_MIGRATING=1 pocketbase migrate up`.
3. Starts PocketBase on `:8090` and Bun on `:3000`.
4. Waits for both to become ready.
5. Runs three phases with `bun test`:

| Phase | Files | Why separate |
| --- | --- | --- |
| 1 | `tests/pocketbase/bootstrap.test.ts` + `tests/pocketbase/guards/` | Fresh-database ordering matters; first-user bootstrap must run before lockdown tests. |
| 2 | `tests/pocketbase/hooks/` + `tests/pocketbase/routes/` | Hooks and custom routes after bootstrap. |
| 3 | `tests/api/` | Bun API routes after PocketBase is fully seeded. |

`tests/preload.ts` waits for PocketBase health and the Bun server before the suite starts.

## Layout

```text
tests/
  preload.ts
  helpers/setup.ts
  api/bun-api.test.ts
  pocketbase/
    bootstrap.test.ts
    guards/
      00-user-guards.test.ts
      01-trash-guards.test.ts
      02-version-guards.test.ts
      03-task-rules.test.ts
    hooks/03-document-hooks.test.ts
    routes/04-trash-routes.test.ts
    routes/05-admin-routes.test.ts
    routes/06-public-shares.test.ts
    routes/07-misc-routes.test.ts
```

Numeric prefixes are used when order matters. Keep the convention when adding ordered tests.

## Helpers

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

## Test style

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

## What to test

| Change | Add or update |
| --- | --- |
| New Bun API route | `tests/api/` |
| Chat/embedding behavior | `tests/api/bun-api.test.ts` or a focused file |
| New PocketBase hook | `tests/pocketbase/hooks/` |
| Guard/permission change | `tests/pocketbase/guards/` |
| New PocketBase route | `tests/pocketbase/routes/` |
| Trash move/restore/delete | `tests/pocketbase/guards/01-trash-guards.test.ts` + routes |
| Public sharing | `tests/pocketbase/routes/06-public-shares.test.ts` |
| Migration/schema change | Assert the collection/field exists and behaves correctly |
| Board or task rules | `tests/pocketbase/guards/03-task-rules.test.ts` — author isolation, required status, reordering |
| Auth/bootstrap change | `tests/pocketbase/bootstrap.test.ts` + user guards |

## Debugging

- Run the compose command in the foreground to see phased output.
- `docker compose -f docker/compose.test.yml logs` shows the test container logs.
- The test entrypoint suppresses PocketBase/Bun logs to keep output readable; temporarily remove the redirects if you need server logs.
- If a test depends on first-user state, keep it in phase 1 or create the user explicitly with the superuser helper.
- If a test hangs, check `tests/preload.ts` readiness and the entrypoint's 30-second server waits.
- The test container's `pb_data` is disposable; never copy it into the host.

## CI

There is no test workflow in `.github/workflows/`; the release workflow builds images. Run the Docker suite locally before shipping behavior changes. If CI is added later, it should use the same compose command so the environment matches.

## Related docs

- [`pocketbase.md`](pocketbase.md) — hooks, guards, routes, migrations.
- [`api.md`](api.md) — endpoint contracts.
- [`deployment.md`](deployment.md) — Docker stages and runtime behavior.
- [`development.md`](development.md) — workflow and definition of done.
