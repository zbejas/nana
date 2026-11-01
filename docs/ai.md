# AI — chat, MCP, providers, and tool surfaces

## Overview

Nana has two AI surfaces. **Chat** (`POST /api/chat/send`) reads and changes the signed-in user's notes, boards, tasks, and folders. A note can also host one **shared-note conversation** for its owner and the people it is shared with; that conversation is strictly note-scoped. The UI calls the full mode **Work** and sends `mode: "edit"`; **Ask** sends `mode: "ask"` and exposes only bounded read tools. **MCP** (`POST /mcp`) is a separate, stateless, write-capable surface for external AI clients; it exposes folders, notes, boards, and tasks through the same workspace services.

Both surfaces use the caller's PocketBase token, enforce author scoping, and apply the same **private lock**: private notes, private boards, private folders, and every descendant of a private folder are invisible. The REST API at `/api/v1` is the owner surface and deliberately does not apply that lock. Chat writes only in Work mode, through `src/api/workspace/`, with note revision checks and a server-owned audit row. Delete tools never mutate directly: they create a pending `chat_edits` row that the user must confirm. MCP writes through the same services under its separate authorization design. MCP also accepts a long-lived API key, which can be read-only and limited to the workspace root or selected folder subtrees.

Shared-note chat is not a second workspace surface. It authorizes one document by person sharing, never by a public link, and registers only the note tools. A grantee's personal chat opened on that shared note becomes note-scoped for the same reason.

There is no embeddings pipeline and no vector store. Chat accepts per-message attachments (images, PDFs, and text/Markdown) when an admin enables them; MCP has no attachment surface. Chat tool definitions use the AI SDK's `tool()` / `streamText()` API; MCP uses `@modelcontextprotocol/sdk`. PocketBase remains the authority for note, board, task, and attachment access.

## Key files

| File | Purpose |
| --- | --- |
| `src/api/chat/index.ts` | `handleChat()` routing, `POST /api/chat/send`, mode/context validation, system prompt assembly, tool loop, stream pump, persistence, title generation. |
| `src/api/chat/context.ts` | `resolveChatContext()`: caller-scoped document/board/folder lookup, trash and private-lock checks, resolved title; a shared document also returns the caller's access level and owner id; `contextSystemNote()` adds only the page id to the prompt. |
| `src/api/chat/group.ts` | Shared-note status (`GET /api/chat/notes/:id/chat`), access resolution through person sharing, disabled reasons, and server-created group conversation lookup/creation. |
| `src/api/workspace/sharing.ts` | `resolveSharingAccess()`: caller-token lookup of effective `owner`/`view`/`comment`/`edit` access; private and trashed records resolve to no access, and public-link flags never participate. |
| `src/api/chat/model-metadata.ts` | Fills missing model context windows from the cached models.dev catalog for chat status; explicit values always win and nothing is written to `ai_config`. |
| `src/api/chat/stream.ts` | SSE named events, legacy AI-SDK chunks, and `ChatStreamState` accumulation of text, reasoning, tool calls, edits, and the ordered `parts` timeline. |
| `src/api/chat/edits.ts` | `recordChatEdit()`, `listChatEdits()`, `undoChatEdit()`, edit DTO mapping, participant access checks, and owner-only undo/confirm. |
| `src/api/chat/tool-names.ts` | `CHAT_READ_TOOL_NAMES`, `CHAT_WRITE_TOOL_NAMES`, and the persisted `CHAT_TOOL_NAMES` allowlist. |
| `src/api/chat/tools/index.ts` | `createChatTools()` with ask/edit gating, per-tool instrumentation, and source collection. |
| `src/api/chat/tools/notes.ts` | `list_notes` and `read_note` executors, input schemas, note revisions/version tokens, private lock on reads; `read_note` authorizes, flushes an open live room, and reads the fresh body. |
| `src/api/chat/tools/boards.ts` | `list_boards` and `read_board` executors, column counts, task summaries, private lock. |
| `src/api/chat/tools/folders.ts` | `list_folders` executor and visible-folder projection. |
| `src/api/chat/tools/tasks.ts` | `list_tasks` and `read_task` executors through the AI-scoped workspace services. |
| `src/api/chat/tools/writes.ts` | Write schemas and executors for notes, boards, and tasks; section edits, revision checks, edit recording. |
| `src/api/chat/tools/recorder.ts` | Per-request source collection and pending edit cards. |
| `src/api/chat/tools/version.ts` | `noteVersionToken()` and `revisionMatches()` for optimistic concurrency. |
| `src/api/chat/tools/errors.ts` | Converts workspace `ApiError` values into model-safe tool failures. |
| `src/api/chat/pocketbase.ts` | `ai_config` read, conversation/message persistence, context/attachments/sources/tool sanitization, trimming, multipart PocketBase helper. |
| `src/api/chat/attachments.ts` | Upload validation (magic bytes), MIME/kind classification, PDF text extraction, draft resolution/binding/deletion, protected-file download, model capability checks. |
| `src/api/chat/providers.ts` | `getAIModel()` maps an enabled connection/model (or the legacy active provider) to an AI SDK language model; provider options seam. |
| `src/lib/ai/config.ts` | Pure v1/v2 normalization, model resolution, enabled-model listing, attachment limits, and safe chat status. |
| `src/api/chat/superuser.ts` | Cached PocketBase superuser token for admin-only settings reads and server-owned `chat_edits` writes. Never passed into `ToolContext`. |
| `src/api/chat/types.ts` | `ChatSendRequest`, `ChatMode`, `ChatContext`, `ChatAttachmentRef`, `ChatMessage`, `ChatEditDto`, `ChatStatusResponse`, empty-response copy. |
| `src/api/workspace/notes.ts` | `createNote`, `editNoteRecord`, `restoreNoteSnapshot`, revision-aware note updates, and live-room body/revision adoption. |
| `src/api/workspace/live.ts` | `flushLiveNoteBeforeExternalWrite()`, `adoptLiveNoteContent()`, and `adoptLiveNoteRevision()` for AI/REST/MCP writes against an open room. |
| `src/api/workspace/shared.ts` | `Surface` selection, `assertWritable()`, `visibilityFor()`, relation checks, paging bounds. |
| `src/api/pocketbase/client.ts` | Caller-token PocketBase client; adds `X-Nana-Actor: ai` when `ToolContext.actor` is `"ai"`. |
| `src/lib/markdown/sections.ts` | `applySectionEdits()`, `MarkdownSectionError`, and `closestTextLines()`; anchor validation, retry suggestions for a missing anchor, and section-scoped replacement without re-sanitizing untouched sections. |
| `src/lib/ai/types.ts` | `AIConfig`, v1/v2 provider and model shapes, provider defaults, attachment defaults, and `DEFAULT_TITLE_PROMPT`. |
| `src/components/settings/admin/AISettings.tsx` | Admin UI for provider connections, the enabled model catalog, per-model capabilities, attachment limits, and prompts; models.dev search fills metadata. |
| `src/pages/ChatPage.tsx` | Full-page chat surface; shares the chat store with the dock. |
| `src/components/chat/ChatDock.tsx` | Persistent right-side chat dock outside the route tree. |
| `pocketbase/pb_migrations/0000019_remove_embedding_settings.js` | Deletes the obsolete `embedding_config` setting. |
| `pocketbase/pb_migrations/0000020_boards_in_folders.js` | Adds `boards.folder` and `boards.is_private`, used by the AI visibility lock. |
| `pocketbase/pb_migrations/0000022_relational_remodel.js` | Adds the `messages` collection and removes the inline conversation JSON field. |
| `pocketbase/pb_migrations/0000027_chat_edits.js` | Adds document revisions/actor metadata, message context/sources/stopped, and `chat_edits`. |
| `pocketbase/pb_migrations/0000030_chat_attachments.js` | Adds the owner-scoped `chat_attachments` collection and `messages.attachments`. |
| `pocketbase/pb_migrations/0000031_message_usage.js` | Adds `messages.usage` for the final-step token accounting used by the context ring. |
| `pocketbase/pb_migrations/0000032_remove_document_versions.js` | Drops the legacy `document_versions` store and `documents.published`; version history is server-side git from this migration on. |
| `pocketbase/pb_migrations/0000033_message_parts.js` | Adds `messages.parts`, the ordered text/reasoning/tool/edit timeline used by the transcript. |
| `pocketbase/pb_migrations/0000035_group_chat.js` | Adds `conversations.scope`/`document`, the unique note conversation, `messages.author`/`author_label`, and group-aware conversation/message/`chat_edits` rules. |
| `tests/api/chat-group.test.ts` | Integration coverage for shared-note status/access, one group conversation, sender labels, paused history, public-link exclusion, attachment/regenerate rejection, and transcript isolation. |
| `tests/api/collab-persistence.test.ts` | Integration coverage for room merge/metadata adoption, hard persistence errors, explicit flush, and the `read_note` flush-before-read path. |
| `tests/api/chat-tools.test.ts` | Integration coverage for whole-note and windowed reads, completeness notices, scoping, truncation, error mapping, and private fixtures. |
| `tests/api/chat-attachments.test.ts` | Integration coverage for upload auth, disabled/limit/type rejection, draft ownership/deletion, binding, and sanitized refs. |
| `tests/api/chat-write-tools.test.ts` | Integration coverage for edit-mode gating, context resolution, shared-note scope registries, bound-note reads/writes, writes, revisions, edit cards, and undo. |
| `tests/api/chat.test.ts` | Integration coverage for chat auth, request validation, conversations, status, model selection errors, edit routes, and bounded tool-error persistence. |
| `tests/api/mcp.test.ts` | Integration coverage for MCP auth, transport errors, tool results, writes, and the private lock. |
| `tests/unit/chat-stream.test.ts` | Pure coverage for named SSE events, legacy chunks, and stream accumulation. |
| `tests/unit/chat-tool-errors.test.ts` | Pure coverage for `sanitizeToolError()` flattening, empty values, Unicode, and the 200-character bound. |
| `tests/unit/ai-config.test.ts` | Pure coverage for v1/v2 normalization, model resolution, defaults, status options, and attachment limits. |
| `tests/unit/chat-attachments.test.ts` | Pure coverage for magic-byte detection, SVG/binary rejection, PDF text extraction, limits, capabilities, and sanitized refs. |
| `tests/unit/ai-providers.test.ts` | Pure coverage for provider model construction, v2 selection, and disabled-model rejection. |
| `tests/unit/chat-context.test.ts` | Pure coverage for route context derivation, private branches, and the context payload. |
| `tests/unit/chat-context-usage.test.ts` | Token formatting, context percentages, remaining room, and warning thresholds. |
| `tests/unit/chat-model-metadata.test.ts` | models.dev fallback for missing legacy model context windows. |
| `tests/unit/chat-version-token.test.ts` | Pure coverage for note version tokens and revision matching. |
| `tests/unit/chat-activity.test.ts` | Pure coverage for tool-activity summarization and status precedence. |
| `tests/unit/chat-input-schemas.test.ts` | Pure coverage for tool input schemas and bounds. |
| `tests/unit/chat-tools-text.test.ts` | Pure coverage for filter escaping, id validation, and truncation helpers. |
| `tests/unit/ai-visibility.test.ts` | Pure coverage for hidden-folder computation and AI filter conditions. |
| `tests/unit/api-key-scope.test.ts` | Pure coverage for API key token format, folder inclusion, visibility, and record locks. |

## How it works

### Configuration

AI settings live in the admin-only `settings` record with key `ai_config`. The stored shape may be the original v1 form, the v2 form, or v2 with the legacy fields retained for older screens:

```json
{
  "version": 2,
  "activeProvider": "openai",
  "systemPrompt": "",
  "titlePrompt": "Generate a short title…",
  "connections": [
    {
      "id": "work",
      "name": "Work gateway",
      "kind": "openai",
      "baseUrl": "https://gateway.example/v1",
      "apiKey": "…",
      "enabled": true,
      "catalogProviderId": "openai"
    }
  ],
  "models": [
    {
      "id": "work:gpt-4o-mini",
      "connectionId": "work",
      "modelId": "gpt-4o-mini",
      "label": "GPT-4o mini",
      "enabled": true,
      "capabilities": { "vision": true, "files": true, "tools": true, "reasoning": false },
      "contextWindow": 128000,
      "maxOutputTokens": null,
      "temperature": null,
      "topP": null,
      "thinking": false,
      "metadataSource": "models.dev"
    }
  ],
  "defaultModelId": "work:gpt-4o-mini",
  "attachments": {
    "enabled": false,
    "maxFiles": 5,
    "maxFileBytes": 10485760,
    "maxTotalBytes": 26214400,
    "maxTextChars": 100000
  },
  "providers": {
    "openai": { "apiKey": "…", "baseUrl": "", "activeModel": "gpt-4o-mini", "temperature": null, "maxTokens": null, "topP": null, "thinking": false },
    "google": { "…": "same legacy shape" },
    "ollama": { "…": "same legacy shape, baseUrl defaults to http://localhost:11434" }
  }
}
```

`src/lib/ai/config.ts` normalizes both versions before use:

- With v2 `connections` or `models`, those arrays are authoritative. Connections with duplicate ids or unknown kinds are dropped; models with a missing connection, duplicate `connectionId:modelId`, or no model id are dropped. Numeric limits are clamped.
- Without v2 arrays, each legacy provider becomes a connection, and each non-empty `providers.*.activeModel` becomes a model. Only the previously active provider's model stays enabled and becomes the default.
- Model ids are canonical `connectionId:modelId`. `defaultModelId` is remapped to the canonical id; a missing, orphaned, or disabled default falls through to the first enabled model.
- An enabled model also requires its connection to be enabled. `configured` is true only when at least one such model exists.
- `attachments` is normalized to conservative defaults and clamped. It gates `POST /api/chat/attachments` and `POST /api/chat/send`: `enabled`, `maxFiles` (1–20), `maxFileBytes` (1 KiB–50 MiB), `maxTotalBytes` (at least `maxFileBytes`, up to 100 MiB), and `maxTextChars` (1,000–1,000,000). Disabled means the upload route returns `403` and a send carrying ids is refused.

`fetchAIConfig()` reads the record with the cached superuser token. Chat workspace tools, REST, and MCP never use that token; server-owned `chat_edits` rows are the deliberate exception.

| Provider | Package | Notes |
| --- | --- | --- |
| OpenAI / compatible | `@ai-sdk/openai` | `createOpenAI({ apiKey, baseURL }).chat(modelId)` so custom gateways use Chat Completions. Optional base URL. No `store` option is sent; that workaround only applied to the old Responses path. |
| Google | `@ai-sdk/google` | Optional custom base URL; `createGoogleGenerativeAI().chat(modelId)`. |
| Anthropic | `@ai-sdk/anthropic` | Optional custom base URL; `createAnthropic().chat(modelId)`. |
| Ollama | `ai-sdk-ollama` | Optional API key for remote instances; `thinking` maps to the Ollama `think` option on the selected model. |

`getAIModel(config, modelId?)` resolves an enabled v2 model and its connection; without an id it uses the default, then the first enabled model. If no v2 model is usable it falls back to the legacy `activeProvider`/`activeModel`. An explicit unknown or disabled id throws instead of silently falling back. `handleSend()` turns an unknown/disabled requested id into a `400` with code `model_not_found` before creating a conversation or opening a stream, and a missing usable model into `503`.

`GET /api/chat/status` returns `{ configured, model, provider, local, defaultModelId, models, limits }`. `models` contains only enabled models and carries `id`, `label`, `model`, `provider` (connection name), `providerKind`, `local`, `contextWindow`, `maxOutputTokens`, and the four capability flags. A model with no saved context window gets one from the cached models.dev catalog for this response; explicit values always win and `ai_config` is not changed. `limits` is the normalized attachment contract. Keys, base URLs, and connection internals are never returned.

### AI visibility lock

`src/api/workspace/privacy.ts` is the single implementation of "private means hidden from AI":

1. `loadAiVisibility()` reads every folder owned by the caller, paged at 500 records, with `id,parent,is_private,author`.
2. `computeHiddenFolderIds()` seeds the set with every `is_private` folder and walks descendants breadth-first. A private folder therefore hides its whole subtree; cycles and duplicate ids are tolerated.
3. `aiVisibilityConditions()` returns PocketBase filter fragments: `is_private=false`, plus `folder!="<id>"` for each hidden folder.
4. `noteIsLocked()`, `boardIsLocked()`, and `folderIsLocked()` apply the same rule to a loaded record: the record's own `is_private` flag or a hidden folder id.

| Surface | Entry point | Workspace surface | Private records |
| --- | --- | --- | --- |
| Chat Ask mode | `/api/chat/send` with `mode: "ask"` | `ai` | Hidden. |
| Chat Work mode | `/api/chat/send` with `mode: "edit"` | `ai` | Hidden for reads and writes. |
| Shared-note chat | `/api/chat/notes/:id/chat` + `/api/chat/send` on a `scope: "note"` conversation | `ai` + person sharing | Owner or person grantee only; private and trashed notes are disabled, public links never grant access. |
| MCP (session or key) | `POST /mcp` | `ai` | Hidden, even for a workspace-scoped key. |
| Elysia REST (session or key) | `/api/v1` | `user` | Visible to their owner, subject to key scope. |
| Browser facade | `/api/v1/records` | `user` | Visible to their owner; session JWT only. |

Consequences that are easy to miss:

- **Lists exclude hidden records before PocketBase computes totals.** `totalItems`, `totalBoards`, and `totalPages` therefore describe the visible set, not the stored set.
- **Reads return the generic `not_found`.** A private note or board, or one filed in a hidden folder, is indistinguishable from a missing record.
- **Writes to hidden records return `not_found`.** This covers chat edits as well as MCP update, move, delete, and "add note to board" when the source note or target board is hidden.
- **Creating under a hidden folder returns `not_found`.** The folder must be visible to the AI surface, even when the caller owns it.
- **MCP `list_folders` re-roots survivors.** A visible folder whose parent was hidden is returned with `parentId: null` so the hidden id never escapes.
- **A record created with `isPrivate: true` through MCP disappears immediately from that AI surface.** The write succeeds; the next read returns `not_found`. This is valid but surprising to a model, so the prompts say private records are inaccessible.
- **Shared-note chat is an explicit exception to author scoping, not to the private lock.** The bound note is authorized by an effective person grant, never by `is_public`/`public_share_token`. A public link grants no chat access.
- **A shared-note conversation cannot browse the workspace.** The strict note registry removes every list, board, task, folder, move, and delete tool; the model sees only the attached note.

The lock is structural, not prompt-based. The system instruction for chat and the MCP instructions both say private records are unavailable, but the filters and record checks are what enforce it. Public sharing has its own, separate `is_private` behavior; see [`pocketbase.md`](pocketbase.md).

### Chat request flow

1. `POST /api/chat/send` calls `verifyAuth(req)` and keeps the raw `Authorization` header.
2. Bun parses `{ conversationId?, message, attachmentIds?, modelId?, mode, context?, regenerate? }`. `message` is trimmed and may be empty only when `attachmentIds` contains at least one id. Ids must be unique-safe `[A-Za-z0-9]{1,64}` values; the hard count ceiling is 20. `mode` defaults to `"ask"`; anything other than `"ask"` or `"edit"` returns `400`. `modelId` is optional and names an id from `GET /api/chat/status.models`.
3. An existing `conversationId` is loaded with the caller's token before context or model work, so a foreign conversation is `404` immediately. A `scope: "note"` conversation is revalidated through the shared-note status: the bound note, current access level, and disabled reason come from the server, not the request. Attachments and `regenerate` are rejected for it (`400 group_attachments_unsupported` / `400 group_regenerate_unsupported`), and a paused note returns a `note_*` conflict before the stream.
4. If `context` is present, it must be `{ type: "document" | "board" | "folder", id }`. `resolveChatContext()` loads the record with the caller's token, checks trash state, and resolves the display title. A document owned by the caller also needs a visible AI snapshot; a document shared with the caller must resolve through `GET /api/sharing/access` at `view` level or higher, and public-link flags are ignored. A missing or malformed context is `400`; a foreign, trashed, private, or hidden one is `404`; an unavailable visibility/sharing lookup is `503`. A document shared with the caller becomes a strict note scope, so the rest of the workspace tools are not registered. The client cannot supply a title or body.
5. `fetchAIConfig()` loads `ai_config`, `normalizeAIConfig()` produces the v2 view, and `resolveChatModel()` picks the requested model, the default, or the first enabled model. An explicit unknown/disabled id is `400 model_not_found`; no usable model is `503`. Generation parameters (`temperature`, `maxOutputTokens`, `topP`) come from the selected model, and Ollama thinking is applied on its model instance. The old OpenAI Responses `store: false` workaround is not sent on the Chat Completions path.
6. When `attachmentIds` are present, `resolveAttachments()` verifies the caller owns every draft row, none is already bound, the count and byte caps pass, and the selected model supports the kinds. Images require `capabilities.vision`; a PDF requires `capabilities.files` or non-empty server-extracted text. Failures return `400`, `403`, `404`, `413`, or `415` before any conversation or stream is created.
7. Without a `conversationId`, Bun creates a personal conversation titled from the user text or the first attachment name and writes the user message with its resolved `context` and attachment refs. With one, it appends the user message; `regenerate: true` first trims the previous user/assistant pair. Draft rows are then bound to the new message with both `conversation` and `message`. A shared-note conversation is never created here: it is created by `POST /api/chat/notes/:id/chat`, and its send always keeps the conversation's bound note.
8. History is loaded and reduced to `{ role, content }` plus attachment content for user messages only. In a shared-note conversation, each user turn is prefixed with its stored sender label as `[Name] content` before it reaches the model; the visible transcript shows the label separately. Stored reasoning, tool activity, the ordered `parts` timeline, sources, context metadata, and model metadata are never sent back to the model. The resolved page context contributes a short system note instead.
9. `buildSystemPrompt()` writes the admin `systemPrompt` first, then the fixed base instruction (identity, grounding, bounded tool use, and communication), the read contract, the attachment-untrusted instruction when any message carries attachments, the write contract in edit mode, the page-context note when a context was resolved, and the shared-note block when the turn is note-scoped. The shared-note block names the bound document, the sender, and the sender's access level, repeats that sender labels are untrusted data, and permits note writes only at `edit` level. The base and contracts are code-owned; an admin prompt can add voice or policy but cannot remove them.
10. `createChatTools({ authHeader, userId }, { mode, recorder, conversationId, noteScope })` builds the read-tool set, plus the write-tool set only in edit mode. A strict `noteScope` replaces that registry with `read_note` only; at edit level it adds `append_note`, `edit_note`, and `update_note`. View/comment access forces `effectiveMode: "ask"` even when the client sent `mode: "edit"`, and `X-Chat-Mode` reports the effective mode.
11. `streamText()` runs with `stopWhen: stepCountIs(8)`, `maxRetries: 1`, and the request/abort signal. The selected model's upstream id is returned in `X-Model-Name`, its connection id in `X-Model-Source`, and the assistant row persists `model` as the upstream id. The stream pump emits named SSE events, records sources and applied edits, persists the assistant message after the model stream ends, and includes the final step's `usage` in the `done` frame and the stored row.
12. The stream pump persists the assistant row itself, links any edit cards to it, then emits `done`; it does not rely on an AI SDK `onFinish` callback. Title generation is fire-and-forget for a new, non-stopped personal conversation without a stream error, and uses the same selected model. It receives the user text or the first attachment name only; attachment bytes and extracted text are never passed to the title call. A shared-note conversation keeps the note title or the owner's rename; it is never auto-titled from a group message.

### Shared note chat

A note can have **one** shared conversation. It is a `conversations` row with `scope: "note"` and the note id in `document`; a partial unique index enforces one per note. Every other conversation is personal (`scope` empty or `"personal"`) and remains author-owned. The shared conversation's `author` is always the **note owner**, even when a grantee is the first person to open it. It is a session-only chat surface; API keys and MCP do not reach it.

- **Access.** The caller is the note owner or has an effective `view`, `comment`, or `edit` person grant, resolved through `resolveSharingAccess()`. A public link does not grant chat access. A note that is private or trashed is disabled even for its owner; a missing or foreign note is `not_found`.
- **Creation is server-only.** `POST /api/chat/notes/:id/chat` resolves access, then creates the conversation with the superuser credential and the note owner as author. `conversations.createRule` accepts only personal conversations, so a client cannot create a group row. A concurrent open that loses the unique-index race re-reads and returns the winner.
- **Status.** `GET /api/chat/notes/:id/chat` returns `{ status }`; the status carries `enabled`, `reason`, `shared`, `accessRole`, `accessLevel`, `canEdit`, `canManage`, and the existing `conversation` or `null`. The owner sees `not_shared` until at least one other person has a direct or inherited grant. `canEdit` is true only when the status is enabled and access is `edit` level (owner included); `canManage` is true only for the owner.
- **Paused history.** The owner keeps read access to an existing conversation for a private, trashed, or unshared note, so its history stays visible; sending is refused. A grantee loses the conversation when the note becomes private or trashed, or when the grant no longer resolves.
- **One thread per note.** The dock's Shared tab opens or creates this row; it never starts a second group thread. "New chat" always starts a personal conversation.
- **Sender context.** On send, Bun revalidates the conversation's note and access, loads the sender's display name from their own `users.name` (falling back to `Someone`), strips brackets/control characters, and persists `messages.author` + `messages.author_label` on the user turn. Assistant rows keep an empty author. Model history is prefixed per user turn as `[Name] content`; the transcript shows the label separately. Sender labels are untrusted data, and the system block says so.
- **Bound note.** A group send ignores any client-supplied `context`, resolves the conversation's `document` as the context, and passes a strict `noteScope` to the tool registry. The model can read only that note at `view`+; `append_note`, `edit_note`, and `update_note` exist only at `edit` level. There are no list, create, move, delete, folder, board, or task tools, and no second note id can be addressed.
- **Mode.** View and comment participants are forced to Ask even if the client sends `mode: "edit"`. `X-Chat-Mode` reports the effective mode. The group UI hides the Work/Ask switch and shows **Ask only** below edit level.
- **Unsupported inputs.** Group sends reject attachments (`400 group_attachments_unsupported`) and regeneration (`400 group_regenerate_unsupported`). The composer hides the attachment control in the Shared tab.
- **Management.** Only the note owner can rename or delete the shared conversation, and only the owner can undo an AI edit or confirm/cancel a pending action. Grantees can read the thread and its edit cards but cannot manage the conversation. Group chats register no delete tools, so they cannot create pending deletes.
- **Realtime.** The note thread refreshes on `messages` realtime events after a short debounce when the dock is in the Shared tab, so another participant's turn appears without a manual reload. Personal chats do not subscribe.
- **Personal chat on a shared note.** A grantee who attaches a shared note as page context gets a personal, author-owned conversation that is also strictly note-scoped: `read_note` at `view`+, plus the three note write tools at `edit` level, and no workspace browsing. The owner's personal chat on the same note keeps the full workspace tool set. The owner's note is only group-scoped through the Shared tab, not through page context.

See [`api.md`](api.md) for the route contract and error codes, [`pocketbase.md`](pocketbase.md) for the rules and migration, and [`frontend.md`](frontend.md) for the scope tabs and paused states.

### Chat attachments

Chat attachments are session-only. `POST /api/chat/attachments` accepts one multipart `file`; `DELETE /api/chat/attachments/:id` removes a draft. API keys and MCP never reach either route. The upload route uses `verifyAuth`, the `/api/chat/*` rate limiter, and a 60-second request timeout. PocketBase stores one owner-scoped `chat_attachments` row with a protected file.

Allowed uploads:

| Kind | Accepted | Model content |
| --- | --- | --- |
| `image` | PNG, JPEG, WebP, GIF. SVG is rejected. | AI SDK `ImagePart`; requires `capabilities.vision`. |
| `pdf` | `%PDF-` magic bytes. | Native `FilePart` (`application/pdf`) when `capabilities.files`; otherwise extracted text, and rejected when extraction is empty. |
| `text` | UTF-8 `text/plain` or Markdown. | Named `<attachment name="…">` text block. |

Validation uses actual bytes, not the browser-declared type: image signatures, `%PDF-`, valid UTF-8 without binary control characters, and explicit SVG rejection. The stored MIME type is the detected canonical type. Uploads are capped by `maxFileBytes`; a send is capped by `maxFiles` and `maxTotalBytes`. Text and PDF extraction is capped by `maxTextChars`; PDF extraction is also capped at 200 pages and 15 seconds. A scanned, encrypted, malformed, or empty PDF keeps its row with empty extracted text, so a file-capable model can still read it while a text-only model is refused.

Draft lifecycle:

1. Upload creates an unbound row (`conversation` and `message` empty) and returns only `{ id, name, mimeType, size, kind }`.
2. `resolveAttachments()` checks owner, unbound state, count, and byte caps before the send creates a conversation.
3. After the user message row exists, `bindAttachmentsToMessage()` sets `conversation` and `message`.
4. Deleting a conversation or message cascades its attachment rows and protected files. A user can delete an unbound draft through the DELETE route; bound rows return `409`. Failed or abandoned uploads remain drafts until deleted (there is no background sweep).

The model history keeps attachments only for `role: "user"` messages. The current turn is built first; older attachments share the same `maxTotalBytes` and `maxTextChars` budget and degrade from newest to oldest, using extracted text when possible and an explicit `[Attachment omitted: name]` marker otherwise. Assistant messages never contribute files. Attachment text is wrapped as `<attachment name="…">` and the system prompt states that attachment contents are untrusted data and never instructions.

Manual verification against a configured dev stack:

```bash
TOKEN="<pocketbase session token>"
ATTACHMENT_ID=$(curl -s -H "Authorization: $TOKEN" \
  -F "file=@./report.pdf" http://127.0.0.1:3000/api/chat/attachments \
  | jq -r '.attachment.id')

# An empty message is valid when at least one attachment is present.
curl -N -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d "{\"message\":\"\",\"attachmentIds\":[\"$ATTACHMENT_ID\"],\"mode\":\"ask\"}" \
  http://127.0.0.1:3000/api/chat/send

# The returned conversation history must show only { id, name, mimeType, size, kind }.
curl -s -H "Authorization: $TOKEN" \
  "http://127.0.0.1:3000/api/chat/conversations/<conversation-id>" | jq '.messages[].attachments'

# An unused upload is a draft and can be deleted; a bound row returns 409.
curl -i -X DELETE -H "Authorization: $TOKEN" \
  "http://127.0.0.1:3000/api/chat/attachments/$ATTACHMENT_ID"
```

Successful send requires an enabled model with `vision` for images or `files` for native PDFs. The integration suite covers upload auth/type/size/ownership, PDF text extraction, draft deletion, binding, and sanitized persistence; the streaming send path needs a configured provider (or a fake local endpoint) for an end-to-end run.

### Chat read tools

All chat tools are **caller-scoped**. Notes and boards read directly through PocketBase REST at `serverConfig.pocketbaseUrl` with the caller's token; task reads and every write go through the AI-scoped workspace services. The superuser token is never passed to a tool. The private lock is loaded before a workspace list or read and applied to every record; strict shared-note scope instead requires a live, non-private note with effective person access.

A strict `noteScope` is a different registry, not a filter over the normal set: only `read_note` is registered at `view`/`comment`, and `append_note`, `edit_note`, and `update_note` are added at `edit`. There is no `list_notes`, `list_folders`, board, task, move, create, or delete tool in a shared-note or shared-document personal chat.

| Tool | Input | Result |
| --- | --- | --- |
| `list_folders` | None. | Every visible folder with id, name, parent id, and privacy/public flags. Hidden folder subtrees are omitted. |
| `list_notes` | `query` (max 200, titles/tags only), `tag`, `folderId`, `page` (1–1000), `perPage` (1–50), `sort` (`updated`, `created`, `title`). | Note metadata: id, title, tags, dates, word count, reading time, folder, and privacy flag. Never body text. |
| `read_note` | `noteId`, `offset` (1-based, no schema maximum; checked against the actual line count), optional `limit` (1–2000 lines). Omit `limit` to read the whole note. | The returned body and note metadata plus `totalLines`, `returnedLines`, `complete`, `hasMore`, `omittedBefore`, `omittedAfter`, `omittedLines`, `nextOffset`, `notice`, `truncated`, `tailUnavailable`, `clippedLines`, `revision`, and `versionToken`. |
| `list_boards` | `includeArchived` (default false), `page`, `perPage`. | Boards with open/done/total and per-column task counts. Trashed boards only when requested. |
| `read_board` | `boardId`, optional `column` (`backlog`, `next`, `progress`, `done`), `page`, `perPage`. | Board summary and paged task summaries: title, status, priority, due date, labels, order, note id, 400-character plain-text excerpt. |
| `list_tasks` | `boardId`, optional `status` (column slug, `planned`, or `archived`), `page`, `perPage`. | Board tasks with status, priority, dates, labels, assignee id, note id, order, and bounded metadata. |
| `read_task` | `taskId`. | One task with its board name, up to 20,000 characters of description, completion/recurrence metadata, and a truncation flag. |

Bounds enforced in `src/api/chat/tools/`:

- Every list is paged; `perPage` is capped at 50.
- `list_notes` filters `author` to the caller and searches only `title` and `tags`; the private filter removes hidden notes and folder subtrees.
- `read_note` defaults to the whole note and uses a 24,000-character budget; an explicit window keeps a 2,000-character per-line cap. The loaded body is capped at 2,000,000 bytes. `complete` means this single result contains the whole note from line 1 with no omitted lines before or after the window, no clipped line, and no byte-cap loss. A later window and a tail-only read are therefore never complete, even when `hasMore` is false. `omittedBefore` is `offset - 1`; `omittedAfter` counts lines after the returned window in the readable body; `omittedLines` is their sum. `hasMore` sets `nextOffset`, while `truncated` is true only for loss inside the returned window (byte cap or clipped lines). An offset past the last line is `invalid_input` and names the actual line count. A byte-capped note sets `tailUnavailable: true` and says the tail cannot be read in this or any later window. A clipped line is counted in `clippedLines`, its remainder is not available in a later window, and it is not a safe exact edit anchor. Any result that starts after line 1 or loses text carries a non-null `notice` explaining what is missing. It returns the current `revision` and an opaque `versionToken`. It authorizes the caller and the note scope first, flushes an open live room with a bounded signal, then reads the fresh PocketBase body and revision. A room that is not clean after the flush returns `conflict` instead of stale content.
- A `replace_text` anchor that matches nothing, or a missing heading, returns up to three closest source lines for the failing anchor only, not every operation, as a structured `candidates` array on the failure result. `message` stays generic and is the only failure text persisted as tool activity; candidates are model-only and never enter stored tool parts or logs. The fallback caps the anchor, token set, and scanned lines so a near-2MB note cannot block the event loop. Each suggestion is one truncated line, and candidates remain caller-scoped because they come from the same note the caller was already authorized to read.
- `read_board`, `list_tasks`, and `read_task` refuse another user's board, a trashed board, and a hidden board or task with `not_found`. `read_task` caps the description at 20,000 characters.
- `list_folders` goes through `listFolders()` so it honors the same private lock and API-key envelope as every other AI read.
- The note and board read executors abort a PocketBase request after 8 seconds or when the model aborts. Chat note access and body reads use their own 8-second tool signals, and the pre-read/pre-write live-room flush is bounded separately so a 15-second PATCH × 8-second lookup chain cannot consume the whole tool call. Task reads and writes go through the shared workspace client, whose default is 30 seconds.
- Filter values are escaped and ids must match `[A-Za-z0-9]{1,64}` before they reach a filter.

Tool failures are returned as `{ ok: false, code, message }` with `code` one of `unauthorized`, `not_found`, `invalid_input`, `conflict`, or `unavailable`. PocketBase `403` and `404` both map to a generic `not_found` so tool results do not reveal another user's ids.

### Chat write tools

Write tools exist only when `mode: "edit"`. Ask mode returns the read-tool set without them; the system prompt is guidance, not the gate.

| Tool | Input | Behavior | Undo |
| --- | --- | --- | --- |
| `create_folder` | `name`, optional `parentId`. | Creates an owned folder through `createFolder()`. The parent must be visible. | None. |
| `rename_folder` | `folderId`, `name`, optional `summary`. | Renames a visible folder through `updateFolder()`. | None. |
| `move_folder` | `folderId`, `parentId` (or null for the root), optional `summary`. | Moves a folder under another visible folder through `updateFolder()`. Cycles are rejected. | None. |
| `create_note` | `title`, optional `content`, `tags` (max 20), `folder`. | Creates an owned note through `createNote()`. A folder must be visible; no privacy, publish, or share fields. | Trash the created note. |
| `append_note` | `noteId`, `markdown`, `expectedRevision`, optional `summary`. | Appends Markdown at the end through `applySectionEdits()`. Text outside the appended block is carried through, not regenerated. | Restore the pre-edit snapshot. |
| `edit_note` | `noteId`, `expectedRevision`, 1–20 section operations, `summary`. | Section-scoped `replace_section`, `insert_after`, `append`, or `replace_text`. A missing or ambiguous anchor aborts the whole edit before PocketBase is written; a missing anchor returns model-only `candidates` and a generic `message`. | Restore the pre-edit snapshot. |
| `update_note` | `noteId`, `expectedRevision`, optional `title`, optional `tags`, optional `summary`. | Renames a note or changes its tags. Body content belongs to `edit_note`. | Restore the pre-edit snapshot. |
| `move_note` | `noteId`, `folderId` (or null for the root), optional `summary`. | Moves a visible note between visible folders through `moveNote()`. | None. |
| `create_board` | `name`, optional `description`, optional `folder`. | Creates an owned board; PocketBase seeds the default workflow columns. The folder must be visible. | None. |
| `update_board` | `boardId`, optional `name`, `description`, optional `summary`. | Renames a board or changes its description through `updateBoard()`. | None. |
| `move_board` | `boardId`, `folderId` (or null for the root), optional `summary`. | Moves a visible board between visible folders through `moveBoard()`. | None. |
| `create_task` | `boardId`, `title`, optional `description`, `status`, `priority`, `dueDate`, `assignee`. | Creates a task on an active board. `status` is a column slug, `planned`, or `archived`; `assignee` is a user id, `me`, or `none`. | None. |
| `update_task` | `taskId`, optional `title`, `description`, `status`, `priority`, `dueDate`, `assignee`, `summary`. | Updates task fields. The board must be active and the status valid for it. | None. |
| `move_task` | `taskId`, `status`, optional `boardOrder`, optional `summary`. | Moves a task to another column on the same board; `planned` and `archived` are virtual statuses. | None. |
| `delete_note` | `noteId`, optional `summary`. | Creates a **pending** action; confirms to move the note to trash. No mutation before confirmation. | None. |
| `delete_task` | `taskId`, optional `summary`. | Creates a **pending** action; confirms to permanently delete the task. | None. |
| `delete_folder` | `folderId`, optional `summary`. | Creates a **pending** action; confirms to move the folder subtree to trash. Boards rehome to the root. | None. |
| `delete_board` | `boardId`, optional `summary`. | Creates a **pending** action; confirms to move the board and its tasks to trash. | None. |

A strict `noteScope` narrows the write registry to the three note tools. The service checks the bound id and `accessLevel >= 3` before loading the note, then writes with the caller's token; the tool cannot create, move, share, publish, or delete anything. A personal chat opened on a shared document gets the same scope. The owner's full workspace chat is unchanged.

Write bounds and invariants:

- Note content is capped at 2,000,000 characters, a single edit fragment at 200,000, task descriptions at 100,000, and titles at 200. Section operations are capped at 20.
- `expectedRevision` accepts the numeric `revision` or the opaque `versionToken` from `read_note`. A stale value returns `conflict` before the write.
- Section fragments are sanitized individually, then written with `sanitizeContent: false` so untouched sections are not re-sanitized.
- `append_note` and `edit_note` go through `src/lib/markdown/sections.ts`. Do not add a whole-document replace path for chat.
- A board or task write still runs the normal workspace checks: ownership, private lock, board trash rules, valid task status, and assignee board access.
- An open live room is flushed before the note body is read or written. The flush is bounded by the tool signal, and a room that is not clean after it fails the call instead of returning stale text. The external AI body is then adopted into the room as one server-origin diff, merged against concurrent local text; the room revision follows the external write so the next tool call does not self-conflict. Metadata-only note writes adopt the new revision without replacing the body.

#### Write path

1. The tool calls a shared workspace service with the caller's `ToolContext` and `actor: "ai"`; it never calls PocketBase directly for a write and never uses the superuser token.
2. `src/api/pocketbase/client.ts` sends `X-Nana-Actor: ai` on the request.
3. A note write authorizes the note and any `noteScope` first, flushes the open live room with a bounded signal, then loads the current body and revision. The tool passes the read `revision` and `versionToken` to `editNoteRecord()`, which re-checks the revision and updates the document with the caller's token.
4. AI edits do not create version history. Version history is manual-only: only an explicit **Save version** commits the current note state. Autosave and chat writes never touch it.
5. The revision guard rejects a stale submitted revision, bumps `documents.revision` on content/title/tag changes, and stamps `last_edited_by: "Nana"` / `last_edit_source: "ai"`.
6. The write tool records a server-owned `chat_edits` row with the target, tool, summary, changed sections/fields, revision metadata, and an optional pre-edit snapshot in `chat_edits.operations.before`. The row uses the server credential only after the caller's token has proved access to the conversation; a shared-note grantee can therefore create an edit card in the owner's conversation.
7. The recorder emits an `edit` event for the applied write. If audit persistence fails, the workspace write still succeeds and the card is omitted; the tool does not fail after a completed write.
8. After a content write, `adoptLiveNoteContent()` merges the stored body into an open room and applies one server-origin Yjs diff; concurrent local text survives when the merge succeeds, and the room persists the merged body before returning. The adoption accepts the tool's abort signal: if it is aborted, the room stays dirty for its scheduled flush and the completed PocketBase write still returns success. A non-mergeable body puts the room in `conflict` rather than overwriting. A metadata-only write calls `adoptLiveNoteRevision()` so the next room flush patches the new revision. Without a room, the returned revision is unchanged.
9. The tool result reports the room's final revision and, when the room had to persist a merge, omits the now-stale `versionToken` and `afterUpdated` undo comparison. The next `read_note` sees one coherent revision.
10. Undo of a created note moves it to trash. Undo of a note edit restores the pre-edit data stored in `chat_edits.operations.before` through the same revision-aware path. Board and task writes have no undo.

Chat does **not** expose publish, share, privacy, board-column, or label tools, and it cannot move a task to another board. Delete tools are two-step: the model can only create a pending action, and `POST /api/chat/edits/:id/confirm` executes it after the user clicks the card. A pending action can be cancelled, and confirmation re-checks ownership, visibility, and board trash rules with the caller's token. Notes, boards, and folders can be moved between visible folders; boards can also be trashed and restored.

### Chat stream contract

`POST /api/chat/send` returns SSE. The dock reads named events: `text`, `reasoning`, `tool`, `sources`, `edit`, `done`, and `error`. `edit` is emitted for an applied write or a pending delete card; `sources` and `done` carry the server-collected sources; `done` also carries final-step `usage` when available; `error` carries a mapped provider message. A failed `tool` event carries bounded, flattened failure text (not raw provider arguments or tool output), and the same safe text is persisted with the terminal tool part. Requests that omit `mode` also receive legacy AI-SDK UI chunks (`text-delta`, `reasoning-delta`, `tool-input-*`, `tool-output-*`, `finish`, `[DONE]`, and `error`); requests that send `mode` receive only the named events. The frame fields and response headers are in [`api.md`](api.md).

### MCP write surface

MCP is not chat. It is a separate Streamable HTTP endpoint at `POST /mcp`, authenticated with the same raw or Bearer session token or API key, and it is the external write surface. The endpoint contract and the full tool table live in [`api.md`](api.md); this section owns the boundary.

| Property | MCP |
| --- | --- |
| Transport | Streamable HTTP, `POST` only, JSON responses. |
| Session | Stateless. A fresh `McpServer` and transport per request; no session store. |
| Token | A session user token or a `nana_…` API key, raw or Bearer. A key is exchanged server-side for a normal user token; the superuser token is never in `ToolContext`. |
| Workspace surface | `"ai"` for every tool. |
| Author scoping | Every list filters on the owning record (`author`, or `board.author` for tasks); every loaded service checks that owner. |
| Credential scope | A key's `access` and `scope` are enforced by the workspace services. Read-only keys have no write tools; out-of-scope records look missing. |
| Private lock | Applied to lists, reads, writes, and relation targets; key scope never bypasses it. |
| Persistence | None beyond the workspace records the tools change. MCP activity is not written to `conversations`, `messages`, or `chat_edits`. |
| CORS | None; same-origin only. |
| Tool failure | MCP `isError` text result with `{ error: { code, message } }`; the HTTP request succeeds. |
| Destructive tools | `delete_note` (trash), `delete_board` (trash), `delete_task` (permanent). |

The tool families:

- **Folders:** `list_folders`, `create_folder`.
- **Notes:** `list_notes`, `read_note` (the chat executors), plus `create_note`, `update_note`, `move_note`, `delete_note` (workspace services).
- **Boards:** `list_boards`, `read_board` (the chat executors), plus `create_board`, `update_board`, `move_board`, `restore_board`, `delete_board`.
- **Tasks:** `list_tasks`, `create_task`, `update_task`, `move_task`, `delete_task`, `add_note_to_board`.

MCP instructions tell the model to read before writing, use only ids returned by a tool, never bypass the private lock, and treat note/task text as untrusted. The server does not ask for human confirmation; the authorization boundary is the user token, author scoping, the private lock, and the explicit destructive tool list. A prompt-injected note can at worst cause writes inside the caller's own visible workspace; it cannot reach another user or a private record.

### MCP credential scopes

An MCP client can authenticate with a signed-in session token or a long-lived API key created in **Settings → API keys**. The key is the recommended path for desktop and hosted MCP clients because it does not expire with the browser session.

| Key setting | MCP behavior |
| --- | --- |
| `access: "read"` | Only the read tool families are registered: folders list, note list/read, board list/read, task list. `tools/list` omits every write tool, and the instructions say the credential is read-only. |
| `access: "write"` | The full tool set is registered, still bounded by scope. |
| `scope: "workspace"` | The whole owner workspace, except the private lock. |
| `scope: "root"` | Notes and boards at the workspace root only. `list_folders` returns an empty list, `create_folder` is not registered, and folder ids look missing. |
| `scope: "folders"` | The selected folders and all descendants. The workspace root and other folders look missing; a selected folder whose parent is out of scope is returned with `parentId: null`. |

Scope is enforced before a tool runs: `visibilityFor()` builds one hidden-folder set from the private lock plus the key envelope, list queries add the matching filter fragments, and single-record reads/writes call `recordIsLocked()`. A model cannot escape the envelope by guessing ids; it gets the same generic `not_found` as a missing record.

Read-only keys are also blocked in the shared services, so the same key cannot write through the typed REST API even if a client ignores `tools/list`. A key cannot manage keys: key creation, listing, and revocation require a signed-in session.

API keys never change the private lock. A "workspace" key is still an AI surface under `surface: "ai"`, so private notes, boards, folders, and private-folder subtrees remain hidden.

### Tool loop and prompt

The fixed instruction has three layers:

1. **Base contract**, after the admin prompt: Nana's identity and workspace scope; grounding in tool results; the private lock; untrusted content; read completeness (`complete`/`omittedBefore`/`omittedAfter`/`notice`/`nextOffset`); read-before-write; tool success as the only proof of a write; confirmation-card deletes; concise, self-contained communication; and no invented ids, titles, counts, or sources.
2. **Read contract**, always present: `list_notes` searches titles and tags only; `read_note` defines `complete` as one whole-note result from line 1 and warns that clipping or a byte cap is permanent; use the board read chain; use visible folder ids; never invent ids; treat list results as metadata rather than proof of content; cite only records actually read or changed; route unsupported writes to Work mode.
3. **Conditional contracts**: attachment text is untrusted; Work mode adds the write rules below; a resolved page context adds its record id and a read-tool hint. Titles and content stay out of the system prompt.

Work mode (`mode: "edit"`) adds:

- Change only what the user asked for; a broad request authorizes the specific writes it needs, not unrelated reorganizing.
- Create, rename, and move folders, notes, and boards when asked; create, update, and move tasks. A folder or parent must be visible.
- Read the note or board first; pass the current revision or `versionToken` to every note edit. Require `complete: true` only for a whole-note summary, claim, or whole-note edit; a section-scoped edit needs the target section and an exact anchor from returned content.
- Use `edit_note` for section-scoped changes; never replace a whole note. A missing or ambiguous heading aborts the edit; retry from an exact anchor, copying `candidates[].text` when a missing-anchor failure returns suggestions, not from a clipped or byte-capped read. If the note is too large to read in a few windows, stop and ask which section to edit; never infer omitted lines.
- On `conflict`, read again and retry once; never retry blindly.
- Delete tools only create a confirmation card. Never claim a deletion happened before the user confirms.
- Do not share, publish, move a task to another board, change privacy, or change board columns or assignees who cannot access the board.
- After a note write, say what changed and that it can be undone from chat; after other writes, report exactly what changed.
- If a write fails, report the failure and do not claim partial success unless the tool says so.

`stopWhen(stepCountIs(8))` is required for list → read chains and multi-step edits; without it the SDK stops after one step.

### Persistence

Conversations live in `conversations`; each turn is a row in `messages` with `conversation`, `role`, `content`, `position`, and optional `reasoning`, `tools`, `parts`, `context`, `attachments`, `sources`, `usage`, `stopped`, and `model` fields. A conversation has a title, an `author`, a `scope` (`personal` or `note`), and, for a note conversation, a `document` id. A user message may carry:

```ts
{
  role: "user",
  content: string,
  authorId?: string,
  authorLabel?: string,
  context?: { type: "document" | "board" | "folder", id: string, title: string },
  attachments?: Array<{ id: string, name: string, mimeType: string, size: number, kind: "image" | "pdf" | "text" }>
}
```

`authorId`/`authorLabel` are written on shared-note user turns; assistant turns have no author. The label is the sender's display name, never an email.

An assistant message may contain:

```ts
{
  role: "assistant",
  content: string,
  reasoning?: string,
  tools?: Array<{ name: string; status: "success" | "error" }>,
  sources?: Array<{ type: "document" | "board", id: string, title: string }>,
  usage?: { inputTokens: number, outputTokens: number, totalTokens: number, reasoningTokens?: number, cachedInputTokens?: number },
  stopped?: boolean,
  model?: string
}
```

- `sanitizeMessage()` runs `sanitizeHtml()` on content and allowlists `authorId`, the cleaned `authorLabel`, context, attachment refs, sources, tools, usage, and the stopped flag before persistence. Attachment refs never carry extracted text, the stored file name, or raw bytes.
- The assistant `sources` array is built from records whose content was actually read; successful note/board writes also add the target note or board. `list_notes` and `list_boards` metadata searches do not become sources. It is not model output.
- Appending writes a `messages` row with the next `position` and touches the conversation's `updated` timestamp so the sidebar order stays current. A shared-note participant appends with their own token, but the conversation update rule is owner-only, so `touchConversation()` uses the server credential for `scope: "note"` after the caller's read proves participation.
- `getConversationMessages()` paginates and returns rows ordered by `position,created`; shared-note rows carry their stored sender id/label.
- `trimLastExchange()` reads newest-first, deletes the trailing assistant run, then the preceding user turn.
- `sanitizeTools()` keeps only names in `CHAT_TOOL_NAMES`, terminal `success`/`error` statuses, and bounded safe `error` text for a failed call. Call ids, inputs, outputs, and arbitrary fields are dropped; duplicate names collapse, with `error` winning.
- Older stored messages may still contain extra fields; they are tolerated on read, but only the allowlisted fields are written back.
- Applied writes are persisted as `chat_edits` rows. The row is server-owned, linked to the conversation and later to the assistant message, and rendered as an edit card.
- The empty-response fallback is `CHAT_EMPTY_RESPONSE_FALLBACK` from `src/api/chat/types.ts`.
- Title generation is fire-and-forget after the first reply when the conversation is new, not stopped, and has no stream error; a failure is logged and leaves the seeded title in place. Titles are plain text: the server strips emoji, flags, keycaps, and variation selectors from generation, seeds, and manual renames, and the old emoji-default prompt is migrated to the plain-text default.
- MCP does not persist conversations, tool activity, or edit cards.

### Chat surface

The chat surface has two entry points that share one store: the full page at `/chat` and `/chat/:conversationId`, and the persistent right-side dock mounted at the app root. The dock is hidden while the full page is open. In Personal scope, the dock sends the open page's `{ type, id }` context automatically at send time; there is no visible chip or dismissal state. In the Shared tab, the conversation's bound note is forced and client context is ignored. The server resolves the record, applies ownership, trash, sharing, and private checks, and the prompt receives only the id. Opening a private note, board, or folder, or a page whose privacy lookup is still loading, does not attach context.

On a note route, the dock shows a **Personal | Shared** scope switch. Shared is always present; it is disabled with a reason when the note is unshared, private, trashed, or inaccessible. The tab keeps an already-open thread visible when its note is paused, with the composer disabled and the history readable. Group turns are labeled with the sender's display name (or **You**), and the thread refreshes on realtime message events.

The composer uses **Work/Ask**. Work is the default and sends `mode: "edit"`; Ask is the read-only lock and sends `mode: "ask"`. A shared-note conversation below edit level forces Ask and shows **Ask only** instead of the switch; its attachment control is hidden and regeneration is unavailable. Assistant turns persist an ordered `messages.parts` timeline of text, reasoning, tool calls, and edit cards, so the chat UI can render each call where it happened instead of collecting every tool at the top. Consecutive calls group into one quiet disclosure; a running group opens automatically, and single calls are their own rows. Applied writes render at the point the write completed; expanding one shows its details and Undo where available. Delete tools auto-expand with explicit confirm/cancel actions. Failed calls show a failed count and an expandable bounded error line; after a finished tool with no text yet, the streaming label is **Waiting for model…**. Sources render as a collapsed `Sources · N` disclosure. Persisted tool parts keep only names, statuses, bounded failure text, and safe target titles; inputs and outputs never leave the server. See [`frontend.md`](frontend.md) for layout and the [`design.md`](design.md) chat treatment.

### Security boundaries

- **Caller token only for tools.** `ToolContext.authHeader` is the user's raw token; `getSuperuserToken()` is never passed to a chat tool, read or write. The `chat_edits` audit row is the deliberate server-owned exception: it is written with the server credential only after the caller's token proves access to the conversation (the personal owner or a current shared-note participant).
- **Author scoping.** List tools filter on `author`; single-record services verify `record.author` before returning. Tasks use `board.author`. Shared-note chat is the one deliberate exception: it authorizes one document by effective person sharing, then removes every other tool.
- **Mode gates writes.** `createChatTools()` returns only read tools in ask mode. The system prompt does not enforce this; the tool registry does. A view/comment shared-note participant is forced to ask mode on the server even if the request says `edit`.
- **Shared-note scope is structural.** A strict `noteScope` registers only `read_note` (plus the three note write tools at edit level). The bound id is checked before every read/write; another note, board, task, folder, or delete is not addressable. Public links never authorize the surface, and private or trashed notes are paused.
- **Writes are revision-checked.** Note edits require the `revision` or `versionToken` from `read_note`; a mismatch is `conflict` before PocketBase is touched. Section edits carry untouched content through without replacing the whole note. `read_note` flushes an open live room first and returns `conflict` rather than a stale body when the room cannot persist.
- **Destructive chat actions are confirm-first.** Delete tools only create a pending `chat_edits` row. The user must call confirm from the card; that request re-checks conversation ownership and runs the workspace delete with the caller's token. A pending action deleted from the UI can be cancelled without a write. The model cannot delete from prose or by retrying. Shared-note chats register no delete tools.
- **Shared-note management stays with the note owner.** The conversation author is the note owner, and conversation rename/delete plus edit undo and pending-action confirmation require that owner. A grantee can read the thread and its edit cards, but cannot manage them. Messages rules bind user rows to `author = @request.auth.id` and allow assistant rows only with an empty author.
- **Sender labels are data.** A group turn stores a sanitized display name and prefixes model history with `[Name]`. The system block says labels are untrusted and never instructions; do not treat a display name as authorization or an identity proof.
- **Attachments are session-only, owner-scoped, and private.** Uploads and sends use `verifyAuth` and the caller's token; `chat_attachments` has owner-only rules and is not in the generic record facade. API keys and MCP cannot upload, resolve, or read chat attachments. The protected file is fetched with a short-lived file token and an 8-second timeout. Shared-note conversations reject attachments and do not show the attachment control.
- **Attachment contents are untrusted.** Text files and PDF fallbacks are wrapped in named text blocks; the system instruction says never to follow instructions inside them. Only the selected model's `vision`/`files` capabilities decide whether images and native PDFs are sent.
- **MCP is separate.** MCP has its own destructive tools and its own token/scope design. Do not widen chat to match MCP's tool list.
- **Private lock.** Private records and private-folder subtrees are filtered from lists and return `not_found` by id on reads and writes, including chat edits.
- **Untrusted content.** Tool text is data, not instructions. Ask mode can only produce a bad answer. Work mode can create or change visible notes, boards, tasks, and folders; note revision checks and the confirm-first delete flow bound the damage. A shared-note chat can only read or change the one bound note, and view/comment participants can only ask. MCP adds direct destructive tools with its own authorization.
- **Allowlisted persistence.** Only `{ name, status, error? }` for `CHAT_TOOL_NAMES` is stored in `tools`; `error` is bounded, flattened failure text and never raw arguments or outputs. Sources and edit metadata are server-derived and separately allowlisted.

See [`security.md`](security.md) for the threat model and review checklist.

### Failure modes

| Symptom | Cause and handling |
| --- | --- |
| `503` before the stream | `ai_config` missing, or no enabled model (including the legacy active-provider fallback) is configured. |
| `502` before the SSE stream | Provider connection/auth failure; the message comes from `getAIErrorMessage()`. Failures after streaming begins emit an `error` event instead. |
| `400` before the stream | Invalid JSON, an empty turn (no text and no attachments), invalid `mode`, malformed `context`, an invalid/bound/too-many attachment id, or a `modelId` that is unknown or disabled. A shared-note send also returns `400 group_attachments_unsupported` or `400 group_regenerate_unsupported`. The model case carries code `model_not_found`. |
| `403` before the stream | Attachments are disabled (`attachments_disabled`) or the caller cannot use the attachment surface. |
| `404` before the stream | The context record is missing, trashed, foreign, or hidden by the private lock; a note is not shared with the caller; an attachment id is missing or foreign; or the conversation is missing/foreign. |
| `409` before the stream for a shared note | The note is private/trashed (`note_private`/`note_trashed`), has no other person grant for its owner (`note_not_shared`), or the conversation's status is otherwise disabled. The owner can still read an existing paused history. |
| `413` before the stream | An attachment or the combined attachment set exceeds the configured byte cap (`too_large`). |
| `415` before the stream | The file type is unsupported, SVG, mismatched with its bytes, or the selected model lacks the vision/files capability required by an attachment (`unsupported_model`). |
| `503` before the stream for context | The visibility snapshot or sharing lookup could not be loaded; the workspace is unavailable. A disabled shared-note check with `reason: "unavailable"` returns `503 note_unavailable`. |
| Empty assistant text | Replaced with the fixed fallback; a new conversation still gets a title attempt. |
| `unauthorized` tool result | The tool received no token. Chat itself rejects invalid tokens with `401` before tools run, but a token that expires mid-turn can make PocketBase answer as a guest; list results may be empty rather than an error. Re-check the session if a request unexpectedly returns nothing. |
| `not_found` tool result | The record is missing, trashed, belongs to another author, is outside the shared-note bound id, is a trashed board, or is hidden by the private lock. |
| `invalid_input` tool result | The model sent an invalid id, filter value, page bound, section anchor, or write field. |
| `conflict` tool result | A note changed since it was read, a section heading is ambiguous, a task write targets a trashed board, or an open live room could not persist its pending body. The model should re-read and retry, not blindly repeat. |
| `unavailable` tool result | PocketBase timed out, was unreachable, or returned an unreadable body. A live room that cannot be flushed maps to `unavailable` unless it reported a conflict. |
| Failed tool row | The tool returned `ok: false`. The SSE event and stored part carry bounded failure text; the UI shows a failed count and can expand the error detail. Provider tool errors are reduced to `The tool failed.` and never echo arguments. |
| SSE `error` event | The provider failed after streaming began; the client shows the mapped message. |
| Undo `409` | A note-edit undo found a newer revision/`updated` value, the edit has no saved revision or snapshot, or the target is a board/task edit, which has no chat undo. |
| Edit card missing after a successful write | `chat_edits` persistence failed; the workspace write still completed. |
| MCP `401` | Missing, invalid, or expired user token; returned before any MCP work. |
| MCP `-32700` | The request body was not valid JSON. |
| MCP `isError` result | The tool failed with `not_found`, `invalid_input`, `conflict`, `upstream_unavailable`, or `unavailable`; the HTTP request succeeded. |
| MCP write conflict | A task was created or updated on a trashed board. |

Tool logs contain the tool name, duration, and result count only. Inputs, outputs, auth headers, and note/task text are not logged.

## Gotchas & invariants

- **The superuser token is for configuration, credential exchange, and server-owned audit rows.** Chat tools, REST, and MCP must use `context.authHeader`; API key lookup and `chat_edits` persistence are the server-side exceptions. Swapping `getSuperuserToken()` into `ToolContext` would expose every user's notes and boards.
- **`src/lib/ai/config.ts` owns config compatibility.** Do not read `connections`/`models` directly from `ai_config`, and do not add a second v1 fallback in a route. Normalization clamps values, drops orphaned/duplicate models, and maps `defaultModelId` to the canonical `connectionId:modelId`.
- **Model pickers and send use the same resolution.** `GET /api/chat/status.models` lists enabled models only (connection must also be enabled); `POST /api/chat/send` rejects an explicit unknown/disabled `modelId` with `400 model_not_found` instead of silently using another model.
- **Status and error payloads never carry credentials.** `/api/chat/status` exposes connection names and model ids but not API keys or base URLs; `X-Model-Source` carries a connection id, never a secret.
- **Chat writes are mode-gated, not prompt-gated.** Ask mode must return exactly the read tool set. Adding a write tool to `readTools` bypasses the mode gate even if the prompt says not to write.
- **Shared-note scope is a separate registry.** Do not implement it by filtering `list_notes` results. `createChatTools()` must return only `read_note` for a strict scope and add exactly the three note write tools at edit level. A grantee's personal chat on a shared document uses the same scope.
- **Shared-note chat never grants workspace access.** It authorizes one note by person sharing; public-link flags are not access. Do not call it for a private or trashed note, and do not let a client choose the bound id from the send body.
- **A note has one shared conversation.** The unique partial index and `findNoteConversation()` enforce it. "New chat" is personal; do not create a second group row or reuse the personal last-chat atom for a note thread.
- **The note owner is the group conversation author.** Only that owner can rename/delete the conversation or undo an edit; a grantee can read and contribute but not manage. Do not infer authority from `canEdit`.
- **Sender labels are untrusted.** Keep `[Name]` prefixes out of authorization decisions and wrap the group sender block as data. The stored label comes from `users.name`, never email.
- **A view/comment participant is forced to Ask.** The server changes `effectiveMode` and the header; the client cannot upgrade by sending `mode: "edit"`. Group attachments and regeneration are rejected even at edit level.
- **Write tools belong in `src/api/chat/tools/writes.ts` and go through `src/api/workspace/`.** Do not add direct PocketBase writes to a chat executor; revision checks, private lock, sanitization, and actor stamping live in the services.
- **Note edits are revision-checked twice.** The tool checks `expectedRevision` against the read note, then `editNoteRecord()` re-checks `revision` and `versionToken`. A stale write returns `conflict`; it never overwrites newer work.
- **`read_note` must authorize before flushing.** Guessing a note id must not flush someone else's live room. Authorize, flush with a bounded signal, then read fresh; a room that is not clean after the flush is a `conflict`, not stale model input.
- **AI content writes are adopted into an open room.** `adoptLiveNoteContent()` applies the stored body as one server-origin diff after merging concurrent local text, and `adoptLiveNoteRevision()` handles metadata-only writes. Do not have the editor re-apply the fetched AI body as a local Yjs transaction; the room broadcast is canonical.
- **Section edits are the only body-edit primitive.** `applySectionEdits()` validates every anchor before the write. Fragments are sanitized first, then written with `sanitizeContent: false` so untouched sections are not re-sanitized. A missing anchor is `invalid_input` and may return model-only `candidates`; an ambiguous one is `conflict`. Only the generic `message` is persisted as tool activity.
- **AI edits never create version history.** Version history is manual-only and lives in the server-side git store. Do not reintroduce a snapshot write or a version-request flag on note updates.
- **Chat undo uses its own stored snapshot.** Note-edit undo restores the pre-edit title, content, tags, folder, and privacy from `chat_edits.operations.before`; it does not read version history or create a version.
- **`X-Nana-Actor: ai` is how a write reads as Nana.** It sets `last_edited_by`, `last_edit_source`, and task activity `actor_type`. Do not drop the header or the record will look user-edited.
- **`chat_edits` is server-owned.** It has no create/update/delete rules. Bun writes it with the superuser credential only after verifying that the caller owns the conversation; never expose a client-writable audit table.
- **Only note writes are undoable.** `create_note` undo trashes the note; `append_note`/`edit_note`/`update_note` undo restores the pre-edit snapshot. Board and task edit cards have `undo.kind: "none"` and `available: false`.
- **Undo is idempotent; note-edit undo is conflict-aware.** A second undo of a successful edit returns `alreadyUndone: true` without applying twice. A note-edit undo returns `409` if the note has a newer revision or `updated` timestamp; created-note undo trashes the target without a revision check.
- **A failed audit write does not roll back the workspace write.** The tool succeeded; only the card is missing. Do not report a failed edit to the model after the service returned success.
- **Chat tool names are a persisted contract.** Adding or renaming a chat tool requires updating `CHAT_READ_TOOL_NAMES` or `CHAT_WRITE_TOOL_NAMES` and the label map in `src/components/chat/ChatToolStrip.tsx`; otherwise stored activity is dropped or shown as “Checked the workspace”. MCP tool names are not persisted.
- **Sources are server-collected.** `sources` comes from records whose content a read tool returned, plus the target of a successful note/board/task creation. List-only metadata searches are not sources. Never parse model text to build links. The recorder caps the list at 50 and the persistence sanitizer re-checks type/id/title.
- **Context is metadata, not retrieval.** The client sends only `{ type, id }`; Bun resolves and persists the record title for history, while the system prompt receives only the id. A private, loading, unavailable, or public-link-only page is not attached; a foreign id returns `404`, while a shared document with an effective person grant may attach and becomes note-scoped. Do not add note bodies or client-supplied titles to the context payload.
- **MCP keys are scoped in the services, not the prompt.** `context.apiKey` carries access and scope; `visibilityFor()`, `recordIsLocked()`, and `assertWritable()` enforce it. A key's scope never replaces the private lock.
- **Read-only means no write tools and no service writes.** `tools/list` omits them and the workspace services return `403` if a client calls one through REST.
- **Every workspace AI read needs author scoping.** Lists filter on `author`; task queries use `board.author`; single-record reads check the owning record. Strict shared-note chat is the explicit exception: it authorizes the bound note by effective person access and registers no workspace lists. PocketBase rules are the second line of defence, not the only one.
- **Messages are records, not a JSON blob.** `conversations.messages` no longer exists. Write through `src/api/chat/pocketbase.ts`; direct conversation patches cannot persist chat turns.
- **The private lock is not a prompt.** `loadAiVisibility()` runs before lists and reads, `aiVisibilityConditions()` filters totals, and `noteIsLocked()`/`boardIsLocked()` guard records. A prompt statement alone is not enough.
- **Private means hidden from AI, not from the owner.** `/api/v1` and the browser client still show private records to their owner. Do not reuse `surface: "user"` for chat or MCP.
- **Trashed records are absent from AI surfaces.** `documents` and `folders` list/view rules add `deleted_at = ''`; `not_found` covers a trashed note or folder as well as a missing or foreign one.
- **A private folder hides its descendants even when they are not flagged.** Visibility is computed from `parent`, not from the child's own `is_private`.
- **Creating a private record through MCP makes it disappear from that surface.** The write succeeds; subsequent reads return `not_found`. That is expected.
- **Trashed boards are readable metadata but not readable work.** `list_boards({ includeArchived: true })` can list them; `read_board`, `list_tasks`, and `read_task` return `not_found` for a trashed board or its tasks.
- **`list_notes` never searches bodies.** A body-only match will not appear; the model must use `read_note` after a metadata hit.
- **`read_note` advances by returned lines.** Use `nextOffset`, not arithmetic; the character budget can return fewer lines than `limit`. `complete` is whole-note truth for one result, so a later window is never complete; `omittedBefore`, `omittedAfter`, and `omittedLines` describe both sides, and a byte-capped or clipped tail is permanently unavailable.
- **MCP tool failures are not HTTP failures.** Return `isError` results for workspace errors; reserve HTTP/RPC errors for auth, parse, and transport failures.
- **Streaming statuses are not persisted.** The client may show `running`; only terminal `success`/`error` reaches the conversation record.
- **`stepCountIs(8)` is deliberate.** Reducing it to the SDK default breaks list → read and multi-step edit sequences. Raising it multiplies PocketBase reads.
- **Tool text is untrusted input.** Ask mode's read-only scope makes the worst case a bad answer. Work mode and MCP are real mutation surfaces, so the private lock, revision checks, and the pending-delete confirmation are part of the security boundary.
- **Attachment validation is byte-first.** Do not trust `File.type` or the file name; `detectAttachment()` checks image/PDF magic, UTF-8 text validity, and rejects SVG. The stored MIME type is canonical.
- **Attachment text never leaves the server.** `chat_attachments.text` and the protected file name are internal. API DTOs carry only `{ id, name, mimeType, size, kind }`; `messages.attachments` is sanitized on read and write.
- **Attachment drafts are not messages.** An unbound row can be deleted; a bound row follows its message and conversation through cascades. There is no background draft sweep, so a failed upload may leave a draft until the user deletes it.
- **History attachments share one budget.** The current turn wins; older user turns degrade newest-to-oldest to extracted text or an omission marker. Assistant messages never contribute attachments.
- **Title generation is text-only.** It receives the user text or the first attachment name, never bytes or extracted text.

## Related docs

- [`api.md`](api.md) — chat routes, SSE payloads, edit/undo endpoints, REST endpoints, MCP transport, and the full MCP tool table.
- [`frontend.md`](frontend.md) — chat page, global dock, automatic page context, context-usage ring, edit cards, and tool-activity UI.
- [`security.md`](security.md) — token isolation, chat write path, MCP authorization, prompt-injection stance.
- [`pocketbase.md`](pocketbase.md) — `settings`, `conversations`, `chat_edits`, revisions, board folders, and the collections the tools read.
- [`deployment.md`](deployment.md) — provider configuration and upgrade cleanup.
