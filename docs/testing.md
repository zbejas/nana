# Testing — unit and integration layers

## Overview

Nana has two test layers. **Unit tests** exercise pure modules directly, run without any services, and are fast enough for a tight edit loop. **Integration tests** start a real PocketBase instance and a real Bun server, then exercise HTTP the same way the browser does. There are no mocked database or HTTP layers.

The Docker suite runs both layers in an isolated container with a disposable database. It is the behavior gate; `bun run build` is the shipping gate.

## Key files

| File | Purpose |
| --- | --- |
| `tests/unit/` | Pure-function tests; no server, no PocketBase, no preload. |
| `tests/pocketbase/bootstrap.test.ts` | First checks on a fresh database: health, credentials, schema limits. |
| `tests/pocketbase/guards/` | Collection rules and request guards: users, trash views, tasks, boards, relation integrity. |
| `tests/pocketbase/hooks/` | Document hooks: stats, cascades. |
| `tests/pocketbase/routes/` | Custom PocketBase routes: trash, admin, public shares, check-users, folder board rehoming. |
| `tests/api/` | Bun routes plus chat read/write/group tools, Elysia `/api/v1`, MCP, and version history: app version, versions, export, chat, security, static, rest, mcp. |
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
    ai-visibility.test.ts
    api-key-scope.test.ts
    board-dates.test.ts
    chat-activity.test.ts
    chat-attachments.test.ts
    chat-context.test.ts
    chat-input-schemas.test.ts
    chat-stream.test.ts
    chat-tool-errors.test.ts
    chat-tools-text.test.ts
    chat-version-token.test.ts
    collab-session.test.ts
    collaboration-merge.test.ts
    collaboration-text.test.ts
    document-utils.test.ts
    export-documents.test.ts
    folder-tree.test.ts
    public-board.test.ts
    sanitize.test.ts
    tasks-text.test.ts
    timeline-items.test.ts
    versioning-store.test.ts
  pocketbase/
    bootstrap.test.ts
    guards/
      00-user-guards.test.ts
      01-trash-guards.test.ts
      03-task-rules.test.ts
      04-board-rules.test.ts
      05-board-folders.test.ts
      06-relation-integrity.test.ts
    hooks/03-document-hooks.test.ts
    routes/04-trash-routes.test.ts
    routes/05-admin-routes.test.ts
    routes/06-public-shares.test.ts
    routes/07-misc-routes.test.ts
    routes/08-board-folder-trash.test.ts
  api/
    api-keys.test.ts
    chat-attachments.test.ts
    chat-group.test.ts
    chat-tools.test.ts
    chat-write-tools.test.ts
    chat.test.ts
    collab-persistence.test.ts
    collaboration.test.ts
    export.test.ts
    mcp.test.ts
    rest-api.test.ts
    security.test.ts
    static.test.ts
    version.test.ts
    versions.test.ts
```

Numeric prefixes in `pocketbase/guards/` preserve the bootstrap ordering. Do not add ordering prefixes elsewhere.

## How it works

### Layers

| Layer | Location | Runs against | Use it for |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | Imported modules only | Parsing, formatting, bounds, schemas, sanitizers, pure builders, privacy tree walks. |
| PocketBase integration | `tests/pocketbase/` | Real PocketBase on loopback | Rules, guards, hooks, migrations, custom PocketBase routes, folder board rehoming. |
| Bun integration | `tests/api/` | Real Bun origin + real PocketBase | Bun routes, security headers, export, chat read/write/group tools, typed Elysia `/api/v1`, browser facade, MCP. |

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

- `bun run test:docker` is the same command developers use directly:

```bash
docker compose -f docker/compose.test.yml up --build --abort-on-container-exit --exit-code-from nana-test
```

Do not point the test stack at real data. The entrypoint deletes and recreates its own `pb_data`.

### Docker suite phases

`docker/docker-test-entrypoint.sh`:

1. Runs the unit phase.
2. Deletes and recreates `/app/pocketbase/pb_data`.
3. Runs `PB_MIGRATING=1 pocketbase migrate up`.
4. Starts PocketBase on `127.0.0.1:8090` (loopback only) and Bun on `:3000`, logging to `/tmp/nana-pocketbase.log` and `/tmp/nana-bun.log`.
5. Waits up to 30 seconds for each port.
6. Runs the integration phases with `tests/preload.ts`.

| Phase | Files | Ordering reason |
| --- | --- | --- |
| 1/4 Unit | `tests/unit/` | No services; quick signal on pure-logic breakage. |
| 2/4 Bootstrap + guards | `bootstrap.test.ts` + `guards/` | First-user onboarding must reach the fresh database before lockdown and fixtures. |
| 3/4 Hooks + routes | `hooks/` + `routes/` | Hooks and custom routes after bootstrap; admin tests restore global settings when done. |
| 4/4 Bun API | `api/` | Routes, export, chat, tools, typed REST, browser facade, and MCP after PocketBase is seeded. |

The fresh database is migrated with `pocketbase migrate up` before either process starts, so the suite runs with `0000035_group_chat.js` applied. There is no separate "apply migration" step in a test file.

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
| `bunRequest(path)`, `pbRequest(path)` | Fetch through the Bun origin or the loopback PocketBase origin (fixtures and PB route/hook assertions). |
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
| `createFolder(user, opts)` | Folder record; supports `parent` and `is_private`. |
| `createBoard(user, opts)` | Board record; supports the `archived` trash flag, `folder`, and `is_private`. |
| `createTask(user, boardId, opts)` | Task with status, order, labels, due date, and optional note link; ownership comes from the board. |
| `superuserUpdate(collection, id, body)` | Share flags and other privileged fixture setup. |
| `createConversation(user, opts)` | Conversation plus its initial `messages` records. |

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
| New Bun application route | `tests/api/` |
| New typed `/api/v1` route or DTO | `tests/api/rest-api.test.ts` |
| REST auth, validation, status mapping | `tests/api/rest-api.test.ts` |
| New browser facade route or collection | `tests/api/browser-api.test.ts` |
| Browser auth, records, files, realtime, trash, admin, public shares | `tests/api/browser-api.test.ts` |
| `/pb` removal, security headers, public surface | `tests/api/security.test.ts` |
| MCP transport, auth, JSON-RPC errors | `tests/api/mcp.test.ts` |
| MCP tool behavior, writes, destructive rules | `tests/api/mcp.test.ts` |
| API key create/revoke, hashed storage, session-only management | `tests/api/api-keys.test.ts` |
| API key access/scope on REST and MCP, read-only tool filtering | `tests/api/api-keys.test.ts` + `tests/unit/api-key-scope.test.ts` |
| Chat route, mode/context validation, provider validation, conversation persistence, status | `tests/api/chat.test.ts` |
| Chat attachment upload, magic-byte/type checks, limits, ownership, drafts, binding | `tests/api/chat-attachments.test.ts` + `tests/unit/chat-attachments.test.ts` |
| Chat read tool, bounds, or scoping | `tests/api/chat-tools.test.ts` + `tests/unit/chat-*` |
| Chat write tool, revision, edit card, or undo | `tests/api/chat-write-tools.test.ts` + `tests/unit/chat-version-token.test.ts` |
| Shared-note status/access, group conversation, sender labels, paused history | `tests/api/chat-group.test.ts` |
| Shared-note bound-note tools and view/edit scope | `tests/api/chat-write-tools.test.ts` |
| Shared-note group rules and unique note conversation | `tests/api/chat-group.test.ts` |
| Live-room read flush, merge, metadata adoption, hard-error stop | `tests/api/collab-persistence.test.ts` + `tests/api/collaboration.test.ts` |
| Bounded tool-error persistence and flattening | `tests/api/chat.test.ts` + `tests/unit/chat-tool-errors.test.ts` |
| Chunked/named chat SSE encoding | `tests/unit/chat-stream.test.ts` |
| Tab-resume reconnect threshold and no reload | No dedicated file yet; add to `tests/unit/collab-session.test.ts` |
| Chat route context, private branch, or context payload | `tests/unit/chat-context.test.ts` |
| AI private lock, hidden-folder subtrees, filters | `tests/unit/ai-visibility.test.ts` + `tests/unit/api-key-scope.test.ts` + `tests/api/chat-tools.test.ts` + `tests/api/mcp.test.ts` + `tests/api/rest-api.test.ts` |
| Export format, filename, folder path, attachment | `tests/api/export.test.ts` + `tests/unit/export-documents.test.ts` |
| Manifest, service worker, icons, SPA fallback | `tests/api/static.test.ts` |
| Save/list/read/restore version history, dedupe, stale revisions, owner scoping | `tests/api/versions.test.ts` |
| Live Yjs sync, concurrent edits at different/same offsets, presence, viewer/editor permissions, revision forwarding | `tests/api/collaboration.test.ts` |
| Markdown/text offset alignment, collapsed-caret mapping, and three-way merge | `tests/unit/collaboration-text.test.ts` + `tests/unit/collaboration-merge.test.ts` |
| Git store commit/tree/list/read and note locking | `tests/unit/versioning-store.test.ts` |
| Version repository cleanup after permanent note/folder delete | `tests/api/versions.test.ts` |
| New PocketBase hook | `tests/pocketbase/hooks/` |
| Guard or permission change | `tests/pocketbase/guards/` |
| New PocketBase route | `tests/pocketbase/routes/` |
| Soft-delete trash move/restore/delete | `tests/pocketbase/guards/01-trash-guards.test.ts` + `routes/04-trash-routes.test.ts` |
| Folder trash and board rehoming | `tests/pocketbase/routes/08-board-folder-trash.test.ts` |
| Board folder ownership or `is_private` schema | `tests/pocketbase/guards/05-board-folders.test.ts` |
| Public sharing, expiry, attachment exposure, trash disables links | `tests/pocketbase/routes/06-public-shares.test.ts` |
| Public board payload, trash/privacy guards, task ordering | `tests/pocketbase/routes/06-public-shares.test.ts` + `tests/unit/public-board.test.ts` |
| Task rules, board moves, ordering | `tests/pocketbase/guards/03-task-rules.test.ts` |
| Board trash flag/permanent delete/cascade | `tests/pocketbase/guards/04-board-rules.test.ts` |
| Auth/bootstrap/signup lockdown | `tests/pocketbase/bootstrap.test.ts` + `guards/00-user-guards.test.ts` |
| Migration or schema change | Assert the collection/field exists and behaves correctly in the owning integration file |

### Chat read and write coverage

`tests/api/chat-tools.test.ts` builds two users with independent notes, boards, and tasks, then calls the executors with each user's `ToolContext`.

| Area | Assertions |
| --- | --- |
| `list_notes` | Author scoping; metadata without `content`; paging and sorting; tag and title search; filter injection is inert; private notes and private-folder subtrees excluded from items and totals; missing token → `unauthorized`; invalid token returns an empty guest page without leaking; malformed folder id → `invalid_input`. |
| `read_note` | Line paging and `nextOffset`; long-line clipping and `truncated`; tail read has `hasMore: false`; another user's note → generic `not_found`; private note and notes in a private subtree → `not_found`; malformed ids and out-of-range windows. |
| `list_boards` | Active boards by default; exact open/done/total and per-column counts; trashed opt-in; paging; another user's boards never appear; private boards and boards in private folders excluded from items and totals. |
| `read_board` | Column paging; whole-board order; task summaries expose `dueDate`, `labels`, `noteId`, sanitized excerpt; another user's board and trashed boards → `not_found`; private boards and boards in private folders → `not_found`; malformed ids and columns. |

`tests/api/chat-write-tools.test.ts` covers edit mode:

| Area | Assertions |
| --- | --- |
| Registry | Ask mode omits every write tool and keeps `list_tasks`; Work mode registers the full write allowlist, including folder/note/board move, rename, and trash tools. |
| Context | Server-resolved titles; foreign, private, and private-folder contexts return `404`; a shared document with a person grant is allowed and becomes a strict note scope; wrong type is `400`. |
| Notes | `create_note` stamps `last_edit_source: "ai"`/`last_edited_by: "Nana"`; `append_note` and `edit_note` carry untouched content through and store the pre-edit snapshot in `chat_edits.operations.before`; stale revisions return `conflict`; missing/ambiguous anchors abort; private notes and private-folder notes return `not_found`; `move_note` changes the folder and refuses a private destination. |
| Folders | Create, rename, and move a folder; the parent relation is persisted. |
| Boards/tasks | Board creation, board rename/move, folder creation, task create/update/move, trashed-board conflict, invalid status, foreign task `not_found`, and `actor_type: "ai"` task activity. |
| Delete approval | A delete tool creates `pending` and leaves the target untouched; confirm trashes the target; cancel leaves it untouched; another user cannot confirm. |
| Cards/undo | Edit rows list oldest first; undo/confirm/cancel are conversation-owner only; created-note undo trashes and repeated undo is a no-op; note-edit undo restores the snapshot and repeated undo does not bump the revision again. |

The unit suite also covers the pure tool helpers (`tests/unit/chat-tools-text.test.ts`), the input schemas (`tests/unit/chat-input-schemas.test.ts`), tool-activity summarization (`tests/unit/chat-activity.test.ts`), named/legacy SSE encoding (`tests/unit/chat-stream.test.ts`), route context derivation (`tests/unit/chat-context.test.ts`), revision tokens (`tests/unit/chat-version-token.test.ts`), the private-lock tree/filters (`tests/unit/ai-visibility.test.ts`), API key token/scope helpers (`tests/unit/api-key-scope.test.ts`), and the git version store (`tests/unit/versioning-store.test.ts`).

Shared-note chat has a dedicated integration file, `tests/api/chat-group.test.ts`:

| Area | Assertions covered |
| --- | --- |
| Status/access | Unshared owner is `not_shared`; owner and view grantee see one enabled thread; editor sees `edit`; public-link-only note is disabled for the owner and `404` for an outsider. |
| Group identity | Server-created conversation uses the note owner as `author`; viewer/editor starts return the same thread with `can_manage: false`; one note row is enforced by the unique index. |
| Paused history | After unshare the owner keeps the thread and gets `409 note_not_shared` on send; the grantee's status becomes `404`; trashing the note returns `409 note_trashed`. |
| Validation | Attachments and regeneration return `400 group_attachments_unsupported` / `400 group_regenerate_unsupported`. |
| Sender/transcript | A user row stores `author`/`author_label`; the returned history carries `authorId`/`authorLabel`; an assistant row has no author; an outsider gets `404`/empty messages; a forged author row fails. |
| Isolation | Another user's personal conversation is `404`/empty for a grantee. |

`tests/api/chat-write-tools.test.ts` adds the registry and scope assertions: strict `view` registers only `read_note`; strict `edit` registers `read_note` plus the three note write tools and no workspace tools; a grantee can read/edit the bound note, while a view scope or a different note id returns `not_found`. `tests/api/chat.test.ts` verifies bounded tool-error persistence, and `tests/unit/chat-tool-errors.test.ts` covers flattening and the 200-character bound.

`tests/api/collab-persistence.test.ts` covers the room merge, metadata-only revision adoption, hard persistence error, explicit flush, and the new `read_note` pre-read flush. These gaps remain on this branch:

| Gap | Intended assertion |
| --- | --- |
| Unauthorized read flush | A caller without access to a live note cannot make `read_note` flush that room; the tool returns `not_found` before the flush. |
| AI write adoption | A chat/tool write against a note with a live room merges concurrent local text, applies one server-origin diff, and returns the external/final revision; the editor does not re-apply the fetched body. |
| Tab resume | `CollabSession` reconnects after 30 seconds hidden, keeps shorter hides connected, uses the `pagehide`/`pageshow` path, and `App.tsx` has no inactivity `window.location.reload()`. |

### REST and MCP coverage

`tests/api/rest-api.test.ts` exercises `/api/v1` through the real Bun origin and PocketBase:

| Area | Assertions |
| --- | --- |
| Auth | Raw and Bearer session tokens work; missing/invalid tokens return `401`. API key auth and scope live in `tests/api/api-keys.test.ts`. |
| Docs | `/docs` serves the self-hosted Scalar reference, `/docs/json` publishes `/api/v1` paths and stable operation ids, and the Scalar bundle plus Geist fonts are self-hosted. |
| Folders | List/create; the created folder appears in the caller's list. |
| Notes | Metadata-only list filtered by folder and sorted by title; create/read/update/delete; sanitized content and generated slug; root move with `""`/`null`; private note remains visible to its owner; another user gets `404` and an empty list; trash result carries `trashDocumentId`. |
| Boards | Create with folder and private flag; list with `includeArchived`/`folderId`; read/update; `DELETE` moves to trash; trash/restore routes; permanent delete `204` and task cascade. |
| Tasks | Create, list by status, partial update, column move, board move, `add note to board` copy semantics, permanent delete; trashed-board create conflict. |
| Errors | `422` validation, `400` parse/invalid input, `404` cross-author, `409` state conflict. |

`tests/api/mcp.test.ts` exercises the MCP endpoint:

| Area | Assertions |
| --- | --- |
| Transport | `POST` only (`405` otherwise); stateless JSON responses; malformed JSON returns the JSON-RPC parse error. |
| Auth | Missing token returns `401` before MCP work. |
| Discovery | The expected tool list is registered. |
| Reads | `list_notes`, `read_note`, `list_boards`, `read_board`, `list_folders`, `list_tasks` return visible records; note lists omit content; board lists include task counts; task lists include the board's tasks. |
| Writes | Note/board/task create, update, move; note/board delete moves to trash; task delete is permanent; trash/restore board; trash/restore document; export board Markdown. |
| Private lock | Private notes, boards, folders, and private-folder subtrees are omitted from lists and return `not_found` for reads and writes. |
| Failures | Tool failures are `isError` text results, not HTTP failures. |

`tests/api/api-keys.test.ts` exercises long-lived credentials:

| Area | Assertions |
| --- | --- |
| Creation | Plaintext is returned once; only the prefix is listed; the typed API accepts raw and Bearer keys; a key cannot manage keys. |
| Scope | Folder keys list only their subtree (re-rooted in MCP), cannot read/write the root or siblings, and cannot create root folders; root keys see only root records and no folders; workspace keys see everything but MCP still hides private records. |
| Access | Read-only keys read through REST and MCP, return `403` on REST writes, and have no write tools in `tools/list`. |
| Validation | Empty folder scope and foreign folders return `400`; an invalid scope returns `422`. |
| Revocation | Cross-account revoke returns `404`; owner revoke returns `204` and the next request returns `401`. |
| Surface boundary | Invalid keys return `401`; the browser facade and `/me` reject API keys. |

`tests/api/browser-api.test.ts` exercises the `/api/v1` browser facade, the replacement for `/pb`:

| Area | Assertions |
| --- | --- |
| Auth | Login, refresh, `/me`, auth methods, bad credentials, missing token. |
| Records | Author injection, document sanitization, foreign folder/board rejection, task board checks, self-promotion rejection, trash move/restore, multipart attachment upload. |
| Files | File token + protected file bytes through `/api/v1/files`. |
| Realtime | The SSE handshake returns `text/event-stream` and a `PB_CONNECT` frame. |
| Admin/public | Settings and admin routes are admin-only; public document shares work and private shares return `404`. |

`tests/api/versions.test.ts` exercises git-backed version history through the real browser facade: saving the current note, deduplicating an identical save (`created: false`), listing newest-first with pagination and no body, reading one detail, restoring a body while preserving title/tags/folder/privacy, rejecting stale revisions (`409`), hiding versions from another user, and removing repositories after permanent note and folder deletes. `tests/unit/versioning-store.test.ts` covers the store directly: first commit, tree equality, metadata changes, pagination, detail reads, note locking, and path validation.

`tests/api/security.test.ts` asserts `/pb` and `/pb/*` return `404`, security headers are present, the facade requires a token, and the loopback PocketBase fixture path still works.

`tests/pocketbase/guards/05-board-folders.test.ts` covers the board folder guard and `boards.is_private` field. `tests/pocketbase/guards/06-relation-integrity.test.ts` covers create ownership, immutable authors, folder cycles, foreign/trashed relation targets, message ownership, unique share tokens, and user-deletion blocking. `tests/pocketbase/routes/08-board-folder-trash.test.ts` covers folder trash rehoming, `movedBoardIds`, restore behavior, and permanent-delete preservation of rehomed boards and their tasks.

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
- **Incoming relations need the request guard.** PocketBase applies relation rules to the stored record, so `guards/relation_guards.js` checks the new `folder`, `parent`, `board`, and `document` values on update. Test cross-author and trashed-board moves, folder cycles, and trashed/foreign relation targets.
- **Protected file downloads need a file token.** `GET /api/v1/files/...` with only an `Authorization` header returns 404. Create one with `POST /api/v1/files/token`, then append `?token=...`.
- **Expired public shares are disabled on read.** A 404 for an expired token also clears `is_public` and `public_share_token`; assert the stored record, not just the response.
- **The suite is not mocked.** A unit test does not prove a guard, route, or tool is wired. Add the integration assertion.
- **The suite starts from an empty database.** It exercises the current schema, not legacy upgrade paths. To verify the `0000018` task-to-board backfill, migrate a disposable data directory to `0000017`, create a user and a boardless task, apply `0000018`, then confirm the task lands on that author's `My board` with its status and order intact. To verify `0000022`, migrate a disposable directory to `0000021`, create a trashed document/folder, a legacy version row, and a conversation with messages, apply `0000022`, then confirm the rows are soft-deleted with their original ids, attachments still resolve through the trash view, the conversation messages are records, and `tasks.author`/`document_versions.created_by` are gone. To verify `0000032`, migrate a disposable directory to `0000031`, create a note, apply `0000032`, then confirm `document_versions` and `documents.published` are gone and `trash_documents` still returns trashed notes without the removed column.
- **The Docker suite applies the full migration head automatically.** The entrypoint runs `migrate up` on a fresh database, so REST, MCP, chat, and trash tests see soft-delete fields, the `messages` collection, the trash views, relation indexes, immutable authors, and the share-token unique indexes without an explicit migration step.
- **`0000035` has a data backfill, not just schema.** Verify it on a disposable database migrated to `0000034` with an existing personal conversation and user/assistant messages: apply `0000035`, confirm every conversation has `scope = "personal"`, each user message has the conversation author and a name label, assistant rows have no author, and a second `scope: "note"` row for the same document is rejected by the unique index.
- **Private fixtures need their owner.** The private-lock tests must read as the owner. A second user seeing `not_found` proves cross-author scoping, not the private lock; use `createUser()` and the owner's token for the private cases.
- **MCP tests must `POST`.** A `GET /mcp` returns `405`; the test helper must send a JSON-RPC body with the user token and assert the tool result, not an HTTP error, for workspace failures.
- **Browser fixtures use loopback PocketBase; public behavior uses Bun.** `pbRequest()` targets `127.0.0.1:8090` for setup, hook, guard, and route assertions. Public-facing browser behavior must go through `/api/v1` (`BROWSER_API`) so a deleted `/pb` route cannot hide behind a direct-PB test.
- **`bun run build` is separate.** The suite runs TypeScript sources; a passing suite does not prove the production bundle builds.
- **The test container must never mount host `pb_data`.** The entrypoint deletes and recreates its own copy.

## Related docs

- [`pocketbase.md`](pocketbase.md) — hooks, guards, routes, migrations.
- [`api.md`](api.md) — endpoint contracts.
- [`ai.md`](ai.md) — chat tool contracts and failure modes.
- [`security.md`](security.md) — auth, proxy, CSP, rate limits.
- [`deployment.md`](deployment.md) — Docker stages and runtime behavior.
- [`development.md`](development.md) — workflow and definition of done.
