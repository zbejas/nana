# Frontend — routes, state, and surfaces

## Overview

The frontend is a React 19 SPA built with Bun, styled with TailwindCSS v4 and the Graphite tokens, and routed with React Router v7. Jotai owns shared UI and document state; PocketBase is accessed through the JS SDK pointed at `/pb`. Board task state is route-local, not global. Boards live in the timeline, folder view, and sidebar rather than a separate index; private boards carry a lock and publicly shared boards carry a share indicator.

The visual system is documented in [`../DESIGN.md`](../DESIGN.md); product truth is in [`../PRODUCT.md`](../PRODUCT.md).

## Key files

| File | Role |
| --- | --- |
| `src/index.html` | SPA shell; loads `src/frontend.tsx` and the theme bootstrap. |
| `src/frontend.tsx` | Creates the React root, wraps the app in Jotai `Provider` and `AuthProvider`, registers the service worker. |
| `src/App.tsx` | Router, protected routes, layout, sidebar, mobile navigation, lazy pages, `AddToBoardHost`. |
| `src/lib/auth.tsx` | `AuthProvider` / `useAuth()`: session validation, sign-in, sign-up, OAuth, logout. |
| `src/index.css` | Tailwind entry, Graphite tokens, self-hosted fonts, global styles, motion, Markdown overrides. |
| `src/lib/theme.ts` | Theme preference (`system`/`dark`/`light`), resolution, `data-theme`, theme-color meta. |
| `src/pages/TimelinePage.tsx` | Timeline feed and utility rail: notes and boards, search, calendar filter, board menus. |
| `src/components/timeline/useTimelinePageState.ts` | Timeline paging, search, calendar range, merged note/board feed. |
| `src/components/timeline/items.ts` | Pure feed helpers: board visibility and note/board merge ordering. |
| `src/components/timeline/TimelineDocumentCard.tsx` | Note feed card: preview, tags, folder, reading statistics. |
| `src/components/timeline/TimelineBoardCard.tsx` | Board feed card: description, folder, task counts, privacy/share indicators, board menu. |
| `src/pages/BoardPage.tsx` | Board detail: header actions, sharing, search, kanban columns, dialogs, privacy. |
| `src/pages/BoardArchivePage.tsx` | Archived boards, restore, permanent delete. |
| `src/pages/PublicBoardPage.tsx` | Public board reader: fetch, header meta, error/empty states. |
| `src/components/public/PublicBoardView.tsx` | Read-only board body grouped into status sections. |
| `src/components/public/board.ts` | Pure public-board helpers: status grouping and task counts. |
| `src/pages/FolderViewPage.tsx` | Folder contents, board rows beside notes, counts, drag targets, board menu, `BoardDialog`. |
| `src/components/folder-view/useFolderViewState.ts` | Folder route state, board summaries for the current folder, board create/edit/menu wiring, drag handlers. |
| `src/components/folder-view/FolderViewGrid.tsx` | Icon/grid folder contents; board cards, private lock, drag start. |
| `src/components/folder-view/FolderViewList.tsx` | List folder contents; board rows, private lock, drag start. |
| `src/components/file-folder-handling/useFileFolderDnD.ts` | Note, folder, and board drag state; board drops call `updateBoard({ folder })`. |
| `src/components/file-folder-handling/context-menu/BoardContextMenu.tsx` | Board context menu: Open board, Edit board, Share. |
| `src/components/file-folder-handling/context-menu/FolderContextMenu.tsx` | Folder context menu, including `New board` filed in that folder. |
| `src/pages/ChatPage.tsx` | Chat empty state, messages, tool activity, composer, history. |
| `src/components/board/useBoardState.ts` | Task load, realtime refresh, create/edit/delete, drag state, optimistic reorder. |
| `src/components/board/useBoardSummaries.ts` | Timeline/folder/archive board data and realtime refresh. |
| `src/components/board/AddToBoardHost.tsx` | The single root picker host driven by `addToBoardRequestAtom`. |
| `src/components/board/AddToBoardDialog.tsx` | Board picker for a note; create-inline board support. |
| `src/components/board/ImportNoteDialog.tsx` | Board-scoped note import from the board header. |
| `src/components/board/BoardDialog.tsx` | Create/edit board, folder selector, private switch, archive confirmation. |
| `src/components/board/TaskDialog.tsx` | Create/edit task, column/priority select, delete confirmation. |
| `src/components/board/TaskCard.tsx` | Ledger task row: title, excerpt, priority code, due date, linked note, labels. |
| `src/components/NewContentMenu.tsx` | Shared New menu: New note / New board for the sidebar and timeline. |
| `src/components/sidebar/BoardItem.tsx` | Board row in the sidebar Library tree. |
| `src/components/sidebar/useSidebarBoards.ts` | Active board list for the sidebar tree, refreshed by board realtime events. |
| `src/components/board/board-config.ts` | Column labels/hints and priority labels/codes. |
| `src/components/ui/` | Shared primitives: PageShell, PageHeader, Button, Field, Card, Dialog, Sheet, Menu, ConfirmDialog, EmptyState. Toasts live in `src/components/Toast.tsx`. |
| `src/state/atoms.ts` | UI, document, loading, editor, realtime, and add-to-board request atoms. |

## How it works

### Routes

| Path | Page | Protection |
| --- | --- | --- |
| `/` | Sign in | Public |
| `/onboarding` | First-user onboarding | Public |
| `/reset-password` | Password reset | Public |
| `/confirm-email-change` | Email-change confirmation | Public |
| `/public/document/:shareToken` | Public document view | Public |
| `/public/folder/:shareToken` | Public folder view | Public |
| `/public/board/:shareToken` | Public board reader | Public |
| `/timeline` | Timeline | Protected |
| `/board` | Redirect to `/timeline` | Protected |
| `/board/archive` | Archived boards | Protected |
| `/board/:boardId` | Board kanban | Protected |
| `/folders`, `/folders/:folderId` | Folder view | Protected |
| `/folders/trash`, `/folders/trash/:trashFolderId` | Trash | Protected |
| `/folders/shared` | Shared-content view | Protected |
| `/chat`, `/chat/:conversationId` | AI chat | Protected |
| `/settings`, `/settings/:tab` | Settings | Protected |
| `/settings/admin/:section` | Workspace administration | Admin only |
| `/document/:id` | Document editor | Protected |

`ProtectedRoute` waits for auth loading, redirects unauthenticated users to `/`, and uses `<Navigate replace>`. Heavy routes are lazy-loaded: `BoardArchivePage`, `BoardPage`, `SettingsPage`, `DocumentEditor`, `PublicDocumentPage`, `PublicFolderPage`, and `PublicBoardPage`. Unknown paths redirect to `/`; `/board` keeps old links working by redirecting to the timeline.

Mobile route transitions follow the order `/timeline` → `/folders` → `/chat` → `/settings`; board detail and archive routes group with the timeline. Document routes are treated separately. The transition is a 14px lateral slide under 768px.

### Auth flow

1. `AuthProvider` reads the PocketBase auth store on mount.
2. A stored session is trusted only while its token is unexpired; expired or half-populated stores are cleared.
3. Valid tokens are confirmed with `pb.collection('users').authRefresh()`. Auth failures clear the session and show a session-expired toast; network failures keep it for a later check.
4. While the app is open, the session is re-validated on focus/visibility change and at most every five minutes.
5. `pb.afterSend` clears the auth store on a `401` only when the failing request used the current token, so a delayed response from an older session cannot sign out a fresh login.
6. `checkHasUsers()` calls `/api/check-users` to choose onboarding vs sign-in.
7. Sign-in uses `authWithPassword`; sign-up creates a user then signs in.
8. On auth change, the client requests an attachment file token (see `src/lib/documents/attachments.ts`).
9. Server-side, protected Bun APIs call `verifyAuth()`; PocketBase collection rules protect browser data access.

The first user becomes an admin and is auto-verified by PocketBase hooks. Public signup is locked after that; admins create additional users from settings.

### State model

All shared atoms live in `src/state/atoms.ts`.

| Group | Examples |
| --- | --- |
| UI | `sidebarOpenAtom`, `sidebarResizingAtom`, selected document, unsaved changes, new-document session |
| Data | folders tree, root documents, documents by folder, recent documents, trash documents/folders |
| Loading | data loading lock, initial-load completion, loaded/loading folder sets |
| Editor | selected document, creating flag, save callback, initial title/content, creation session ID |
| Realtime | timeline tick / refresh triggers |
| Board | `addToBoardRequestAtom` only; `useBoardState` owns the open board's tasks, `useBoardSummaries` owns timeline/archive/folder rows, including `folder`, `is_private`, and `is_public` |

Critical rules:

- **`useDocumentData()` is called exactly once**, in `AppContent` in `src/App.tsx`. It sets up realtime subscriptions, initial loading, and lazy folder loading. Never call it from a child component.
- Read atoms with `useAtomValue()`; write with `useSetAtom()`. Avoid `useAtom` when only one side is needed.
- Use write-only action atoms (`resetEditorAtom`, `startNewDocumentAtom`, `selectDocumentAtom`, `saveDocumentAtom`) for editor transitions.
- Folder documents load lazily through `useFolderLazyLoading()` when a folder is expanded.
- Realtime subscriptions are initialized once per user session by `useRealtimeSubscriptions()`; it consumes PocketBase SSE for documents, folders, and trash.
- `initialLoadDoneAtom` is stored in `sessionStorage` on purpose: it tracks one browser session.
- Client preferences (sidebar width, auto-save delay, default homepage, last non-document route, expanded folders) live in `src/lib/settings.ts` and `localStorage`, not Jotai.

Initial load order is recent documents, root documents, folders + trash folders, then trash documents. A 20-second timeout unblocks the UI if PocketBase is slow; don't remove it without a replacement.

### Timeline

`/timeline` is the cross-surface feed: notes and active boards, newest first.

- `useTimelinePageState()` loads notes in pages of 20 through `getTimelineDocumentsPage()` and reads active `BoardSummary` rows from `useBoardSummaries(false)`. Summaries carry `lastActivity`, the later of the board's `updated` and its newest task's `updated`, so working a board's tasks moves the board in the feed.
- Notes and boards merge into one list and group by activity day: Today, Yesterday, then a date label.
- Infinite scroll pages notes only. Until every note page is loaded, boards older than the oldest loaded note wait for the next page; once the feed is complete, every active board appears. Boards are already fully loaded, so no board paging exists.
- Search matches note title/content/tags through `searchDocuments()` and board name/description locally. The calendar range filters both notes and boards by their activity timestamp.
- A segmented **All / Notes / Boards** control filters the feed. Boards-only skips the note paging cutoff; notes-only skips the initial board wait. The labels and the rail count the records available in the current view.
- **New** in the header opens the shared New menu (`NewContentMenu`): New note starts the editor, New board opens `BoardDialog` and then the created board.
- Note cards keep the document context menu and add-to-board flow. Board cards open `/board/:id` and show the private lock, public-share icon, folder, and open/done counts; archived boards stay out of the feed.
- Board cards match note-card interaction: right-click, the overflow button, or a touch long-press opens `BoardContextMenu` with Open board, Edit board, and Share. Editing uses `BoardDialog`; sharing uses the shared modal.
- The rail counts notes, boards, and folders in the current view. Its lower action opens `/board/archive`.
- Realtime note changes bump `timelineRealtimeTickAtom`; `useBoardSummaries()` refreshes boards from its board and task subscriptions.
- There is no separate boards index. `/board` redirects to `/timeline`; archived boards remain at `/board/archive` and are linked from the timeline rail and the Library header.

### Boards in the library

Boards are created and opened from the surfaces that already hold them.

- The sidebar Library tree lists root boards and boards inside expanded folders. `useSidebarBoards()` loads active boards through `listBoards()` and refreshes on board realtime events.
- The Library header has **New board** and **Archived boards** actions beside New folder and New note. Board rows use the column icon, private lock, public-share icon, Open/Edit/Share menu, and drag between folders.
- `useBoardSummaries()` loads `listBoardSummaries()`: one boards query plus one task query, then sums open/done counts and records the latest task update per board as `lastActivity`.
- Board and task realtime events both refresh timeline and folder summaries after a 450ms debounce.

### Board detail

`/board/:boardId` is the kanban for one board.

- `getBoard(boardId)` loads the board; a `404` renders “That board is not here”.
- `useBoardState(activeBoardId)` only receives an id when the board is loaded and not archived. An archived board therefore loads no tasks and renders a restore state.
- Header actions for an active board: `Import note`, `New task`, a share icon that opens `PublicShareModal`, and an edit icon that opens `BoardDialog`.
- A private board shows a lock beside the title; a publicly shared board shows a share icon. `BoardDialog` has a `Private` switch; changing it updates `is_private` without moving the board.
- The header back link returns to the timeline. Archived boards and missing boards offer timeline actions, not a boards index.
- Columns are fixed: `backlog`, `next`, `progress`, `done`, labelled Backlog, Next up, In progress, Done. Each lane has a status dot; only In progress is signal-coloured.
- `xl` is a four-column grid. Below that, lanes are a horizontal snap row (`w-[min(86vw,340px)]`); mouse users scroll, touch users swipe.
- Task cards are rounded `surface` panels inside a `surface-sunken` lane. They show title, a plain-text excerpt, a `P0`–`P3` priority chip, due date (danger when overdue and not done), a linked-note title, and up to two label chips. Done titles are muted and struck through.
- Dragging changes `status` and reindexes `board_order`; the UI updates optimistically and reloads on failure. Dragging is paused while the search filter is active, because a filtered index does not match stored order.
- HTML5 drag-and-drop is pointer-only. On touch, the task dialog's column select is the movement path.
- Search filters title, description, and labels locally.
- An empty board shows “No tasks yet” with a `New task` action.
- `BoardDialog` handles create/edit and archive. Archive is confirmed with `ConfirmDialog` and explained as “nothing is deleted”.
- `TaskDialog` handles create/edit, column, priority, due date, comma-separated labels, linked-note opening, and delete confirmation.
- `ImportNoteDialog` is board-scoped: it lists notes, marks notes already on this board via `existingDocumentIds`, and creates a task linked to the chosen note.
- Realtime task changes refresh the board after a debounce; a skip flag suppresses echo refresh during a local drag write.

### Board archive

`/board/archive` lists only `archived = true` boards and is reached from the Library header or the timeline rail.

- Each card shows name, description, task count, archived date, Restore, and Delete forever.
- `Restore` clears `archived` and removes the row locally.
- `Delete forever` opens a danger `ConfirmDialog` that states the board and its tasks are removed permanently and the source notes stay in the library.
- `deleteBoardPermanently()` relies on the PocketBase delete rule and the `tasks.board` cascade. There is no client-side task deletion loop.

### Folder view

`/folders` and `/folders/:folderId` show notes, subfolders, and active boards for the current folder.

- `useFolderViewState()` calls `useBoardSummaries(false)` and filters `board.folder === currentFolderId`. The shared view lists every active `is_public` board. Boards are omitted in trash and while a route folder is pending.
- The header meta counts folders, notes, and boards. Actions are `New folder`, `New board`, and `New note`.
- A board row/card shows a column icon, name, relative updated date, task counts (`N open · N/M done`, or `No tasks`), a lock when private, and a share icon when public. Clicking it opens `/board/:id`; the overflow button opens `BoardContextMenu` with `Open board`, `Edit board…`, and `Share…`.
- `New board` and the folder context menu's `New board` create in the current folder, or in the folder the context menu was opened on. `BoardDialog` receives that `folderId`; a successful create navigates to the new board.
- Boards are draggable between folders like notes. The drop calls `updateBoard(board.id, { folder })`; an empty destination is the root. The PocketBase guard validates folder ownership.
- Editing a board opens `BoardDialog` with the board, its current folder selected, and a folder selector for moving it without drag. The dialog can also archive the board.
- Folder trash and permanent delete rehome boards to the root on the server. The folder view does not list boards in trash; the shared view lists public boards.
- Archived boards are absent from folder views; `/board/archive` owns restore and permanent delete.

### Add to board

There is one picker for the whole app:

1. Timeline, Folder view, and the sidebar context menu call `setAddToBoardRequest({ documentId })`.
2. `AddToBoardHost` is mounted once in `App.tsx`, reads `addToBoardRequestAtom`, and renders `AddToBoardDialog`.
3. The dialog loads active board summaries and `listTaskBoardIdsForDocument()`. Boards that already hold a task from this note show `Already here` and are disabled.
4. Choosing a board calls `getDocument()` then `createTaskFromDocument()`, which copies the title, a plain-text excerpt, up to six tags, and the `document` relation.
5. If there are no boards, the dialog offers `Create a board` inline.

Do not add another “add to board” modal at a call site. Every entry point sets the atom.

The board detail header uses a different flow: `ImportNoteDialog` imports into the board currently open, so it does not need a board picker.

### Chat surface

`/chat` and `/chat/:conversationId` render the assistant.

- The route uses the shared `PageHeader`; the conversation body is a 920px reading column. The empty state is `Ask your notes.`, with a short explanation and four prompt cards in a 2×2 grid. There is no document picker and no attachment control.
- Assistant messages are document text in a 68ch column, with Markdown rendered through `MarkdownPreview` (sanitized). User messages are right-aligned in a bordered `surface-raised` block.
- Tool activity is one quiet pill above the answer: “Searched notes”, “Read a note”, “Read a board”, “Checked boards”, or “Checked the workspace” for unknown names. While a tool runs it reads “Looking through your workspace…” with a pulsing signal dot.
- The client keeps a local `running` status and call id while streaming; the server persists only terminal `{ name, status }`, and the history view shows only names/statuses.
- Reasoning is a collapsible details block; an empty streaming answer shows “Thinking…”.
- The composer is a 12px bordered shell with `Enter to send · Shift+Enter for a new line`; the placeholder is `Ask about your notes or board...`.
- Conversation history is a right-side panel (collapsible desktop, overlay mobile) with new-chat and delete actions.
- A module-level `streamStore` survives navigation so a reply can finish while the page is unmounted; re-entering the conversation rehydrates from it.
- The empty-response fallback is `CHAT_EMPTY_RESPONSE_FALLBACK` from `src/api/chat/types.ts`.

### Editor, sidebar, and settings

- `src/components/DocumentEditor.tsx` is split under `src/components/editor/`: state, loader, autosave, actions, attachments, content, overlays.
- Autosave is debounced by the user's configured delay, clamped to at least 200 ms. `creationSessionIdAtom` protects against stale callbacks.
- `published: true` triggers a PocketBase version snapshot of the previous content, then resets the flag.
- Attachments are protected files; the client obtains a short-lived file token for rendering.
- Notes over 5 MB warn; over the 100 MB database limit the warning becomes an error. Thresholds live in `ContentSizeWarning.tsx`.
- Sidebar: full sidebar docked at `>=1024px`; 768–1023px uses the 64px rail with the full sidebar as an overlay; below 768px the sidebar is an overlay plus a bottom navbar. Folder trees are in `src/components/sidebar/`; folder contents in `src/components/folder-view/`; drag-and-drop in `src/components/file-folder-handling/`.
- The sidebar Library tree mixes root notes and root boards; an expanded folder shows its notes and boards together. `useSidebarBoards()` loads active boards through `listBoards()` and refreshes on board realtime events. Board rows use the column icon, private lock, public-share icon, Open/Edit/Share menu, and drag between folders. The Library header includes **New board** and **Archived boards**; the global **New** button opens `NewContentMenu` with New note and New board.
- Settings: `/settings/account`, `/settings/preferences`, `/settings/admin/general|people|email|signin|ai`, `/settings/about`. The URL owns the tab. AI covers providers, models, generation parameters, and prompts; there is no embedding or search-index section.
- Public pages fetch through `/pb/api/public/...` and skip authenticated app data; `AppContent` disables `useDocumentData()` for `/public/`. Documents, folders, and boards each have a public reader route; `PublicBoardPage` renders the board description and status-grouped tasks without task-note links.
- The `PublicShareModal` supports documents, folders, and boards. Boards hide the attachment switch because they have no files. The `Private` switch hides the record from AI chat and MCP and from shared parents; a private board cannot be public. It does not hide the record from its owner.
- The default homepage setting no longer offers a separate boards page; stored `board` preferences open the timeline instead.
- PWA: the manifest and `/sw.js` are served by `src/index.ts`; `InstallBanner` uses `useInstallPrompt()`; the service worker is intentionally minimal.

### Styling and UI conventions

- TailwindCSS v4 utilities over semantic tokens from `src/index.css`. The canonical token table, type scale, and component contracts are in [`../DESIGN.md`](../DESIGN.md).
- Use `bg-surface`, `border-line`, `text-ink`, `text-ink-secondary`, `text-ink-muted`, `bg-signal-bright`, `text-signal`, `bg-signal-soft`, `text-warning`, `text-success`, `text-danger`, and the `rounded-control` / `rounded-panel` / `rounded-sheet` radii.
- Do not use raw `gray`/`stone`/`blue` families, `dark:`/`light:` variants, gradients, grain, glass blur, or serif faces.
- Type: Geist for every interface role; Geist Mono only for code, ids, and URLs inside prose. UI counts and dates use Geist with `tabular-nums`, not mono. Labels are sentence case. Fonts are self-hosted from `src/assets/fonts/`; CSP `font-src 'self'`.
- Page chrome: `<PageShell>` is the one route frame (centered max 1280px, 20/32/48px gutters; 820px reading, 1600px wide). `<PageHeader>` renders a 28/34px title, optional description and meta strip, optional back link, and right-aligned actions; the `eyebrow` prop is accepted for compatibility but not rendered. Chat keeps its body to an 800px reading column; Settings bounds its working area at 1100px. Route content is full bleed beside the docked sidebar; do not wrap a page in an outer card or inset frame.
- Cards: `<Card>` + `<SectionHeading>`. Inputs: `<Field>` with `<Input>`/`<Textarea>`/`<Select>`. Booleans: `<Switch>`/`<Checkbox>`. Segmented choices: `<SegmentedControl>`.
- Buttons: `<Button variant="primary|secondary|ghost|danger|link">`; icon-only actions use `<IconButton label="…">`. Primary buttons fill with `signal-bright`, not `signal`.
- Every modal is a `Dialog` (or `Sheet` on touch). Confirmation uses `ConfirmDialog` with `tone="danger"`. Do not add another fixed overlay.
- `EmptyState` is a centred 10px `surface` panel with an optional neutral icon tile; `compact` drops the panel chrome and left-aligns the copy.
- Toasts: `useToasts()` + `<ToastHost>`. Icons: `@heroicons/react`.
- Theme: read tokens in CSS; use `useTheme()` only when a component needs the resolved value. Respect reduced motion.
- Check desktop and mobile; many components have separate paths.

### Frontend quality checklist

Accessibility:

- Icon-only buttons have an accessible name (`aria-label` or a visible label).
- Menus, dialogs, and popovers close on Escape, manage focus, and restore focus on close. Use the shared primitives.
- Drag-and-drop has a keyboard/touch alternative (open the task and change its column).
- Controls are keyboard reachable; text and action contrast holds in both themes.
- Touch targets are practical on mobile.

Interaction:

- Loading, saving, empty, and error states are clear and actionable.
- Destructive actions are visually distinct and confirmed where appropriate.
- Hover-only affordances have a touch path.
- Mobile overlays are not clipped and do not trap the user.

Consistency:

- Similar controls use `src/components/ui/` and semantic tokens; no local variants.
- Typography hierarchy and icon sizes are consistent.
- No new visual language for a local fix.

Performance:

- Don't subscribe components to atoms they don't render.
- Memoize expensive derived lists only when measured or clearly needed.
- Don't move data orchestration into leaf components.
- Keep lazy loading and realtime behavior intact.

## Gotchas & invariants

- **`useDocumentData()` must stay at `AppContent`.** A second call duplicates realtime subscriptions and initial loads.
- **Board tasks are not Jotai state.** `useBoardState` owns the open board; `useBoardSummaries` owns index/archive/folder rows. Putting tasks in a global atom would fight both realtime refreshes and the drag skip flag.
- **Folder boards are active only.** `useFolderViewState()` passes `false` to `useBoardSummaries()` and filters by `folder`; shared mode lists active `is_public` boards. Archived boards belong to `/board/archive`, not the folder view.
- **Board drag moves the folder only.** `useFileFolderDnD` calls `updateBoard(id, { folder })`; it does not touch the board's tasks, archive state, or `name`/`description`.
- **Editing a board does not move it.** `BoardDialog` sends the folder only on create. Moving is a drag or the folder context menu, not an implicit edit side effect.
- **Folder trash keeps boards.** The server rehomes boards to the root before removing the folder. Do not add a client-side board delete loop or treat a missing folder as a deleted board.
- **The private lock is not a UI gate.** `/api/v1` and the browser SDK still show private records to their owner; chat and MCP hide them. The lock icon only explains the state.
- **The board detail passes `undefined` to `useBoardState` while archived.** That is what prevents task loading; don't “fix” it by always passing `boardId`.
- **Search pauses dragging.** A filtered column has a different index than the stored order; allowing a drop would write the wrong `board_order`.
- **There is one AddToBoard picker.** `AddToBoardHost` is mounted at the app root; call sites only set `addToBoardRequestAtom`.
- **The board header import is board-scoped.** It uses `ImportNoteDialog` and `existingDocumentIds`, not the root picker. Don't merge the two flows.
- **Archived boards are absent from the add-to-board picker.** `AddToBoardDialog` filters `!board.archived`; a stale request cannot target one.
- **Chat has no attachments.** There is no document picker, no `documentIds`, and no source chips. Adding one requires a new retrieval design, not a UI-only change.
- **Tool activity is not a citation list.** It shows names and statuses only; the answer must cite titles in its own text.
- **`PageHeader` accepts an eyebrow it does not render.** The prop is kept for compatibility; adding an eyebrow back is a design change, not a styling tweak. `EmptyState.icon` is rendered as a neutral tile when not compact.
- **Mobile drag is not available.** HTML5 drag-and-drop is pointer-only, so note, folder, task, and board moves are desktop paths. The task dialog's column select is the supported touch path for tasks; board folder moves have no touch path yet.
- **The 20-second initial-load timeout is deliberate.** It unblocks a slow PocketBase; removing it can leave the shell on a spinner.

## Related docs

- [`architecture.md`](architecture.md) — request flow and process topology.
- [`api.md`](api.md) — chat, export, board/task collection payloads.
- [`pocketbase.md`](pocketbase.md) — schema, hooks, and rules behind the UI.
- [`ai.md`](ai.md) — chat tools, providers, and persistence.
- [`development.md`](development.md) — build and verification commands.
- [`../DESIGN.md`](../DESIGN.md) — Graphite tokens, type, components, motion.
