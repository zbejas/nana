# Kanban rework — Plan

- **Branch:** `rework`
- **Status:** P0 in progress
- **Created:** 2026-10-30
- **Reference:** Kaneo `usekaneo/kaneo` at `e5eeca6` (v2.48.0), 2026-10-30

## Progress

| Phase | State | Notes |
| --- | --- | --- |
| P0 — schema, hooks, sharing safety | **done** | `0025`–`0028`, permission guards, grant repair, private checks; Docker gate green. |
| P1 — data layer and contracts | **done** | Columns, task fields, facade, workspace services, MCP, public payloads, tests. |
| P2 — Milkdown editor | **done** | Kit + CodeMirror split/source, inline editor, toolbar, slash menu, tests. |
| P3 — kanban surfaces | **in progress** | Board shell, views, filters, bulk, and task panel are being implemented. |
| P4 — user sharing product | pending | Share panel, shared-with-me page, comments UI, permission-aware controls. |
| P5 — chat dock and agent | **in progress** | Dock UI and read/write agent backend are being implemented. |
| P6 — AI section edits | **in progress** | Section engine and revision/actor schema are in; Milkdown range animation next. |
| P7 — realtime shared workspaces | **in progress** | Shared index hooks and realtime allowlist are in; conflict banner and UI next. |
| P8 — notes UX polish | pending | Palette, pins, quick capture, focus mode, universal search. |
| P9 — verification and docs | pending | Final Docker suite, Playwright desktop/mobile, user QA, security/design review. |

## Goal

Bring Nana's board/task surface to Kaneo's kanban feature set without adopting
Kaneo's workspace, integration, billing, or sprint layers. A board remains an
author-scoped Nana record; sharing with other users replaces workspace
membership. Notes and tasks stay separate aggregates.

The kanban contract:

- Per-board workflow columns with stable slugs, order, icon, colour, and final
  flags. `planned` and `archived` are virtual backlog statuses, not columns.
- Tasks with title, Markdown description, single assignee, priority, start and
  due dates, labels, recurrence, board-scoped number, subtasks, relations,
  comments, and activity.
- Board, list, backlog, calendar, and Gantt views over the same task set.
- Search, filters, sort, display preferences, bulk selection, card context
  menus, keyboard movement, and a URL-addressable task panel.
- Sharing a note, folder, or board with another user at view, comment, or edit
  permission, with inherited folder access and a “Shared with me” surface.
- A read-only public board view that uses the same columns and task fields.

Out of scope: GitHub/GitLab/Slack/Linear/Jira integrations, billing, multiple
workspaces, workspace-level custom roles, sprint/velocity/burndown (Kaneo has
none), time tracking (API-only in Kaneo), and project background images.

## 1. Target architecture

```text
Board
 ├── board_columns (ordered, slug, name, icon, color, is_final)
 ├── tasks
 │    ├── status = column slug | planned | archived
 │    ├── assignee → users (must be owner or a grantee)
 │    ├── start_date, due_date, completed_at, recurrence
 │    ├── task_number (per board), board_order (per column)
 │    ├── labels (JSON names) → labels (owner definitions + colours)
 │    └── task_relations (subtask | blocks | related)
 ├── task_activity (created, status, priority, assignee, dates, labels, comment)
 └── comments (document | board | task)
```

The browser still talks only to `/api/v1`. Board and task records continue
through the browser facade; user-sharing routes are proxied through
`/api/v1/sharing/*` with the session JWT. Typed REST, MCP, and chat read the
same columns and fields with their existing author/scope/private rules.

### Status and completion rules

- `tasks.status` is a text slug. A column rename never rewrites tasks.
- A column slug is immutable while tasks reference it.
- A column cannot be deleted while tasks reference it.
- Completion is `column.is_final`, not the literal string `done`.
- `planned` and `archived` never have a column row and never count as complete.
- Moving a task to a final column sets `completed_at`; moving out clears it.
- `board.task_counter` allocates `task_number` on task create.

### Sharing rules

- Permission levels are `view` < `comment` < `edit`; the owner is level 3 plus
  owner-only fields.
- Only the owner may change `author`, `folder`, `parent`, public-share fields,
  privacy, archive state, board settings, and column definitions.
- `edit` may change task content and task fields; `comment` may comment; `view`
  may read. A view grantee never writes.
- Folder grants are materialized into `access_grants` and rebuilt on create,
  move, privacy change, trash, restore, and share mutation.
- Direct sharing of a private record is rejected; a private folder stops
  inheritance.
- `/api/sharing/*` is session-only. API keys and MCP remain author-scoped and
  do not see shared records; document this boundary.

## 2. Workstreams

| Workstream | Owner | Files | Depends on |
| --- | --- | --- | --- |
| Schema and hooks | orchestrator | `pb_migrations/0000025*`, `pb_hooks/boards/*`, `pb_hooks/tasks/*` | — |
| Sharing backend | subagent | `pb_hooks/sharing/*`, `pb_hooks/routes/sharing/*`, `pb_hooks/guards/*`, `src/api/rest/browser/extras.ts`, `tests/pocketbase/sharing*` | P0 hooks |
| Data layer | subagent | `src/lib/boards/*`, `src/lib/tasks/*`, `src/api/rest/browser/records.ts`, `src/api/workspace/*`, `src/api/mcp/*`, `src/api/chat/tools/*` | schema |
| Board surfaces | subagent | `src/pages/BoardPage.tsx`, `src/components/board/*` (except task panel), view components | data layer |
| Task panel | subagent | `src/components/board/TaskPanel*`, properties/subtasks/relations/activity/comments components | data layer |
| Milkdown | subagent | `src/components/editor/milkdown/*`, `EditorContent.tsx`, `index.css`, `package.json` | — |
| Sharing UI | subagent | `src/components/sharing/*`, `src/pages/SharedPage.tsx`, `App.tsx`, `Sidebar.tsx` | sharing backend |
| Docs and QA | orchestrator + reviewers | `docs/*`, screenshots, Playwright | all |

File ownership is strict: do not edit another workstream's files without asking
the orchestrator. Shared contracts are defined in `src/lib/tasks/index.ts` and
`src/lib/boards/index.ts` by the data-layer owner before UI work starts.

## 3. Data and API changes

### Collections

| Collection | Purpose | Rules |
| --- | --- | --- |
| `board_columns` | Ordered workflow per board | read follows board access; owner writes |
| `labels` | Owner label definitions and colours | owner only |
| `task_relations` | Subtask/blocks/related edges | read follows source board; owner writes in v1 |
| `task_activity` | Append-only task audit | read follows board; server writes only |
| `comments` | Document/board/task comments | internal; custom routes enforce access |

`tasks` gains `assignee`, `start_date`, `completed_at`, `recurrence`, and
`task_number`. `status` becomes text. `boards` gains `icon` and `task_counter`.

### Browser facade

- Allowlist `board_columns`, `labels`, `task_relations`, `task_activity`.
- Add task fields to create/update allowlists: `assignee`, `start_date`,
  `recurrence`.
- `board_columns` writes are owner-only; labels are owner-only; relations and
  activity are read-only in the facade (relations use a dedicated route if
  grantee editing is enabled later).
- Sanitize task descriptions and comment bodies with the document sanitiser.
- Add `/api/v1/sharing/*` forwarding with `requireBrowserAuth`.

### Typed REST and MCP

- Board DTOs include `columns` or a separate `GET /boards/:id/columns`.
- Task DTOs include the new fields; `status` accepts any column slug on the
  board, `planned`, or `archived`.
- MCP board read includes columns and task counts per column; task create and
  update accept assignee/dates/recurrence.
- Chat read tools group by columns and respect the private lock.
- API-key and MCP surfaces stay author-scoped; sharing is session-only.

## 4. UI plan

### Board page

- Header: board name, icon, private/public badges, open/done counts, share,
  settings, and a view switcher (Board, List, Backlog, Calendar, Gantt).
- Board view: dynamic columns, sticky lane headers, per-column count/add, card
  composer, cross-column drag, optimistic reorder, keyboard Alt+Arrow moves.
- Cards: title, task number, assignee avatar, priority, due-date/overdue,
  labels (max 2), subtask progress, comment count, linked note.
- Card context menu: status, priority, assignee, due date, duplicate, archive,
  delete. Quick property pickers stay on the card.
- Bulk bar: select with click/Cmd/Shift, clear, status, priority, assignee,
  label, due date, backlog/board, archive, delete.
- Filters: status, assignee, priority, labels, due date, custom fields (P2).
  Filters are ANDed across subjects and ORed within a subject; per-board
  localStorage. Sort and display preferences likewise.
- Search: title, description, labels, task number.
- Keyboard: `/` search, `C` create, `?` shortcuts, `J/K` focus, `Space` peek,
  `Enter` open, `X` select, `Escape` clear, `S/P/A/L` properties, `Shift+D`
  due date, `Alt+Arrow` move.
- Task panel: URL-backed side panel, title, Markdown description, properties
  rail, subtasks, relations, activity and comments; full-page route.
- Backlog: Planned and Archived sections, drag between them, “Move all” to the
  first open column.
- Calendar: month grid with multi-day bars and an agenda list on mobile.
- Gantt: 91-day timeline, drag to move dates, resize handles, today marker.
- Empty, loading, error, archived, and private states for every view.
- Mobile: one-column snap board, full-width task panel, property chips, no
  hover-only affordances.

### Sharing

- Share panel on notes, folders, and boards: people list, permission picker
  (view/comment/edit), remove, inherited-folder explanation, public-link
  section unchanged.
- `/shared` page: “Shared with me” groups folders, boards, and notes; shows
  owner, permission, and last activity; opens the normal reader/board with
  permission-aware controls.
- Comments: task/document/board thread with author, relative time, edit/delete
  for the author, and a composer disabled below `comment`.
- Owner sees “Shared with N people”; grantee sees a permission badge and no
  owner-only controls.
- Realtime refresh for shared records; no cross-user author filter.

## 5. Editor

- Replace `@uiw/react-md-editor` with `@milkdown/kit` 7.23 plus CodeMirror 6
  for the source pane. Keep `@uiw/react-markdown-preview` for read-only
  Markdown surfaces.
- Modes: source (CodeMirror), WYSIWYG (Milkdown), split (both, scroll-synced),
  read-only. Default split on desktop, WYSIWYG on mobile.
- Toolbar and slash menu are React components using Graphite primitives.
- Inline Milkdown for task descriptions and comment composers.
- Store Markdown unchanged; keep sanitisation, autosave, versions, attachments,
  and the 5 MB warning.
- Baseline serialization on mount must not mark the document dirty or create a
  version.

### Chat dock and agent

Chat becomes a persistent right-side dock, not a separate page. `ChatDock` is
mounted once in `AppContent` and survives navigation, so a note conversation
can continue on a board with the same context. `/chat` remains a full-page
history view for deep links and mobile.

- Toggle: `Ask Nana` in the page header and a `Cmd/Ctrl+J` shortcut. The dock is
  400px on desktop, full width on mobile, and never auto-opens.
- The dock has an `Ask / Edit` mode. `Ask` is read-only. `Edit` exposes note,
  board, and task write tools. The mode is visible in the composer.
- At send time the client attaches the open page as metadata only:
  `{ type: 'document' | 'board' | 'folder', id }`. The server resolves the
  title and permission itself; it never trusts client content. The UI shows a
  removable context chip; the model is told to call `read_note`/`read_board`
  if it needs the body.
- Conversations persist across routes. The dock keeps one active conversation,
  its scroll position, and a pending stream. History is available from the dock
  and the full-page route.
- Write tools are direct, visible, and reversible: create note, append note,
  update note title/content/tags, create board, create task, update task, move
  task. No delete, move-between-boards, publish, share, privacy, folder, or
  column changes.
- Every write snapshots the previous state, checks the record's `updated`
  version (optimistic concurrency), and returns a change summary. Private and
  private-folder records are `not_found`; AI edits never bypass the lock.
- The assistant is an actor: Nana avatar, "Nana is editing…" status, section
  highlights, activity rows, and a one-click Undo. See below.

### Section-scoped AI edits

The model edits Markdown by section, not by replacing the whole note. This
keeps formatting intact, makes diffs readable, and lets the open editor animate
exactly what changed.

Tool contract:

```ts
edit_note({
  noteId: string,
  expectedUpdated: string,          // optimistic concurrency
  operations: Array<
    | { op: 'replace_section'; heading: string; markdown: string }
    | { op: 'insert_after'; heading: string; markdown: string }
    | { op: 'append'; markdown: string }
    | { op: 'replace_text'; find: string; markdown: string } // unique match only
  >,
  summary: string
})
```

- A heading anchor matches the heading path (`## Plan` or `Plan > Risks`) and
  the section runs to the next heading of the same or higher level. `append`
  adds to the end of the note. `replace_text` is a fallback for notes without
  headings and requires a unique match.
- The server validates every anchor against the current Markdown before
  writing. One missing or ambiguous anchor aborts the whole edit and returns a
  `conflict`/`invalid_input` result so the model can re-read and retry.
- The server applies operations in order, carries untouched sections through
  without re-sanitizing, snapshots the old content, bumps `updated`, and returns
  `{ updated, sections: [{ heading, from, to }], summary }`.
- If the note is open in Milkdown, the client maps each section heading to a
  ProseMirror node range and dispatches a transaction replacing only that
  range. It never calls `replaceAll`.
- Changed ranges get a temporary decoration: a 1.2s `signal-soft` wash that
  fades to transparent, a 2px `signal` left rule, and an inline "Nana" label
  above the first changed section. The editor shows "Nana is editing…" while a
  tool is running, then "Nana updated 2 sections · Undo" for 10 seconds.
- If the note is not open, the chat card shows the section list with a compact
  before/after excerpt. Opening the note jumps to the first changed section.
- A remote user sees the normal realtime update plus the AI edit metadata, so
  the change reads as another collaborator's edit rather than a silent
  record replacement. If the user has unsaved changes, the existing conflict
  banner wins and the AI edit is not applied locally until resolved.

Board edits use the same actor model: task activity rows carry
`actor_type: 'ai'`, the task card flashes the changed field, and the task
panel activity line reads "Nana moved this to In progress". No section
animation is needed for boards.

## 6. Verification

- Unit: column ordering, filter/sort predicates, recurrence dates, calendar
  ranges, task-number formatting, permission helpers.
- Integration: column CRUD and guards, task fields, activity, comments,
  sharing permission matrix, grant rebuild, shared proxy, public board columns,
  MCP/typed REST fields.
- Build: `bun run build`.
- Docker: `bun run test:docker`.
- Playwright: desktop and 390px mobile for board, list, backlog, calendar,
  Gantt, task panel, share panel, shared page, editor split/WYSIWYG, chat dock,
  section-edit animation, and shared workspace realtime.
- Chat/agent: read tools stay private-locked; edit tools snapshot before write,
  reject stale `updated`, refuse private records, never delete, and animate the
  changed Milkdown range; direct writes are undoable.
- Realtime: two-user note/board updates, revocation mid-session, reconnect
  refetch, and no silent clobber on concurrent saves.
- Normal-user QA: create a board, add tasks, move them, filter, share, comment,
  open the shared view as a second user; open chat on a note, edit it, navigate
  to a board, and continue the same conversation; report pain points.
- Skeptics: security review of sharing and permissions; design review of every
  new surface against `docs/design.md`; accessibility review of drag/keyboard/touch.

## 7. Risks

- **Status migration:** converting a PocketBase select to text touches every
  status consumer. The migration copies data through a temporary field and is
  covered by a pre-0025 fixture test.
- **Sharing rules are broader than permissions.** The current `0023` update
  rules make every reader a writer. P0 guards must land before the share UI is
  exposed.
- **Realtime author filters** currently drop shared records. Remove the filter
  only after PocketBase rules are proven to scope events.
- **Editor bundle:** Milkdown kit + CodeMirror is ~359 KB gzip. Lazy-load the
  split pane and keep the editor route lazy.
- **Large boards:** `getFullList` is still used for tasks and summaries. Add
  pagination only after the feature set is stable; do not block parity on it.
- **Chat writes break the read-only invariant.** Every write goes through one
  audited service with a snapshot, optimistic concurrency, private-lock checks,
  and a hard tool allowlist. No delete, move, publish, share, or privacy fields.
- **Section anchors can be ambiguous.** The server aborts the entire edit when a
  heading or text anchor is missing or non-unique; the model must re-read.
  Untouched sections are not re-sanitized.
- **A global chat dock is a second stateful surface.** The dock keeps one active
  conversation and stream across routes; it must not unmount on navigation or
  duplicate subscriptions. Closing it never aborts an in-flight tool write.
- **Docs drift:** board rules and testing migration head are already stale.
  The P9 docs pass must correct `docs/pocketbase.md`, `docs/api.md`,
  `docs/security.md`, and `docs/testing.md` in the same change.
