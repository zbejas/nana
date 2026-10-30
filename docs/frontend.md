# Frontend — routes, state, and surfaces

## Overview

The frontend is a React 19 SPA built with Bun, styled with TailwindCSS v4 and the Graphite tokens, and routed with React Router v7. Jotai owns shared UI and document state; data is accessed through the small client in `src/lib/pocketbase.ts`, which talks only to Elysia `/api/v1`. Board task state is route-local, not global. Boards live in the timeline, folder view, and sidebar rather than a separate index; private boards carry a lock and publicly shared boards carry a share indicator.

The visual system is documented in [`../DESIGN.md`](../DESIGN.md); product truth is in [`../PRODUCT.md`](../PRODUCT.md).

## Key files

| File | Role |
| --- | --- |
| `src/index.html` | SPA shell; loads `src/frontend.tsx` and the theme bootstrap. |
| `src/frontend.tsx` | Creates the React root, wraps the app in Jotai `Provider` and `AuthProvider`, registers the service worker. |
| `src/App.tsx` | Router, protected routes, layout, sidebar, mobile navigation, lazy pages, `AddToBoardHost`. |
| `src/lib/pocketbase.ts` | Browser client over `/api/v1`: `collection` CRUD, auth store, files, filters, and realtime. |
| `src/lib/auth.tsx` | `AuthProvider` / `useAuth()`: session validation, sign-in, sign-up, OAuth, logout. |
| `src/index.css` | Tailwind entry, Graphite tokens, self-hosted fonts, global styles, motion, Markdown overrides. |
| `src/lib/theme.ts` | Theme preference (`system`/`dark`/`light`), resolution, `data-theme`, theme-color meta. |
| `src/pages/TimelinePage.tsx` | Timeline feed and utility rail: notes and boards, search, calendar filter, board menus. |
| `src/components/timeline/useTimelinePageState.ts` | Timeline paging, search, calendar range, merged note/board feed. |
| `src/components/timeline/items.ts` | Pure feed helpers: board visibility and note/board merge ordering. |
| `src/components/timeline/TimelineDocumentCard.tsx` | Note feed card: preview, tags, folder, reading statistics. |
| `src/components/timeline/TimelineBoardCard.tsx` | Board feed card: description, folder, task counts, privacy/share indicators, board menu. |
| `src/pages/BoardPage.tsx` | Board detail: header actions, inline board settings, task composer, task edit panel, sharing, search, kanban columns, privacy. |
| `src/pages/BoardArchivePage.tsx` | Archived boards, restore, permanent delete. |
| `src/pages/PublicBoardPage.tsx` | Public board reader: fetch, header meta, error/empty states. |
| `src/components/public/PublicBoardView.tsx` | Read-only board body grouped into status sections. |
| `src/components/public/board.ts` | Pure public-board helpers: status grouping and task counts. |
| `src/pages/FolderViewPage.tsx` | Folder contents, board rows beside notes, counts, drag targets, board menu. |
| `src/components/folder-view/useFolderViewState.ts` | Folder route state, board summaries for the current folder, board create/edit/menu wiring, drag handlers. |
| `src/components/folder-view/FolderViewGrid.tsx` | Icon/grid folder contents; board cards, private lock, drag start. |
| `src/components/folder-view/FolderViewList.tsx` | List folder contents; board rows, private lock, drag start. |
| `src/components/file-folder-handling/useFileFolderDnD.ts` | Note, folder, and board drag state; board drops call `updateBoard({ folder })`. |
| `src/components/file-folder-handling/context-menu/BoardContextMenu.tsx` | Board context menu: Open board, Edit board, Share. |
| `src/components/file-folder-handling/context-menu/FolderContextMenu.tsx` | Folder context menu, including `New board` filed in that folder. |
| `src/pages/ChatPage.tsx` | Full-page chat route; shares the chat store with the dock. |
| `src/components/chat/ChatDock.tsx` | Persistent right-side chat dock, mounted outside the keyed route tree; full-width overlay on mobile. |
| `src/components/chat/ChatThread.tsx` | Shared message thread, composer, automatic page context, streaming, and edit cards for the page and dock. |
| `src/components/chat/ChatContextUsage.tsx` | Composer context-window donut and click-through token details. |
| `src/components/chat/ChatEditCard.tsx` | Applied-write card with target link, changed sections/fields, status, and Undo. |
| `src/lib/chat/store.ts` | Chat conversation, streaming, mode, context, sources, and edit/undo state shared by the page and dock. |
| `src/lib/chat/context.ts` | Route-to-context derivation, private-branch check, and `{ type, id }` payload building. |
| `src/components/board/useBoardState.ts` | Task load, realtime refresh, create/edit/delete, drag state, optimistic reorder. |
| `src/components/board/useBoardSummaries.ts` | Timeline/folder/archive board data and realtime refresh. |
| `src/components/board/AddToBoardHost.tsx` | The single root picker host driven by `addToBoardRequestAtom`. |
| `src/components/board/AddToBoardPanel.tsx` | Non-modal board picker for a note; creates a board inline. |
| `src/components/board/ImportNotePanel.tsx` | Board-scoped note import from the board header, as a side panel. |
| `src/components/board/BoardSettingsPanel.tsx` | Inline create/edit board form: name, description, folder, private switch, archive confirmation. |
| `src/components/board/TaskPanel.tsx` | Non-modal task inspector: title, Milkdown description, properties, subtasks, relations, activity, comments, duplicate/move/delete. |
| `src/components/board/TaskComposer.tsx` | Compact per-lane task composer for rapid entry. |
| `src/components/board/TaskCard.tsx` | Ledger task row: title, excerpt, priority code, due date, linked note, labels. |
| `src/components/NewContentMenu.tsx` | Shared New menu: New note / New board for the sidebar and timeline. |
| `src/components/sidebar/BoardItem.tsx` | Board row in the sidebar Library tree. |
| `src/components/sidebar/useSidebarBoards.ts` | Active board list for the sidebar tree, refreshed by board realtime events. |
| `src/components/board/board-config.ts` | Column labels/hints and priority labels/codes. |
| `src/components/ui/` | Shared primitives: PageShell, PageHeader, Button, Field, InlineForm, SidePanel, Card, Dialog, Sheet, Menu, ConfirmDialog, EmptyState. Toasts live in `src/components/Toast.tsx`. |
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

1. `AuthProvider` reads the local auth store in `src/lib/pocketbase.ts` on mount.
2. A stored session is trusted only while its token is unexpired; expired or half-populated stores are cleared.
3. Valid tokens are confirmed with `pb.collection('users').authRefresh()` through `/api/v1/auth/refresh`. Auth failures clear the session and show a session-expired toast; network failures keep it for a later check.
4. While the app is open, the session is re-validated on focus/visibility change and at most every five minutes.
5. The request helper clears the auth store on a `401` only when the failing request used the current token, so a delayed response from an older session cannot sign out a fresh login.
6. `checkHasUsers()` calls `/api/v1/check-users` to choose onboarding vs sign-in.
7. Sign-in uses `authWithPassword`; sign-up creates a user then signs in.
8. On auth change, the client requests an attachment file token (see `src/lib/documents/attachments.ts`).
9. Server-side, protected Bun APIs call `verifyAuth()`; the browser facade validates the caller and PocketBase rules protect record and file access.

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
- Realtime subscriptions are initialized once per user session by `useRealtimeSubscriptions()`; it consumes PocketBase SSE for documents and folders. Trash is a soft-delete state and a record leaving the collection list rule does not produce a usable realtime event, so every trash/restore mutation bumps `refreshTriggerAtom` and reloads active, trash, and already-loaded folder lists. The `trash_*` views do not emit realtime events.
- `initialLoadDoneAtom` is stored in `sessionStorage` on purpose: it tracks one browser session.
- Client preferences (sidebar width, auto-save delay, default homepage, last non-document route, expanded folders) live in `src/lib/settings.ts` and `localStorage`, not Jotai.

Initial load order is recent documents, root documents, folders + trash folders, then trash documents. Trash folders/documents come from the read-only `trash_folders`/`trash_documents` views. A 20-second timeout unblocks the UI if PocketBase is slow; don't remove it without a replacement.

### Timeline

`/timeline` is the cross-surface feed: notes and active boards, newest first.

- `useTimelinePageState()` loads notes in pages of 20 through `getTimelineDocumentsPage()` and reads active `BoardSummary` rows from `useBoardSummaries(false)`. Summaries carry `lastActivity`, the later of the board's `updated` and its newest task's `updated`, so working a board's tasks moves the board in the feed.
- Notes and boards merge into one list and group by activity day: Today, Yesterday, then a date label.
- Infinite scroll pages notes only. Until every note page is loaded, boards older than the oldest loaded note wait for the next page; once the feed is complete, every active board appears. Boards are already fully loaded, so no board paging exists.
- Search matches note title/content/tags through `searchDocuments()` and board name/description locally. The calendar range filters both notes and boards by their activity timestamp.
- A segmented **All / Notes / Boards** control filters the feed. Boards-only skips the note paging cutoff; notes-only skips the initial board wait. The labels and the rail count the records available in the current view.
- **New** in the header opens the shared New menu (`NewContentMenu`): New note starts the editor; New board creates a provisional “Untitled board”, opens it, and focuses the inline naming panel.
- Note cards keep the document context menu and add-to-board flow. Board cards open `/board/:id` and show the private lock, public-share icon, folder, and open/done counts; archived boards stay out of the feed.
- Board cards match note-card interaction: right-click, the overflow button, or a touch long-press opens `BoardContextMenu` with Open board, Edit board, and Share. Editing navigates to the board with its inline settings panel open; sharing opens the owner-only `SharePanel`.
- The rail counts notes, boards, and folders in the current view. Its lower action opens `/board/archive`.
- The feed/rail split uses a container query on the route content (`.timeline-page`), not viewport `xl`. When the sidebar and chat dock leave less than 820px, the rail hides, a compact in-view summary row stays above the feed, and the calendar moves behind the **Dates** header action; the feed keeps its full width instead of collapsing into a narrow column.
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
- Header actions for an active board: `Import note`, `New task`, a share icon that opens the owner-only `SharePanel`, and an edit icon that toggles the inline board settings panel. Effective access comes from `useResourceAccess('board', id)`: view and comment grantees get a read-only board; edit grantees can create and edit tasks; only the owner sees sharing, board settings, archive, and column management.
- `TaskPanel` receives `canEdit`, `canDelete`, and `canComment` from the board shell. The server remains authoritative; hiding controls is a UX layer, not the permission boundary.
- A private board shows a lock beside the title; a publicly shared board shows a share icon. `BoardSettingsPanel` has a `Private` switch; changing it updates `is_private` without moving the board.
- The header back link returns to the timeline. Archived boards and missing boards offer timeline actions, not a boards index.
- Columns are board-owned and ordered (`board_columns`): name, stable slug, colour/icon, position, and `is_final`. New boards seed Backlog, Next up, In progress, and Done; settings can add, rename, recolour, reorder, and remove unused columns, plus choose the final column. `planned` and `archived` are virtual statuses for the backlog, not columns.
- Board view lays the ordered lanes out in a responsive grid; below the wide breakpoint the lanes become a horizontal snap row (`w-[min(86vw,360px)]`). The toolbar switches between Board, List, Backlog, Calendar, and Gantt views, with filters, sort, and display preferences per board.
- On phones and short landscape viewports the board chrome compacts before it reaches the lanes: the header drops the description/meta, the toolbar becomes a two-row grid, Filter/Sort become icon targets on very narrow phones, and the lane row keeps a minimum height. The page scrolls when header, toolbar, onboarding, and the lane floor cannot all fit, so `.board-lane-body` always has a real scroll area. The empty-board tip stays in normal flow below the toolbar and wraps its actions; it is never an overlay.
- Calendar view renders the month grid with a right-side Unscheduled rail on large screens, an agenda plus one Unscheduled action on phones, and the header Unscheduled button only at tablet widths. Calendar and Gantt stay reachable through the horizontally scrolling view switcher, which shows a right-edge cue on narrow phones.
- Task cards are rounded `surface` panels inside a `surface-sunken` lane. They show title, a plain-text excerpt, a `P0`–`P3` priority chip, due date (danger when overdue and not done), a linked-note title, and up to two label chips. Done titles are muted and struck through.
- Dragging changes `status` and reindexes `board_order`; the UI updates optimistically and reloads on failure. Dragging is paused while the search filter is active, because a filtered index does not match stored order.
- HTML5 drag-and-drop is pointer-only. On touch, the task edit panel's column select is the movement path.
- Search filters title, description, and labels locally.
- An empty board shows “No tasks yet” with a `New task` action.
- `BoardSettingsPanel` is a page-level inline form; when it is open the board content is replaced, so the page can scroll instead of compressing the kanban. Archive is confirmed with `ConfirmDialog` and explained as “nothing is deleted”.
- Task creation uses the compact `TaskComposer` at the bottom of each lane: Enter adds and keeps the composer open for rapid entry. Editing opens `TaskPanel`, a non-modal right-side inspector with the title, Milkdown description, status/priority/assignee/date/label/recurrence properties, subtasks, relations, activity, comments, duplicate/move/delete, and close-flush saves. On mobile it becomes full-width; on desktop it is a 44rem panel.
- `ImportNotePanel` is board-scoped: it lists notes, marks notes already on this board via `existingDocumentIds`, and creates a task linked to the chosen note.
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
- The grid uses `repeat(auto-fill, minmax(9.5rem, 1fr))`, so opening the chat dock reduces the column count instead of shrinking cards below a readable width. The archived-board grid uses the same idea with a 17rem minimum.
- A board row/card shows a column icon, name, relative updated date, task counts (`N open · N/M done`, or `No tasks`), a lock when private, and a share icon when public. Clicking it opens `/board/:id`; the overflow button opens `BoardContextMenu` with `Open board`, `Edit board…`, and `Share…`.
- `New board` and the folder context menu's `New board` create a provisional board in the current folder, or in the folder the context menu was opened on, then navigate to it with the inline naming panel open.
- Boards are draggable between folders like notes. The drop calls `updateBoard(board.id, { folder })`; an empty destination is the root. The PocketBase guard validates folder ownership.
- Editing a board navigates to `/board/:id` with `state.editBoard`, so the inline settings panel opens with the board, its current folder, and a folder selector for moving it without drag. The panel can also archive the board.
- Folder trash and permanent delete rehome boards to the root on the server. The folder view does not list boards in trash; the shared view lists public boards. Moving a folder or note to trash keeps its id, so the trash editor reads the same record through a `trash_*` view.
- Archived boards are absent from folder views; `/board/archive` owns restore and permanent delete.

### Add to board

There is one picker for the whole app:

1. Timeline, Folder view, and the sidebar context menu call `setAddToBoardRequest({ documentId })`.
2. `AddToBoardHost` is mounted once in `App.tsx`, reads `addToBoardRequestAtom`, and renders the non-modal `AddToBoardPanel`.
3. The panel loads active board summaries and `listTaskBoardIdsForDocument()`. Boards that already hold a task from this note show `Already here` and are disabled.
4. Choosing a board calls `getDocument()` then `createTaskFromDocument()`, which copies the title, a plain-text excerpt, up to six tags, and the `document` relation.
5. If there are no boards, the panel offers `Create a board` inline; the new board appears in the list immediately so it can be chosen.

Do not add another “add to board” overlay at a call site. Every entry point sets the atom.

The board detail header uses a different flow: `ImportNotePanel` imports into the board currently open, so it does not need a board picker.

### Chat surface

Chat has two entry points that share one store: the full page at `/chat` and `/chat/:conversationId`, and the persistent `ChatDock` mounted at the app root outside the keyed route tree. The dock is hidden while the chat page is open; on desktop it is a right-side panel, and on mobile it is a full-width overlay. A reply started in one entry point remains available in the other. On mobile a real pathname change closes the dock so it cannot cover the newly opened route; the initial route keeps a persisted-open dock, and desktop keeps the dock across navigation.

- Both use `ChatThread`. The composer has a **Work/Ask** control. Work is the default and sends `mode: "edit"`; it can read, create, rename, move, and update folders, notes, boards, and tasks, and archive/restore boards. Ask sends `mode: "ask"` and is the read-only lock. Delete tools open a pending approval card instead of mutating immediately; the user confirms or cancels.
- The dock derives context from the current route automatically: a note, board, or folder id. It sends only `{ type, id }` at send time and shows no context chip; the server resolves the record, rejects private, trashed, or foreign ids, and adds only the id to the system prompt. Private pages and lookups still loading are omitted.
- The chat page uses the shared `PageHeader`; its conversation body is an 800px reading column. The empty state is mode-aware: Work reads “Ask, or change something.” with four prompt cards in a 2×2 grid. The composer has a compact model picker, a context-usage ring, and, when the admin enables them, an attachment control. Draft files stay above the textarea as removable chips; sent attachments render above the user bubble. Per-model vision/PDF flags gate the attachment button and the server re-checks the stored file type and selected model.
- The desktop dock is resizable from its left edge (320–720px total, with a 256px history column). The width persists in `nana-chat-dock-width`; opening another document never resets it. Chat has one global entry, not a per-page header button: a signal-tinted **Chat** action above **New** in the full sidebar, a distinct signal-tinted chat button at the top of the collapsed rail, and a **Chat** item in the mobile bottom bar toggle the dock. Cmd/Ctrl+J remains the keyboard shortcut. The full `/chat` page is still available for deep links.
- Assistant messages are document text in a readable column, with Markdown rendered through `MarkdownPreview` (sanitized). User messages are right-aligned in a bordered `surface-raised` block. The assistant rabbit mark is 28px in messages and 32px in the dock header so the mark stays legible. Conversation titles are plain text; emoji, flags, and keycaps are stripped on generation, rename, and read.
- Tool activity is one quiet pill above the answer, summarized from streamed tool parts. It shows read/write verbs and titles when known; persisted history keeps only terminal `{ name, status }` with no inputs or outputs.
- Sources render under the answer as a collapsed `Sources · N` disclosure. Expanding it reveals note and board links collected by the server from records whose content was read or successfully created/updated; list/search calls alone do not become sources. They are not model-invented citations.
- Tool activity is one disclosure above the final answer: a quiet summary pill expands to one line per tool call, then one line per applied edit. Tool and edit rows share the same icon, title, muted detail, status chip, and row height. Expanding an edit shows its changed sections or fields, Open link, and Undo action. Pending deletes auto-expand the disclosure and the edit row with **Move to trash** / **Delete** and **Keep** actions; nothing is written until the destructive action is confirmed. Note creations and note edits are undoable; board/task cards are informational.
- The composer toolbar has a context-usage ring. It is a 22px donut with a 32px hit target; the arc uses signal, warning at 75%, and danger at 90%. Clicking opens a details card with the percentage, input/output/cached token counts, remaining room, model context window, and the source of the measurement (the final step of the latest reply). Missing context windows show token counts without a fabricated percentage.
- Reasoning is a collapsible details block; an empty streaming answer shows “Thinking…”.
- The composer is a 12px bordered shell with `Enter to send · Shift+Enter for a new line`; the placeholder is `Ask about your notes or board...`.
- Conversation history is a right-side panel on desktop, an in-dock panel in the dock, and an overlay sheet on mobile, with new-chat and delete actions. The mobile sheet is a modal layer: focus moves inside, Tab is trapped, Escape closes it, and browser Back dismisses the sheet before leaving the route. The dock also traps Tab on mobile and closes on Escape while focused.
- A module-level `streamStore` survives navigation so a reply can finish while the page is unmounted; re-entering the conversation rehydrates from it.
- The empty-response fallback is `CHAT_EMPTY_RESPONSE_FALLBACK` from `src/api/chat/types.ts`.

### Editor, sidebar, and settings

- `src/components/DocumentEditor.tsx` is split under `src/components/editor/`: state, loader, autosave, actions, attachments, content, overlays.
- `src/components/editor/milkdown/` owns the editor: `createEditor.ts` (Milkdown kit, GFM, prism, upload, placeholder, slash trigger), `useMilkdownEditor.ts` (StrictMode-safe lifecycle, controlled value sync, toolbar snapshot), `NanaMarkdownEditor` (WYSIWYG + toolbar), `NanaSplitMarkdownEditor` (CodeMirror source + Milkdown, scroll-synced; pane stacking is driven by the editor container width, not the viewport), `NanaSourceEditor`, and `NanaInlineMarkdownEditor` for task descriptions and comments. `@uiw/react-markdown-preview` remains the read-only renderer for public pages, chat, and version preview.
- Editor modes are `wysiwyg | text | split`; the header labels them Editor, Source, Split. Desktop defaults to split; mobile defaults to the rendered editor. The source pane is CodeMirror 6, not a textarea. Read is not a separate mode: the rendered editor is the reading surface. Split remains a desktop-only surface: the mobile header toggle cycles Editor ↔ Source and never stores or exposes an inaccessible split state.
- GitHub alerts and raw `<details>`/`<summary>` blocks render in the editor. Details keep their source markup, but the Milkdown surface shows a collapsible summary row instead of raw tags; expanding it reveals the body without changing the Markdown. `MarkdownPreview` renders native details in chat/public output.
- The editor header keeps the AI action, fullscreen toggle, overflow menu, and close. Share, export, save-version, and move-to-trash live in the overflow menu; the preference for fullscreen persists in `nana-editor-fullscreen`, so opening another note keeps the choice.
- Autosave is debounced by the user's configured delay, clamped to at least 200 ms. `creationSessionIdAtom` protects against stale callbacks. Saves send the loaded `revision`; PocketBase rejects a stale content/title/tags write so two writers cannot silently clobber each other.
- `published: true` triggers a PocketBase version snapshot of the previous content and metadata, then resets the flag. AI edits use the same snapshot path with `source: "ai"` and actor `Nana`.
- The first Milkdown serialization is treated as the baseline. Opening a note must not mark it dirty or create a version.
- Attachments are protected files; the client obtains a short-lived file token for rendering.
- Notes over 5 MB warn; over the 100 MB database limit the warning becomes an error. Thresholds live in `ContentSizeWarning.tsx`.
- Sidebar: full sidebar docked at `>=1024px`; 768–1023px uses the 64px rail with the full sidebar as an overlay; below 768px the sidebar is an overlay plus a bottom navbar. The mobile scrim is interactive and closes the drawer when tapped. Below 768px the open drawer is a dialog (`role="dialog"`, `aria-modal`), moves focus to its close button, traps Tab, closes on Escape, and restores focus on close without changing the desktop rail/docked behavior or the Back-button entry. Chat is an action above **New** in the full sidebar and a distinct signal-tinted icon at the top of the collapsed rail, not a page row. Both the rail action and the mobile bottom-bar item toggle the global dock, and Cmd/Ctrl+J remains available. Folder trees are in `src/components/sidebar/`; folder contents in `src/components/folder-view/`; drag-and-drop in `src/components/file-folder-handling/`.
- The favicon is the transparent cream rabbit-note mark on dark and the graphite app tile on light; `src/lib/theme.ts` swaps the SVG/PNG links when the resolved theme changes. The sidebar/auth mark stays transparent, and the app/PWA/About icon remains the graphite tile.
- The sidebar Library tree mixes root notes and root boards; an expanded folder shows its notes and boards together. `useSidebarBoards()` loads active boards through `listBoards()` and refreshes on board realtime events. Board rows use the column icon, private lock, public-share icon, Open/Edit/Share menu, and drag between folders. The Library header includes **New board** and **Archived boards**; the global **New** button opens `NewContentMenu` with New note and New board. The bottom navigation marks **Chat** current while the dock is open or the full `/chat` route is active; **Menu** stays current for routes behind the drawer (`/shared`, `/settings`, document reader).
- Settings: `/settings/account`, `/settings/api-keys`, `/settings/preferences`, `/settings/admin/general|people|email|signin|ai`, `/settings/about`. The URL owns the tab. Account expands profile and password forms inside the account card instead of opening a dialog; Workspace people expands the admin user form above the list. AI covers multiple provider connections (OpenAI-compatible, Gemini, Anthropic, and Ollama), a model catalog with enabled/default switches and per-model capabilities, generation overrides, attachment limits, and prompts. Models.dev search fills limits and capability defaults; every field remains manually editable. There is no embedding or search-index section. General edits attachment limits and two per-IP rate-limit scopes (workspace API and app/AI) through `/api/v1/admin/rate-limits`; a saved rate-limit change reloads the limiter immediately.
- API keys (`src/components/settings/ApiKeysTab.tsx`) are self-service for every user. Create expands an inline form asking for a name, `read`/`write` access, and a scope (`workspace`, `root`, or selected folders). Folder selection is a checkbox tree loaded from the regular folder collection; selected roots include their descendants. The created secret is shown once in an inline “Copy your key now” callout with copy and a warning; list rows show the prefix, access/scope badges, folder names, last use, and revoke. The tab also shows the `/mcp` Bearer header. Management always uses the session token, never a key.
- Public pages fetch through `/api/v1/public/...` and skip authenticated app data; `AppContent` disables `useDocumentData()` for `/public/`. Documents, folders, and boards each have a public reader route; a folder share lists its notes and boards in the contents tree and opens either reader inline, while `PublicBoardPage` renders the board description and status-grouped tasks without task-note links.
- Stored Markdown that still contains `/pb/api/files/...` is rewritten to `/api/v1/files/...` by the Markdown `img`/`a` renderers (`src/lib/legacy-urls.ts`). There is no compatibility `/pb` route.
- `SharePanel` supports documents, folders, and boards. It combines direct people grants (`view`/`comment`/`edit`), the inherited-folder explanation, and the public-link controls; the public section hides the attachment switch for boards. A `Private` switch hides the record from AI chat and MCP and from shared parents; a private record cannot be public. It does not hide the record from its owner.
- `/shared` is the “Shared with me” index with All/Boards/Notes/Folders tabs, search, and rows that open the normal readers. `/shared/folders/:folderId` shows a shared folder; inherited access badges come from the effective access endpoint. The sidebar nav exposes `/shared`, and share actions read `sharePanel` state locally on timeline, folder, and sidebar surfaces; the note editor and board header use the same panel.
- The default homepage setting no longer offers a separate boards page; stored `board` preferences open the timeline instead.
- PWA: the manifest and `/sw.js` are served by `src/index.ts`; `InstallBanner` uses `useInstallPrompt()` and renders a non-modal bottom banner above mobile navigation; the service worker is intentionally minimal.

### Styling and UI conventions

- TailwindCSS v4 utilities over semantic tokens from `src/index.css`. The canonical token table, type scale, and component contracts are in [`../DESIGN.md`](../DESIGN.md).
- Use `bg-surface`, `border-line`, `text-ink`, `text-ink-secondary`, `text-ink-muted`, `bg-signal-bright`, `text-signal`, `bg-signal-soft`, `text-warning`, `text-success`, `text-danger`, and the `rounded-control` / `rounded-panel` / `rounded-sheet` radii.
- Do not use raw `gray`/`stone`/`blue` families, `dark:`/`light:` variants, gradients, grain, glass blur, or serif faces.
- Type: Geist for every interface role; Geist Mono only for code, ids, and URLs inside prose. UI counts and dates use Geist with `tabular-nums`, not mono. Labels are sentence case. Fonts are self-hosted from `src/assets/fonts/`; CSP `font-src 'self'`.
- Page chrome: `<PageShell>` is the one route frame (centered max 1280px, 20/32/48px gutters; 820px reading, 1600px wide). `<PageHeader>` renders a 28/34px title, optional description and meta strip, optional back link, and right-aligned actions; the `eyebrow` prop is accepted for compatibility but not rendered. Chat keeps its body to an 800px reading column; Settings bounds its working area at 1100px. Route content is full bleed beside the docked sidebar; do not wrap a page in an outer card or inset frame.
- Cards: `<Card>` + `<SectionHeading>`. Inputs: `<Field>` with `<Input>`/`<Textarea>`/`<Select>`. Booleans: `<Switch>`/`<Checkbox>`. Segmented choices: `<SegmentedControl>`.
- Buttons: `<Button variant="primary|secondary|ghost|danger|link">`; icon-only actions use `<IconButton label="…">`. Primary buttons fill with `signal-bright`, not `signal`.
- Data entry is inline (`InlineForm`) or in a non-modal `SidePanel`; pickers and share settings also use `SidePanel`. Centred `Dialog`s are reserved for warnings/destructive confirmations (`ConfirmDialog`) and version preview. Do not add another bespoke fixed overlay.
- `EmptyState` is a centred 10px `surface` panel with an optional neutral icon tile; `compact` drops the panel chrome and left-aligns the copy.
- Toasts: `useToasts()` + `<ToastHost>`. Icons: `@heroicons/react`.
- Below 768px, primary mobile controls (editor formatting toolbar, sidebar Library actions, timeline month arrows/date cells/filter chips, chat Work/Ask, board toolbar icon actions) grow to a 44px hit area. Desktop density is unchanged.
- Theme: read tokens in CSS; use `useTheme()` only when a component needs the resolved value. Respect reduced motion.
- Check desktop and mobile; many components have separate paths.

### Frontend quality checklist

Accessibility:

- Icon-only buttons have an accessible name (`aria-label` or a visible label).
- Menus, dialogs, side panels, and popovers close on Escape, manage focus, and restore focus on close. `Sheet` focuses its panel, traps Tab, and restores the trigger. `SidePanel` stays a non-modal inspector from 640px up; below 640px its full-width surface exposes `aria-modal`, moves focus inside, and traps Tab. `TaskPanel` and the mobile chat dock do the same below 768px. `Dialog`/`ConfirmDialog` remain the only scroll-locking centred surfaces. Use the shared primitives.
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
- **Board creation is provisional.** New board creates “Untitled board”, navigates to it, and opens `BoardSettingsPanel` with the name selected. Editing from the timeline, folders, or sidebar navigates to the board with `state.editBoard`; quick create adds `state.newBoard` so the panel opens as “Name your board”. No modal is involved. `BoardSettingsPanel` may move a board through its folder selector, so update folder counts after saving.
- **Folder trash keeps boards.** The server rehomes boards to the root before removing the folder. Do not add a client-side board delete loop or treat a missing folder as a deleted board.
- **Trash views are read-only.** Do not subscribe to `trash_documents`/`trash_folders` or write to them. Use `/api/v1/trash/*` for moves/restores, then bump `refreshTriggerAtom`; a soft-delete transition does not produce a realtime event because the record stops matching the list rule.
- **Notes and folders soft-delete.** `deleted_at` is the trash flag; the id and attachments do not change. Do not recreate a trashed record or copy its attachments client-side.
- **Tasks have no `author` field.** Use `board.author`/board ownership; do not add an author column to task rows or payloads.
- **The private lock is not a UI gate.** `/api/v1` and the browser client still show private records to their owner; chat and MCP hide them. The lock icon only explains the state.
- **The board detail passes `undefined` to `useBoardState` while archived.** That is what prevents task loading; don't “fix” it by always passing `boardId`.
- **Search pauses dragging.** A filtered column has a different index than the stored order; allowing a drop would write the wrong `board_order`.
- **There is one AddToBoard picker.** `AddToBoardHost` is mounted at the app root; call sites only set `addToBoardRequestAtom`.
- **The board header import is board-scoped.** It uses `ImportNotePanel` and `existingDocumentIds`, not the root picker. Don't merge the two flows.
- **Archived boards are absent from the add-to-board picker.** `AddToBoardPanel` filters `!board.archived`; a stale request cannot target one.
- **Attachments are explicit files, not note retrieval.** Chat accepts one owner-scoped `chat_attachments` draft per upload, then references draft ids on send. Messages persist only safe `{ id, name, mimeType, size, kind }` refs. The server extracts text from text/PDF files and sends images/PDFs as native AI SDK parts only when the selected model advertises the capability. API keys and MCP cannot use this surface.
- **Chat writes are mode-gated.** Ask sends `mode: "ask"` and is read-only. Work sends `mode: "edit"`; the server adds create, rename, move, update, archive/restore, and confirm-first delete tools. Do not infer write access from the UI alone.
- **Edit cards are not a general undo stack.** Only note creation (trash) and note edits (snapshot restore) are undoable. Board/task cards have no Undo, and a newer note revision makes undo return `409`.
- **Tool activity is not a citation list.** It shows names/statuses and target titles only. The answer must cite titles in its own text; source links are the server-collected `sources` list.
- **`PageHeader` accepts an eyebrow it does not render.** The prop is kept for compatibility; adding an eyebrow back is a design change, not a styling tweak. `EmptyState.icon` is rendered as a neutral tile when not compact.
- **Mobile drag is not available.** HTML5 drag-and-drop is pointer-only, so note, folder, task, and board moves are desktop paths. The task edit panel's column select is the supported touch path for tasks; board folder moves use the board settings folder selector.
- **The 20-second initial-load timeout is deliberate.** It unblocks a slow PocketBase; removing it can leave the shell on a spinner.

## Related docs

- [`architecture.md`](architecture.md) — request flow and process topology.
- [`api.md`](api.md) — chat, export, board/task collection payloads.
- [`pocketbase.md`](pocketbase.md) — schema, hooks, and rules behind the UI.
- [`ai.md`](ai.md) — chat ask/edit tools, write path, providers, and persistence.
- [`development.md`](development.md) — build and verification commands.
- [`../DESIGN.md`](../DESIGN.md) — Graphite tokens, type, components, motion.
