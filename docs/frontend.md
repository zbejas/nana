# Frontend — routes, state, and surfaces

## Overview

The frontend is a React 19 SPA built with Bun, styled with TailwindCSS v4 and the Signal & Paper tokens, and routed with React Router v7. Jotai owns shared UI and document state; PocketBase is accessed through the JS SDK pointed at `/pb`. Board task state is route-local, not global.

The visual system is documented in [`../DESIGN.md`](../DESIGN.md); product truth is in [`../PRODUCT.md`](../PRODUCT.md).

## Key files

| File | Role |
| --- | --- |
| `src/index.html` | SPA shell; loads `src/frontend.tsx` and the theme bootstrap. |
| `src/frontend.tsx` | Creates the React root, wraps the app in Jotai `Provider` and `AuthProvider`, registers the service worker. |
| `src/App.tsx` | Router, protected routes, layout, sidebar, mobile navigation, lazy pages, `AddToBoardHost`. |
| `src/lib/auth.tsx` | `AuthProvider` / `useAuth()`: session validation, sign-in, sign-up, OAuth, logout. |
| `src/index.css` | Tailwind entry, Signal & Paper tokens, self-hosted fonts, global styles, motion, Markdown overrides. |
| `src/lib/theme.ts` | Theme preference (`system`/`dark`/`light`), resolution, `data-theme`, theme-color meta. |
| `src/pages/BoardsPage.tsx` | Board index ledger. |
| `src/pages/BoardPage.tsx` | Board detail: header actions, search, kanban columns, dialogs. |
| `src/pages/BoardArchivePage.tsx` | Archived boards, restore, permanent delete. |
| `src/pages/ChatPage.tsx` | Chat empty state, messages, tool activity, composer, history. |
| `src/components/board/useBoardState.ts` | Task load, realtime refresh, create/edit/delete, drag state, optimistic reorder. |
| `src/components/board/useBoardSummaries.ts` | Board index/archive data and realtime refresh. |
| `src/components/board/AddToBoardHost.tsx` | The single root picker host driven by `addToBoardRequestAtom`. |
| `src/components/board/AddToBoardDialog.tsx` | Board picker for a note; create-inline board support. |
| `src/components/board/ImportNoteDialog.tsx` | Board-scoped note import from the board header. |
| `src/components/board/BoardDialog.tsx` | Create/edit board and archive confirmation. |
| `src/components/board/TaskDialog.tsx` | Create/edit task, column/priority select, delete confirmation. |
| `src/components/board/TaskCard.tsx` | Ledger task row: title, excerpt, priority code, due date, linked note, labels. |
| `src/components/board/board-config.ts` | Column labels/hints and priority labels/codes. |
| `src/components/ui/` | Shared primitives: Button, Field, Card, Dialog, Sheet, Menu, ConfirmDialog, EmptyState. Toasts live in `src/components/Toast.tsx`. |
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
| `/timeline` | Timeline | Protected |
| `/board` | Board index ledger | Protected |
| `/board/archive` | Archived boards | Protected |
| `/board/:boardId` | Board kanban | Protected |
| `/folders`, `/folders/:folderId` | Folder view | Protected |
| `/folders/trash`, `/folders/trash/:trashFolderId` | Trash | Protected |
| `/folders/shared` | Shared-content view | Protected |
| `/chat`, `/chat/:conversationId` | AI chat | Protected |
| `/settings`, `/settings/:tab` | Settings | Protected |
| `/settings/admin/:section` | Workspace administration | Admin only |
| `/document/:id` | Document editor | Protected |

`ProtectedRoute` waits for auth loading, redirects unauthenticated users to `/`, and uses `<Navigate replace>`. Heavy routes are lazy-loaded: `BoardsPage`, `BoardArchivePage`, `BoardPage`, `SettingsPage`, `DocumentEditor`, `PublicDocumentPage`, and `PublicFolderPage`. Unknown paths redirect to `/`.

Mobile route transitions follow the order `/timeline` → `/board` → `/folders` → `/chat` → `/settings`; document routes are treated separately. The transition is a 14px lateral slide under 768px.

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
| Board | `addToBoardRequestAtom` only; `useBoardState` owns the open board's tasks, `useBoardSummaries` owns index/archive rows |

Critical rules:

- **`useDocumentData()` is called exactly once**, in `AppContent` in `src/App.tsx`. It sets up realtime subscriptions, initial loading, and lazy folder loading. Never call it from a child component.
- Read atoms with `useAtomValue()`; write with `useSetAtom()`. Avoid `useAtom` when only one side is needed.
- Use write-only action atoms (`resetEditorAtom`, `startNewDocumentAtom`, `selectDocumentAtom`, `saveDocumentAtom`) for editor transitions.
- Folder documents load lazily through `useFolderLazyLoading()` when a folder is expanded.
- Realtime subscriptions are initialized once per user session by `useRealtimeSubscriptions()`; it consumes PocketBase SSE for documents, folders, and trash.
- `initialLoadDoneAtom` is stored in `sessionStorage` on purpose: it tracks one browser session.
- Client preferences (sidebar width, auto-save delay, default homepage, last non-document route, expanded folders) live in `src/lib/settings.ts` and `localStorage`, not Jotai.

Initial load order is recent documents, root documents, folders + trash folders, then trash documents. A 20-second timeout unblocks the UI if PocketBase is slow; don't remove it without a replacement.

### Board index

`/board` is a ledger, not a grid of cards.

- `useBoardSummaries()` loads `listBoardSummaries()`: one boards query plus one task query, then sums open/done counts per board.
- Active boards only, newest first. The header line shows `NN boards · NN open · NN done` in mono tabular type.
- Desktop rows use a four-column ledger: Board, Progress, Open, Updated. Progress is a 3px rule with a signal fill and a `done/total` mono label. Mobile stacks the same data.
- A board with no tasks shows `No tasks`; a missing description shows `No description`.
- The page actions are `Archived` (to `/board/archive`) and `New board` (opens `BoardDialog`).
- Empty state: `No boards yet`, with a `Create board` action.
- Board and task realtime events both refresh the summaries after a 450ms debounce.

### Board detail

`/board/:boardId` is the kanban for one board.

- `getBoard(boardId)` loads the board; a `404` renders “That board is not here”.
- `useBoardState(activeBoardId)` only receives an id when the board is loaded and not archived. An archived board therefore loads no tasks and renders a restore state.
- Header actions for an active board: `Import note`, `New task`, and an edit icon that opens `BoardDialog`.
- Columns are fixed: `backlog`, `next`, `progress`, `done`, indexed `01`–`04`, labelled Backlog, Next up, In progress, Done. The progress column carries a signal top rule even when not a drop target.
- Desktop is a four-column grid; mobile is a horizontal snap row of `w-[min(86vw,320px)]` columns.
- Task rows are hairline-separated ledger entries, not floating cards. They show title, a plain-text excerpt, a `P0`–`P3` priority code, due date (danger when overdue and not done), a linked-note title, and up to two labels. Done rows are muted and struck through.
- Dragging changes `status` and reindexes `board_order`; the UI updates optimistically and reloads on failure. Dragging is paused while the search filter is active, because a filtered index does not match stored order.
- HTML5 drag-and-drop is pointer-only. On touch, the task dialog's column select is the movement path.
- Search filters title, description, and labels locally.
- An empty board shows “No tasks yet” with a `New task` action.
- `BoardDialog` handles create/edit and archive. Archive is confirmed with `ConfirmDialog` and explained as “nothing is deleted”.
- `TaskDialog` handles create/edit, column, priority, due date, comma-separated labels, linked-note opening, and delete confirmation.
- `ImportNoteDialog` is board-scoped: it lists notes, marks notes already on this board via `existingDocumentIds`, and creates a task linked to the chosen note.
- Realtime task changes refresh the board after a debounce; a skip flag suppresses echo refresh during a local drag write.

### Board archive

`/board/archive` lists only `archived = true` boards.

- Each row shows name, description, task count, and archived date.
- `Restore` clears `archived` and removes the row locally.
- `Delete forever` opens a danger `ConfirmDialog` that states the board and its tasks are removed permanently and the source notes stay in the library.
- `deleteBoardPermanently()` relies on the PocketBase delete rule and the `tasks.board` cascade. There is no client-side task deletion loop.

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

- The empty state is `Ask your notes.`, with a short explanation and prompt rows. There is no document picker and no attachment control.
- Assistant messages are document text in a 68ch column, with Markdown rendered through `MarkdownPreview` (sanitized). User messages are right-aligned in a bordered `surface-sunken` block.
- Tool activity is a quiet mono uppercase row above the answer: “Searched notes”, “Read a note”, “Read a board”, “Checked boards”, or “Checked the workspace” for unknown names. While a tool runs it reads “Looking through your workspace…” with a signal hairline.
- The client keeps a local `running` status and call id while streaming; the server persists only terminal `{ name, status }`, and the history view shows only names/statuses.
- Reasoning is a collapsible details block; an empty streaming answer shows “Thinking…”.
- The composer is a bordered shell with `Enter to send · Shift+Enter`; the placeholder is `Ask about your notes or board...`.
- Conversation history is a right-side panel (collapsible desktop, overlay mobile) with new-chat and delete actions.
- A module-level `streamStore` survives navigation so a reply can finish while the page is unmounted; re-entering the conversation rehydrates from it.
- The empty-response fallback is `CHAT_EMPTY_RESPONSE_FALLBACK` from `src/api/chat/types.ts`.

### Editor, sidebar, and settings

- `src/components/DocumentEditor.tsx` is split under `src/components/editor/`: state, loader, autosave, actions, attachments, content, overlays.
- Autosave is debounced by the user's configured delay, clamped to at least 200 ms. `creationSessionIdAtom` protects against stale callbacks.
- `published: true` triggers a PocketBase version snapshot of the previous content, then resets the flag.
- Attachments are protected files; the client obtains a short-lived file token for rendering.
- Notes over 5 MB warn; over the 100 MB database limit the warning becomes an error. Thresholds live in `ContentSizeWarning.tsx`.
- Sidebar: desktop docked at `>=1024px`; mobile overlay plus a bottom navbar. Folder trees are in `src/components/sidebar/`; folder contents in `src/components/folder-view/`; drag-and-drop in `src/components/file-folder-handling/`.
- Settings: `/settings/account`, `/settings/preferences`, `/settings/admin/general|people|email|signin|ai`, `/settings/about`. The URL owns the tab. AI covers providers, models, generation parameters, and prompts; there is no embedding or search-index section.
- Public pages fetch through `/pb/api/public/...` and skip authenticated app data; `AppContent` disables `useDocumentData()` for `/public/`.
- PWA: the manifest and `/sw.js` are served by `src/index.ts`; `InstallBanner` uses `useInstallPrompt()`; the service worker is intentionally minimal.

### Styling and UI conventions

- TailwindCSS v4 utilities over semantic tokens from `src/index.css`. The canonical token table, type scale, and component contracts are in [`../DESIGN.md`](../DESIGN.md).
- Use `bg-surface`, `border-line`, `text-ink`, `text-ink-secondary`, `text-ink-muted`, `bg-signal`, `text-signal`, `bg-signal-soft`, `text-warning`, `text-success`, `text-danger`, and the `rounded-control` / `rounded-panel` / `rounded-sheet` radii.
- Do not use raw `gray`/`stone`/`blue` families, `dark:`/`light:` variants, gradients, grain, glass blur, or serif faces.
- Type: Schibsted Grotesk for display and UI, JetBrains Mono for eyebrows, metadata, counts, and code. Fonts are self-hosted from `src/assets/fonts/`; CSP `font-src 'self'`.
- Page chrome: `<PageHeader>` renders a display title, optional description, and actions. The `eyebrow` prop is accepted for compatibility but not rendered.
- Cards: `<Card>` + `<SectionHeading>`. Inputs: `<Field>` with `<Input>`/`<Textarea>`/`<Select>`. Booleans: `<Switch>`/`<Checkbox>`. Segmented choices: `<SegmentedControl>`.
- Buttons: `<Button variant="primary|secondary|ghost|danger|link">`; icon-only actions use `<IconButton label="…">`.
- Every modal is a `Dialog` (or `Sheet` on touch). Confirmation uses `ConfirmDialog` with `tone="danger"`. Do not add another fixed overlay.
- `EmptyState` is an editorial hairline block; its `icon` prop is accepted but intentionally not rendered.
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
- **Board tasks are not Jotai state.** `useBoardState` owns the open board; `useBoardSummaries` owns index/archive rows. Putting tasks in a global atom would fight both realtime refreshes and the drag skip flag.
- **The board detail passes `undefined` to `useBoardState` while archived.** That is what prevents task loading; don't “fix” it by always passing `boardId`.
- **Search pauses dragging.** A filtered column has a different index than the stored order; allowing a drop would write the wrong `board_order`.
- **There is one AddToBoard picker.** `AddToBoardHost` is mounted at the app root; call sites only set `addToBoardRequestAtom`.
- **The board header import is board-scoped.** It uses `ImportNoteDialog` and `existingDocumentIds`, not the root picker. Don't merge the two flows.
- **Archived boards are absent from the add-to-board picker.** `AddToBoardDialog` filters `!board.archived`; a stale request cannot target one.
- **Chat has no attachments.** There is no document picker, no `documentIds`, and no source chips. Adding one requires a new retrieval design, not a UI-only change.
- **Tool activity is not a citation list.** It shows names and statuses only; the answer must cite titles in its own text.
- **`PageHeader` and `EmptyState` accept props they do not render.** `PageHeader.eyebrow` and `EmptyState.icon` are compatibility props; adding an eyebrow back is a design change, not a styling tweak.
- **Mobile drag is not available.** The task dialog's column select is the supported touch path.
- **The 20-second initial-load timeout is deliberate.** It unblocks a slow PocketBase; removing it can leave the shell on a spinner.

## Related docs

- [`architecture.md`](architecture.md) — request flow and process topology.
- [`api.md`](api.md) — chat, export, board/task collection payloads.
- [`pocketbase.md`](pocketbase.md) — schema, hooks, and rules behind the UI.
- [`ai.md`](ai.md) — chat tools, providers, and persistence.
- [`development.md`](development.md) — build and verification commands.
- [`../DESIGN.md`](../DESIGN.md) — Signal & Paper tokens, type, components, motion.
