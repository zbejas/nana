# Nana – Copilot Instructions

## Architecture

Single Bun server (`src/index.ts`) + PocketBase backend. Browser never talks to PocketBase directly.

```
Browser → Bun (:3000)
            ├── /pb/*            → PocketBase proxy (:8090)
            ├── /api/chat/*      → AI chat (streaming SSE)
            ├── /api/embeddings/* → RAG vector search
            ├── /api/export      → ZIP export
            ├── /api/admin/*     → Rate-limit config reload
            └── /*               → React SPA (dev: HMR, prod: dist/)
```

## Build & Run

```bash
bun run dev                           # HMR dev server
bun run build.ts                      # Production build → dist/
bun src/index.ts                      # Production (needs NODE_ENV=production + dist/)
docker compose -f compose.dev.yml up  # Docker dev (file sync + rebuild)
docker compose up -d                  # Docker prod
```

## Environment Variables

Server-side only (`src/lib/config.ts`):

| Variable                | Default                 | Notes                               |
| ----------------------- | ----------------------- | ----------------------------------- |
| `PORT`                  | `3000`                  |                                     |
| `POCKETBASE_URL`        | `http://127.0.0.1:8090` |                                     |
| `NODE_ENV`              | —                       | `production` enables static serving |
| `RAM_CACHE`             | `false`                 | Export cache strategy               |
| `PB_SUPERUSER_EMAIL`    | —                       | Auto-provisioned superuser          |
| `PB_SUPERUSER_PASSWORD` | —                       | Auto-provisioned superuser          |
| `DEBUG`                 | `false`                 | Enable verbose debug logs in prod   |

Client config is just `window.location.origin + '/pb'` — never hardcode PocketBase URLs.

## Key Directories

| Path                        | Role                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `src/index.ts`              | Bun HTTP server — all route registration                                  |
| `src/api/`                  | Server-side handlers: proxy, chat, embeddings, export, auth, rate-limiter |
| `src/lib/`                  | Shared logic: config, auth, PB client, CRUD helpers, settings             |
| `src/state/atoms.ts`        | All Jotai atoms (UI + data state)                                         |
| `src/state/hooks/`          | Data loading, realtime, lazy loading, sidebar, editor hooks               |
| `src/components/`           | React components (editor, sidebar, settings, modals, timeline, PWA)       |
| `src/pages/`                | Route-level page components                                               |
| `pocketbase/pb_hooks/`      | PocketBase JS hooks (entry: `index.pb.js`, all hooks `require()`d there)  |
| `pocketbase/pb_migrations/` | Sequential migrations (`0_`, `1_`, … `8_`) — continue the sequence        |

## State Management

Jotai atoms in `src/state/atoms.ts`. Critical rules:

- **`useDocumentData()`** — call exactly once at `<AppContent>` (`src/App.tsx`). Loads root docs, recents, folders. Never call in child components.
- Child components read atoms via `useAtomValue()` / `useSetAtom()`.
- Write-only action atoms: `resetEditorAtom`, `startNewDocumentAtom`, `selectDocumentAtom`, `saveDocumentAtom`.
- Folder documents lazy-loaded on expand via `useFolderLazyLoading()`.
- Realtime updates via PocketBase SSE in `useRealtimeSubscriptions()` (called once per session).
- Client settings (sidebar width, auto-save delay, homepage) are in `src/lib/settings.ts` — stored in localStorage, not atoms.

## PocketBase Collections

| Collection                                                    | Purpose                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `users`                                                       | Auth collection with `admin` boolean                                   |
| `folders`                                                     | Tree structure (`parent` self-reference)                               |
| `documents`                                                   | Content, attachments, tags, stats                                      |
| `document_versions`                                           | Snapshots (created when `published=true`)                              |
| `conversations`                                               | Chat history (messages as inline JSON)                                 |
| `settings`                                                    | Admin key-value store (SMTP, AI, attachments, rate-limits, embeddings) |
| `trash_documents`, `trash_folders`, `trash_document_versions` | Separate-collection trash pattern                                      |

## PocketBase Conventions

- **Trash pattern**: No soft-delete flag. Records are **copied** to `trash_*` collections (with `deleted`, `deleted_at`, `deleted_by`), then **physically deleted** from originals. Restore moves them back. See `pb_hooks/routes/trash.js`.
- **Migrations**: Sequential JS files (`0_` through `8_`). New migrations must continue from `9_`.
- **Hook entry**: `pb_hooks/index.pb.js` — all hooks `require()`d here. Add new hooks there.
- **Custom routes**: `pb_hooks/routes/` — admin SMTP, users, attachments, AI, trash, check-users.
- **Guards**: `pb_hooks/guards/user_guards.js` — blocks public signup after first user, blocks deletion of verified users.
- **Bootstrap**: `pb_hooks/bootstrap.js` — seeds `site_url` from env, auto-provisions superuser.
- **Utilities**: `pb_hooks/utils.js` — `sanitizeUrl()`, `escapeHtml()`, `requireAdmin()`, `parseRequestBody()`.

## Frontend Conventions

- **Routing**: React Router v7 in `src/App.tsx`. Heavy pages lazy-loaded: `DocumentEditor`, `SettingsPage`, `TimelinePage`.
- **Auth**: `useAuth()` context from `src/lib/auth.tsx`. Protected routes use `<ProtectedRoute>`. Token validated on startup via `authRefresh()`.
- **Styling**: TailwindCSS v4 via `bun-plugin-tailwind` — no config file.
- **Icons**: `@heroicons/react`.
- **Markdown**: `@uiw/react-md-editor` with `rehype-sanitize`.
- **Toasts**: `useToasts()` hook + `<ToastHost>`.
- **Modals**: Components in `src/components/modals/` — `ConfirmDialog`, `VersionPreviewModal`, `TrashDocumentPreview`, `EmailChangeConfirmModal`.
- **Document types**: `src/lib/documents/types.ts` — extends `RecordModel` from `pocketbase` SDK.
- **CRUD helpers**: `src/lib/documents/crud.ts`, `src/lib/folders/crud.ts`, plus `attachments.ts`, `versions.ts`, `trash.ts`, `search.ts`.

## AI / Chat / Embeddings

- **Providers**: OpenAI, Google, Ollama — configured via PB `settings.ai_config`. Instantiated in `src/api/chat/providers.ts`.
- **Chat**: `POST /api/chat/send` streams SSE responses. Conversations stored in PB `conversations` collection. RAG context injected from embeddings.
- **Embeddings**: `POST /api/embeddings/embed` (single doc), `/embed-all`, `/search`, `/status`, `DELETE /delete`. Vector store: `@zvec` (HNSW). Chunking strategies: fixed, paragraph, sentence.
- **Auto-embed**: On document create/update, `pocketbase-proxy.ts` triggers async `embedDocument()` (fire-and-forget). On delete, triggers cleanup.
- **Superuser token**: `src/api/chat/superuser.ts` — singleton auto-refreshing token (12h TTL) for server-side PB access.

## Security

- All PB routes require auth except `GET /api/check-users`.
- CSP headers: permissive in dev (allows `ws:` for HMR), strict in production.
- Rate limiting via `src/api/rate-limiter.ts` (per-IP, configurable from PB settings).
- Admin-only operations guarded by `requireAdmin()` in hooks.
- Attachment access secured via file tokens.
- HTML sanitized via `rehype-sanitize` in markdown preview + `escapeHtml()` in hooks.

## Logging

`createLogger("ModuleName")` from `src/lib/logger.ts`. CSS-styled in browser, ANSI in terminal. Debug output silenced in production.

## Docker

- **Dockerfile**: Multi-stage — `app-base` → `builder` → `production` / `development`.
- **Entrypoint** (`docker-entrypoint.sh`): Runs PB migrations first, then launches PocketBase + Bun in parallel with prefixed logs. Traps SIGTERM/SIGINT.
- **Dev compose**: File sync for `src/`, `pb_hooks/`, `pb_migrations/`; rebuild on `package.json` change.
- **Volumes**: `pb_data` persisted for database state.
