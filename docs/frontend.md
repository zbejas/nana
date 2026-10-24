# Frontend

The frontend is a React 19 SPA built with Bun, styled with TailwindCSS v4 and the Ember & Ink design tokens, and routed with React Router v7. Jotai owns shared UI and document state; PocketBase is accessed through the JS SDK pointed at `/pb`.

The visual system is documented in [`../DESIGN.md`](../DESIGN.md); the product truth is in [`../PRODUCT.md`](../PRODUCT.md).

## Entry and providers

| File | Role |
| --- | --- |
| `src/index.html` | SPA shell; loads `src/frontend.tsx`. |
| `src/frontend.tsx` | Creates the React root, wraps the app in Jotai `Provider` and `AuthProvider`, registers the service worker. |
| `src/App.tsx` | Router, protected routes, layout, sidebar, mobile navigation, lazy page loading. |
| `src/lib/auth.tsx` | `AuthProvider` / `useAuth()`: session validation, sign-in, sign-up, OAuth, logout. |
| `src/index.css` | Tailwind entry, Ember & Ink tokens, global styles, motion, markdown overrides. |
| `src/lib/theme.ts` | Theme preference (`system`/`dark`/`light`), resolution, `data-theme`, theme-color meta. |
| `src/components/ui/` | Shared primitives: Button, Field, Input, Card, Dialog, Sheet, Menu, ConfirmDialog, Toast, EmptyState. |

`bun-plugin-tailwind` is configured in `bunfig.toml`; there is no `tailwind.config.*`.

## Routes

| Path | Page | Protection |
| --- | --- | --- |
| `/` | Sign in | Public |
| `/onboarding` | First-user onboarding | Public |
| `/reset-password` | Password reset | Public |
| `/confirm-email-change` | Email-change confirmation | Public |
| `/public/document/:shareToken` | Public document view | Public |
| `/public/folder/:shareToken` | Public folder view | Public |
| `/timeline` | Timeline | Protected |
| `/board` | Task board | Protected |
| `/folders`, `/folders/:folderId` | Folder view | Protected |
| `/folders/trash`, `/folders/trash/:trashFolderId` | Trash | Protected |
| `/folders/shared` | Shared-content view | Protected |
| `/chat`, `/chat/:conversationId` | AI chat | Protected |
| `/settings`, `/settings/:tab` | Settings | Protected |
| `/settings/admin/:section` | Workspace administration section | Admin only |
| `/document/:id` | Document editor | Protected |

`ProtectedRoute` waits for auth loading, redirects unauthenticated users to `/`, and uses `<Navigate replace>`.

Heavy routes are lazy-loaded: `BoardPage`, `DocumentEditor`, `SettingsPage`, `PublicDocumentPage`, `PublicFolderPage`. Unknown paths redirect to `/`.

## Auth flow

1. `AuthProvider` reads the PocketBase auth store on mount.
2. A stored session is only trusted while its token is unexpired. Expired or half-populated stores are cleared so a stale record cannot keep the UI logged in while PocketBase treats requests as anonymous.
3. Valid tokens are confirmed with `pb.collection('users').authRefresh()`. Auth failures clear the session and show a "session expired" toast; network failures keep the session for a later check.
4. While the app is open, the session is re-validated on focus/visibility change and at most every five minutes. This catches backend-side invalidation and token expiry even when PocketBase answers list requests with an empty `200` instead of `401`.
5. `pb.afterSend` clears the auth store on any `401` while a token is present, so SDK requests cannot leave a stale session behind.
6. `checkHasUsers()` calls PB `/api/check-users` to choose onboarding vs sign-in.
7. Sign-in uses `authWithPassword`; sign-up creates a user then signs in.
8. On auth change, the client requests an attachment file token (see `src/lib/documents/attachments.ts`).
9. Server-side, every protected Bun API calls `verifyAuth()`; PocketBase collection rules protect browser data access.

The first user becomes an admin and is auto-verified by PocketBase hooks. Public signup is locked after that; admins create additional users from settings.

## State model

All shared atoms live in `src/state/atoms.ts`.

| Group | Examples |
| --- | --- |
| UI | `sidebarOpenAtom`, `sidebarResizingAtom`, selected document, unsaved changes, new-document session |
| Data | folders tree, root documents, documents by folder, recent documents, trash documents/folders |
| Loading | data loading lock, initial-load completion, loaded/loading folder sets |
| Editor | selected document, creating flag, save callback, initial title/content, creation session ID |
| Realtime | timeline tick / refresh triggers |
| Board | none in Jotai; `useBoardState` owns task state for the route |

### Critical rules

- **`useDocumentData()` is called exactly once**, in `AppContent` in `src/App.tsx`. It sets up realtime subscriptions, initial loading, and lazy folder loading. Never call it from a child component.
- Read atoms with `useAtomValue()`; write with `useSetAtom()`. Avoid `useAtom` when only one side is needed.
- Use write-only action atoms (`resetEditorAtom`, `startNewDocumentAtom`, `selectDocumentAtom`, `saveDocumentAtom`) for editor transitions.
- Folder documents are loaded lazily through `useFolderLazyLoading()` when a folder is expanded. Do not eagerly load the tree.
- Realtime subscriptions are initialized once per user session by `useRealtimeSubscriptions()`; it consumes PocketBase SSE for documents, folders, and trash.
- `initialLoadDoneAtom` is stored in `sessionStorage` on purpose: it tracks one browser session, not a permanent preference.
- Client preferences (sidebar width, auto-save delay, default homepage, last non-document route, expanded folders) are in `src/lib/settings.ts` and `localStorage`, not Jotai.

### Data loading order

The initial load is deliberately prioritized and batched to keep the UI responsive:

1. Recent documents (5).
2. Root documents.
3. Folders + trash folders.
4. Trash documents.

A 20-second timeout unblocks the UI if PocketBase is slow; don't remove it without a replacement.

## Document editor

`src/components/DocumentEditor.tsx` is split into focused modules under `src/components/editor/`:

| Module | Responsibility |
| --- | --- |
| `useDocumentEditorState.ts` | Orchestrates editor state, autosave, attachments, publishing. |
| `useDocumentLoader.ts` | Loads the URL document or a new-document session. |
| `useAutoSave.ts` | Debounced save, save spinner/release timing, stale-session protection. |
| `useDocumentActions.ts` | Save, publish, delete, restore, new-from-version. |
| `useAttachmentHandlers.ts` | Attachment add/remove/delete and drag/drop. |
| `EditorContent.tsx` | Markdown editor (`@uiw/react-md-editor`) and preview. |
| `DocumentEditorOverlays.tsx` | Drag overlay, read-only overlay, header toggle. |

Important behavior:

- Autosave is debounced by the user's configured delay, clamped to at least 200 ms.
- `creationSessionIdAtom` protects against stale autosave callbacks finishing after a new document session has started.
- `published: true` triggers a PocketBase version snapshot of the previous content, then resets the flag.
- Attachments are protected files; the client obtains a short-lived file token for rendering.
- Notes over 5 MB show a warning recommending the file be uploaded as an attachment; over the 100 MB database limit the warning becomes an error. Thresholds live in `ContentSizeWarning.tsx` and must stay in sync with the PocketBase migration.
- Markdown preview sanitizes HTML with `rehype-sanitize`.

## Board

The board is a view over the separate `tasks` collection, not a view over documents. A note is writing; a task is work. A task may point at the note it came from, but deleting either side leaves the other intact.

| File | Responsibility |
| --- | --- |
| `src/pages/BoardPage.tsx` | Route shell, header actions, search, columns, dialogs. |
| `src/components/board/useBoardState.ts` | Load, realtime refresh, create/edit/delete, drag state, optimistic reorder. |
| `src/components/board/TaskCard.tsx` | Card presentation: priority stripe, excerpt, due date, linked note, labels. |
| `src/components/board/TaskDialog.tsx` | Create/edit form, column and priority select, due date, labels, delete confirm. |
| `src/components/board/ImportNoteDialog.tsx` | Search notes and create a linked task; notes already on the board are marked. |
| `src/components/board/board-config.ts` | Column labels/tones, priority labels/tones. |
| `src/lib/tasks/index.ts` | Types, CRUD, `persistTaskPositions`, realtime subscription, `createTaskFromDocument`. |

Behavior:

- Columns are fixed: `backlog`, `next`, `progress`, `done`. Each status is a single-select value in PocketBase.
- Dragging a card changes `status` and reindexes `board_order` for the target column. `persistTaskPositions` writes only changed rows. The UI updates optimistically and reloads on failure.
- HTML5 drag-and-drop is pointer-only. On touch, the task dialog's Column select is the movement path.
- Search filters cards and pauses dragging, because a filtered drop index would not match the stored order.
- Realtime task changes refresh the board after a short debounce; the skip flag suppresses echo refresh during a local drag write.
- "Add to board" is available on every note context menu and creates a task with the note's title, a plain-text excerpt, up to six labels, and a `document` relation.
- The default homepage preference accepts `board` as well as `timeline`, `folders`, and `chat`.

## Sidebar, folders, and mobile

- `src/components/Sidebar.tsx` coordinates desktop and mobile states.
- On desktop, the sidebar is docked at `>=1024px` and pushes content by its width.
- On mobile, the sidebar is an overlay; the app uses a bottom navbar and route transition animations.
- Folder trees live in `src/components/sidebar/`; folder contents are rendered by `src/components/folder-view/`.
- Drag-and-drop is centralized in `src/components/file-folder-handling/`.
- Sidebar width, expanded folders, and mobile state are persisted or derived as appropriate.

## Settings

`src/pages/SettingsPage.tsx` is a rail on desktop and a two-column tab grid on mobile. The URL owns the tab.

| Tab | Route | Contents |
| --- | --- | --- |
| Account | `/settings/account` | Avatar, name, email, password, role. |
| Preferences | `/settings/preferences` | Theme (System/Night/Day), start page, auto-save rhythm, local-data reset. |
| Workspace | `/settings/admin/:section` | Admin only. `general`, `people`, `email`, `signin`, `ai`. |
| About | `/settings/about` | Version check, stack, links, support. |

- Preferences are client-side and write through `src/lib/settings.ts` and `src/lib/theme.ts`. Changes apply immediately.
- The local-data reset preserves PocketBase auth only when the user leaves the "forget this browser session" option off; otherwise it removes the auth record and reloads.
- Workspace sections are URL-driven, so refresh and back/forward work. General combines the instance address, attachment limits, and rate limits; People covers members; Email covers SMTP; Sign-in covers OAuth; AI & search covers providers, prompts, chunking, and embeddings.
- About uses `/api/app/version` for the update check.

Server-side settings are admin-only. Never expose API keys or SMTP credentials to non-admin clients.

## Public pages

Public document and folder pages live under `src/pages/` and `src/components/public/`. They:

- Fetch through PB public routes (`/pb/api/public/...`).
- Render a read-only document/folder tree and authorized attachments.
- Never load authenticated app data; `AppContent` skips `useDocumentData()` for `/public/` routes.

## PWA

- `manifest.webmanifest` and `/sw.js` are served by `src/index.ts`.
- `InstallBanner` uses `useInstallPrompt()`.
- The service worker is intentionally minimal: install/activate and client claim, no offline caching layer.

## Styling and UI conventions

- TailwindCSS v4 utilities over semantic tokens from `src/index.css`. Use `bg-surface`, `border-line`, `text-ink`, `text-ink-secondary`, `text-ink-muted`, `bg-ember-soft`, `text-ember`, and the panel/control radii. Raw `gray`/`stone`/`blue` families and `dark:`/`light:` variants are not part of the system.
- Page chrome: `<PageHeader>` (eyebrow, serif title, description, actions). Cards: `<Card>` + `<SectionHeading>`. Inputs: `<Field>` with `<Input>`/`<Textarea>`/`<Select>`. Booleans: `<Switch>`/`<Checkbox>`.
- Icons: `@heroicons/react`; match the 16px/20px sizes used by the primitives.
- Toasts: `useToasts()` + `<ToastHost>`.
- Modals: every dialog uses `src/components/ui/Dialog.tsx`. Confirmation uses `ConfirmDialog`; mobile context menus and pickers use `Sheet`. Do not add another fixed overlay with its own ESC, focus, or scroll handling. The attachment viewer is the one full-screen exception and owns pan/zoom.
- Theme: read tokens in CSS; use `useTheme()` only when a component needs the resolved value (for example the Markdown preview's `data-color-mode`).
- Use `createLogger("Module")` instead of `console`.
- Respect reduced motion; the global stylesheet handles it.
- Check desktop and mobile; many components have separate code paths.

## Frontend quality checklist

Use this when reviewing or changing UI:

### Accessibility

- Icon-only buttons have an accessible name (`aria-label` / visible label).
- Menus, dialogs, and popovers close on `Escape`, manage focus, and restore focus on close. Use the shared `Dialog`/`MenuSurface` primitives rather than reimplementing this.
- Drag-and-drop has a keyboard/touch alternative (open the card and change the column).
- Controls are keyboard reachable and usable.
- Text/action contrast is readable in dark and light states.
- Touch targets are practical on mobile.

### Interaction

- Loading, saving, empty, and error states are clear and actionable.
- Destructive actions are visually distinct and confirmed where appropriate.
- Hover-only affordances have a touch path.
- Mobile overlays are not clipped and do not trap the user.

### Consistency

- Similar controls use the shared `src/components/ui/` primitives and semantic tokens; no local variants.
- Typography hierarchy is consistent.
- Icons match size/stroke/placement across similar controls.
- Avoid introducing a new design language for a local fix.

### Performance

- Don't subscribe components to atoms they don't render.
- Memoize expensive derived lists only when measured or clearly needed.
- Don't move data orchestration into leaf components.
- Keep lazy loading and realtime behavior intact.

## Related docs

- [`architecture.md`](architecture.md) — request lifecycle and process topology.
- [`api.md`](api.md) — chat, export, and public-share payloads.
- [`pocketbase.md`](pocketbase.md) — schema, hooks, and API rules behind the UI.
- [`development.md`](development.md) — build and verification commands.
