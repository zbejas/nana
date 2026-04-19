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
- Built-in AI chat with RAG across your documents.
- Modern stack: Bun, React, TailwindCSS, and PocketBase.
- Responsive UI that works on desktop and mobile.

## Highlights

| | |
|---|---|
| **Markdown editor** | Live preview, rich formatting, and attachment support. |
| **AI chat** | Retrieval-augmented chat with support for OpenAI, Google, and Ollama. |
| **Folders and tags** | Organize documents with nested folders, tags, and a timeline view. |
| **Public sharing** | Share individual documents or entire folders via link, with optional expiration. |
| **Version history** | Save snapshots and restore earlier states when needed. |
| **Trash system** | Recover deleted content instead of losing it permanently. |
| **Mobile-friendly** | Clean, responsive interface across screen sizes. |

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

Open [http://localhost:3000](http://localhost:3000), create your first account, and start writing.

## Default Access

| Port | Service |
|---|---|
| `3000` | Nana web app |
| `8090` | PocketBase admin UI |

> [!NOTE]
> Port `8090` is for PocketBase administration. The app itself is accessed through port `3000`.

## License

Licensed under [AGPL-3.0](LICENSE).
