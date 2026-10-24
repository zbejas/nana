# Nana — product truth

Nana is a self-hosted document workspace: notes, folders, multiple boards of tasks, attachments, version history, public sharing, and an AI assistant that reads the reader's own notes and boards. One Bun server, one React SPA, one PocketBase instance. The browser only ever talks to the Bun origin.

## Who it is for

One person or a small trusted team running Nana on their own machine or server. They write to think, keep notes they intend to return to, and want the work around those notes in the same place. They chose self-hosting on purpose: their data is not a product.

The scene: a desk at night, a low lamp, a browser window that should feel like paper rather than a dashboard. The same desk in daylight, on a phone, on the train.

## What Nana believes

- **The writing is the point.** Every surface clears space for reading and writing. Boards, chat, and settings are supporting rooms, not competing products.
- **Quiet ownership.** Self-hosted, no telemetry, no third-party account. Public sharing is opt-in and revocable.
- **One content model.** Notes live in `documents`. Folders organise them. Versions and trash protect them. Boards group separate work items; a task may point at the note it came from, but neither side duplicates or deletes the other. Boards are archived before they can be deleted.
- **Familiar affordances, editorial material.** Standard controls, keyboard behaviour, and structure; a distinct visual world built from bone and charcoal, one ultramarine signal, and rules rather than neon glass.
- **Nothing hides behind hover.** Every action has a touch path and a keyboard path.
- **The interface should disappear.** No gamification, no engagement mechanics, no badges for their own sake.

## Surfaces

| Surface | Job |
| --- | --- |
| Timeline | Find and reopen recent notes; filter by date. |
| Boards | Keep several boards of work; move tasks through Backlog → Next up → In progress → Done; import a note as a task; archive a board without deleting it. |
| Board archive | Restore an archived board, or delete it permanently and remove its tasks while keeping the source notes. |
| Folders | Browse and reorganise notes and folders. |
| Document editor | Write Markdown, attach files, publish versions, share. |
| Chat | Ask about notes and boards. The assistant reads them on demand; there is no document picker or attachment step. |
| Public note / folder | Read-only shared writing with no app chrome. |
| Settings | Account, preferences, workspace administration, about. |

## Success

A person can sign in, write a note, put the follow-up on a board, find both again in a month, and share a read-only link without thinking about the stack underneath.
