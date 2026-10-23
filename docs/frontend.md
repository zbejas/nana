# Frontend

The frontend is a React 19 SPA built with Bun, styled with TailwindCSS v4, and routed with React Router v7. Jotai owns shared UI and document state; PocketBase is accessed through the JS SDK pointed at `/pb`.

## Entry and providers

| File | Role |
| --- | --- |
| `src/index.html` | SPA shell; loads `src/frontend.tsx`. |
| `src/frontend.tsx` | Creates the React root, wraps the app in Jotai `Provider` and `AuthProvider`, registers the service worker. |
| `src/App.tsx` | Router, protected routes, layout, sidebar, mobile navigation, lazy page loading. |
| `src/lib/auth.tsx` | `AuthProvider` / `useAuth()`: session validation, sign-in, sign-up, OAuth, logout. |
| `src/index.css` | Tailwind entry and global styles/animations. |

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
| `/folders`, `/folders/:folderId` | Folder view | Protected |
| `/folders/trash`, `/folders/trash/:trashFolderId` | Trash | Protected |
| `/folders/shared` | Shared-content view | Protected |
| `/chat`, `/chat/:conversationId` | AI chat | Protected |
| `/settings`, `/settings/:tab` | Settings | Protected |
| `/document/:id` | Document editor | Protected |

`ProtectedRoute` waits for auth loading, redirects unauthenticated users to `/`, and uses `<Navigate replace>`.

Heavy routes are lazy-loaded: `DocumentEditor`, `SettingsPage`, `PublicDocumentPage`, `PublicFolderPage`.

## Auth flow

1. `AuthProvider` reads the PocketBase auth store on mount.
2. If a token exists, it is validated with `pb.collection('users').authRefresh()`. Invalid tokens are cleared.
3. `checkHasUsers()` calls PB `/api/check-users` to choose onboarding vs sign-in.
4. Sign-in uses `authWithPassword`; sign-up creates a user then signs in.
5. On auth change, the client requests an attachment file token (see `src/lib/documents/attachments.ts`).
6. Server-side, every protected Bun API calls `verifyAuth()`; PocketBase collection rules protect browser data access.

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
- Markdown preview sanitizes HTML with `rehype-sanitize`.

## Sidebar, folders, and mobile

- `src/components/Sidebar.tsx` coordinates desktop and mobile states.
- On desktop, the sidebar is docked at `>=1024px` and pushes content by its width.
- On mobile, the sidebar is an overlay; the app uses a bottom navbar and route transition animations.
- Folder trees live in `src/components/sidebar/`; folder contents are rendered by `src/components/folder-view/`.
- Drag-and-drop is centralized in `src/components/file-folder-handling/`.
- Sidebar width, expanded folders, and mobile state are persisted or derived as appropriate.

## Settings

`src/pages/SettingsPage.tsx` renders profile, general, admin, and about tabs.

- General settings are client-side preferences: default homepage, auto-save delay, and a local-data reset through `src/lib/settings.ts` and `StorageSettings`.
- Admin settings cover instance/site URL, users, SMTP, OAuth, AI, and attachment/rate limits.
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

- TailwindCSS v4 utilities; follow existing spacing, color, radius, and typography patterns.
- Icons: `@heroicons/react`.
- Toasts: `useToasts()` + `<ToastHost>`.
- Modals: `src/components/modals/` (confirm, version preview, trash preview, public share, attachment viewer).
- Use `createLogger("Module")` instead of `console`.
- Respect reduced motion for prominent animations where the existing CSS supports it.
- Check desktop and mobile; many components have separate code paths.

## Frontend quality checklist

Use this when reviewing or changing UI:

### Accessibility

- Icon-only buttons have an accessible name (`aria-label` / visible label).
- Menus, dialogs, and popovers close on `Escape`, manage focus, and restore focus on close.
- Controls are keyboard reachable and usable.
- Text/action contrast is readable in dark and light states.
- Touch targets are practical on mobile.

### Interaction

- Loading, saving, empty, and error states are clear and actionable.
- Destructive actions are visually distinct and confirmed where appropriate.
- Hover-only affordances have a touch path.
- Mobile overlays are not clipped and do not trap the user.

### Consistency

- Similar controls use the same component patterns and tokens.
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
