# Nana — product truth

Nana is a self-hosted document workspace: notes, folders, a board of tasks, attachments, version history, public sharing, and an AI assistant over the reader's own writing. One Bun server, one React SPA, one PocketBase instance. The browser only ever talks to the Bun origin.

## Who it is for

One person or a small trusted team running Nana on their own machine or server. They write to think, keep notes they intend to return to, and want the work around those notes in the same place. They chose self-hosting on purpose: their data is not a product.

The scene: a desk at night, a low lamp, a browser window that should feel like paper rather than a dashboard. The same desk in daylight, on a phone, on the train.

## What Nana believes

- **The writing is the point.** Every surface clears space for reading and writing. Board, chat, and settings are supporting rooms, not competing products.
- **Quiet ownership.** Self-hosted, no telemetry, no third-party account. Public sharing is opt-in and revocable.
- **One content model.** Notes live in `documents`. Folders organise them. Versions and trash protect them. Tasks are separate work items that may point at the note they came from; they do not duplicate it.
- **Familiar affordances, warm material.** Standard controls, keyboard behaviour, and structure; a distinct visual world built from warmth, ink, and paper rather than neon glass.
- **Nothing hides behind hover.** Every action has a touch path and a keyboard path.
- **The interface should disappear.** No gamification, no engagement mechanics, no badges for their own sake.

## Surfaces

| Surface | Job |
| --- | --- |
| Timeline | Find and reopen recent notes; filter by date. |
| Board | Move tasks through Backlog → Next up → In progress → Done; import a note as a task. |
| Folders | Browse and reorganise notes and folders. |
| Document editor | Write Markdown, attach files, publish versions, share. |
| Chat | Ask about notes, optionally scoped to attached documents. |
| Public note / folder | Read-only shared writing with no app chrome. |
| Settings | Account, preferences, workspace administration, about. |

## Success

A person can sign in, write a note, put the follow-up on the board, find both again in a month, and share a read-only link without thinking about the stack underneath.
