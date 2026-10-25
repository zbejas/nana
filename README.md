<p align="center">
	<img src="src/assets/nana-512.png" alt="Nana mascot" width="180" />
</p>

<h1 align="center">Nana</h1>

<p align="center"><strong>Not Another Notes App</strong></p>

<p align="center">
	A self-hosted document workspace built with Bun, React, TailwindCSS, and PocketBase.
</p>

<p align="center">
	<a href="https://nana.fyi">Website</a>
	·
	<a href="https://github.com/zbejas/nana/pkgs/container/nana">Docker Image</a>
	·
	<a href="#quick-start">Quick Start</a>
</p>

<p align="center">
	<a href="https://github.com/zbejas/nana/commits/master"><img src="https://img.shields.io/github/last-commit/zbejas/nana" alt="GitHub last commit" /></a>
	<a href="https://github.com/zbejas/nana/issues"><img src="https://img.shields.io/github/issues/zbejas/nana" alt="GitHub issues" /></a>
	<a href="https://github.com/zbejas/nana/blob/master/LICENSE"><img src="https://img.shields.io/github/license/zbejas/nana" alt="GitHub license" /></a>
</p>

---

## Why Nana

Nana is for people who want their notes, documents, AI tools, and attachments in one place without handing the whole stack to a third-party service.

- Self-hosted by default. Your data stays on your server.
- Markdown-first editing with live preview and attachments.
- Multiple kanban boards for the work around your notes, with an archive.
- Built-in AI chat that reads your notes and boards.
- A first-class Elysia `/api/v1` API with self-hosted Scalar docs, plus an MCP endpoint for external AI clients.
- A calm, paper-like interface with night and daylight themes.
- Modern stack: Bun, React, TailwindCSS, and PocketBase.
- Responsive UI that works on desktop and mobile.

## Highlights

| | |
|---|---|
| **Markdown editor** | Live preview, rich formatting, and attachment support. |
| **Boards** | Multiple four-column kanbans with drag-and-drop, note import, folders, private boards, public read-only board links, an archive, and permanent delete for archived boards. |
| **AI chat** | Ask about your notes and boards. The assistant reads them on demand with OpenAI, Google, or Ollama, and never writes to your workspace. |
| **API and MCP** | Reach the same workspace from your own tools with a JSON API and a stateless MCP endpoint. Private records stay hidden from AI. |
| **Folders and tags** | Organize documents with nested folders, tags, and a timeline of recent notes and boards. |
| **Public sharing** | Share individual documents or entire folders via link, with optional expiration. |
| **Version history** | Save snapshots and restore earlier states when needed. |
| **Trash system** | Recover deleted content instead of losing it permanently. |
| **Mobile-friendly** | Clean, responsive interface across screen sizes, with dark and light themes. |

## Boards in folders

Boards live in the same folder tree as notes. The timeline, sidebar library, and folder view show boards beside their notes; drag a board into another folder, or choose **New board** and it is filed where you are. Right-click a board to open, edit, or share it. A public board link opens a read-only page with its tasks, while private boards stay out of every public and AI surface. Boards are archived before they can be deleted, and a folder never deletes the boards inside it: move a folder to trash and its boards return to the root with their tasks.

Mark a note, board, or folder **Private** to keep it out of AI chat and MCP. It stays in your workspace and you can still open and edit it.

## API and MCP

Nana exposes its workspace to your own tools:

- `GET /docs` — interactive API reference, with the OpenAPI document at `/docs/json`. The docs are public.
- `/api/v1` — JSON API for folders, notes, boards, and tasks. It is the owner's surface, so private records are visible to their owner.
- `POST /mcp` — stateless MCP endpoint for AI clients, with tools to read and write the same workspace. Private records stay hidden.

`/api/v1` and `/mcp` authenticate with a PocketBase user token, sent raw or as `Authorization: Bearer <token>`. They use the same origin and the same account as the app; the server adds no separate CORS configuration.

## Quick Start

Run Nana with Docker Compose:

```bash
curl -O https://raw.githubusercontent.com/zbejas/nana/refs/heads/master/compose.yml
docker compose up -d
```

Or run the container directly:

```bash
docker run -d \
	--name nana \
	-p 3000:3000 \
	-v ~/nana/pb_data:/app/pocketbase/pb_data \
	--restart unless-stopped \
	ghcr.io/zbejas/nana:latest
```

Open `http://localhost:3000`, create your first account, and start writing.

## Upgrading

Existing tasks that predate multiple boards are moved onto a per-author “My board” the first time the current release starts. Existing boards start at the root; move them into folders from the folder view whenever you like. Boards are archived before they can be deleted permanently; deleting an archived board removes its tasks, but leaves the notes those tasks came from in your library.

If you are upgrading from a release with built-in semantic search, the old vector index is no longer used. Stop the stack, back up your data directory, and remove its `zvec` folder to reclaim disk. The [deployment guide](docs/deployment.md#manual-zvec-cleanup-optional) has the exact commands.

## Default Access

| Port | Service |
|---|---|
| `3000` | Nana web app (the only public surface) |

> [!NOTE]
> PocketBase is bound to `127.0.0.1:8090` inside the container. It is never published, so the app's auth, rate limits, API rules, and Elysia surface cannot be bypassed. Use the app's settings for admin work.

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `POCKETBASE_URL` | `http://127.0.0.1:8090` | PocketBase backend URL |
| `NODE_ENV` | — | Set to `production` for static serving |
| `RAM_CACHE` | `false` | Use RAM for export cache |
| `PB_SUPERUSER_EMAIL` | — | Auto-provisioned superuser email |
| `PB_SUPERUSER_PASSWORD` | — | Auto-provisioned superuser password |
| `DEBUG` | `false` | Enable verbose server logs in production |

> [!TIP]
> Set `DEBUG=true` to enable verbose server logs in production. Useful for troubleshooting AI provider and chat tool failures.

## Development

The contributor and agent guide lives in [AGENTS.md](AGENTS.md), with subsystem deep-dives in [docs/](docs/README.md). They cover architecture, coding conventions, PocketBase hooks and migrations, and verification steps.

```bash
docker compose -f docker/compose.dev.yml up --build   # dev stack (PocketBase + Bun)
bun run test:unit                                     # pure unit tests
bun run test:docker                                   # isolated unit + integration suite
```

## License

Licensed under [AGPL-3.0](LICENSE).
