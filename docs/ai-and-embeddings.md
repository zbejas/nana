# AI and embeddings

Nana's AI stack has three parts: chat with an LLM provider, optional retrieval over the user's documents, and a vector index built from document chunks.

## Configuration

Stored in the PocketBase `settings` collection, admin-only:

| Key | Config |
| --- | --- |
| `ai_config` | Active provider, per-provider credentials/models, generation params, system prompt, title prompt. |
| `embedding_config` | Chunking strategy/size/overlap, top-k, similarity threshold, per-provider dimensions, auto-embed. |

`ai_config.providers` has entries for `openai`, `google`, and `ollama`:

```json
{
  "activeProvider": "openai",
  "systemPrompt": "",
  "titlePrompt": "Generate a short title…",
  "providers": {
    "openai": {
      "apiKey": "…",
      "baseUrl": "",
      "activeModel": "gpt-4o-mini",
      "embeddingModel": "text-embedding-3-small",
      "temperature": null,
      "maxTokens": null,
      "topP": null,
      "thinking": false
    }
  }
}
```

`embedding_config` defaults are defined in `src/api/embeddings/types.ts`; the migration seeds a starting record in `0000009_created_embedding_settings.js`.

## Providers

`src/api/chat/providers.ts` maps the active provider to Vercel AI SDK models:

| Provider | Chat | Embeddings | Package |
| --- | --- | --- | --- |
| OpenAI | `@ai-sdk/openai` | `openai.embedding()` | `@ai-sdk/openai` |
| Google | `@ai-sdk/google` | `google.textEmbeddingModel()` | `@ai-sdk/google` |
| Ollama | `ai-sdk-ollama` | `ollama.embedding()` | `ai-sdk-ollama` |

Ollama supports an optional API key for remote/authenticated instances and a `think` flag for thinking models. OpenAI/Google accept an optional custom base URL.

The Bun server reads AI/embedding config with the superuser token from `src/api/chat/superuser.ts` (12-hour cache, auto-refresh, invalidate-on-401).

## Chat flow

`POST /api/chat/send` in `src/api/chat/index.ts`:

1. `verifyAuth()` validates the user token.
2. Load `ai_config`; create the model via `getAIModel()`.
3. Create a conversation or append to an existing one.
4. Load message history.
5. If `documentIds` were supplied (from `#` mentions), run semantic search scoped to those documents. If embeddings are unavailable or empty, fall back to raw document content.
6. Build the system prompt from the admin `systemPrompt` plus retrieved context.
7. Stream the response with `streamText()` → `toUIMessageStreamResponse()`.
8. In `onFinish`, persist the assistant message (content, reasoning, sources, model) and generate a title for new conversations.

**Automatic RAG across all documents is currently disabled** (see the comment in `handleSend`). Explicit `documentIds` is the active retrieval path. Do not describe the system as automatically searching all documents unless that code is re-enabled.

The response includes `X-Conversation-Id`, `X-Is-New-Conversation`, `X-Model-Name`, and optionally `X-RAG-Sources`.

### Conversations

- Stored in the `conversations` collection: `title`, `author`, `messages` (inline JSON), timestamps.
- Messages are `{ role, content, reasoning?, sources?, model? }`.
- Message HTML is sanitized before persistence.
- The first message seeds the title; a background title generation call refines it after the first reply.

## Embedding pipeline

`src/api/embeddings/pipeline.ts`:

1. Fetch AI + embedding config.
2. Verify an active provider, embedding model, and dimensions.
3. Fetch the document with the user's auth.
4. Prepend `Title:` and `Tags:` metadata to the content.
5. Strip Markdown and chunk the text.
6. Delete existing chunks for that document.
7. Batch-embed with `embedMany()`.
8. Upsert chunks into Zvec.
9. For `embed-all`, delete the user's vectors first, embed every document, then optimize the index.

Empty content removes the document's vectors rather than creating an empty chunk.

### Chunking

`src/api/embeddings/chunking.ts` strips Markdown, then splits with one of:

| Strategy | Behavior |
| --- | --- |
| `fixed` | Character windows of `chunkSize` with `chunkOverlap`. |
| `paragraph` | Paragraph boundaries, merging to `chunkSize`; oversized paragraphs fall back to fixed. |
| `sentence` | Sentence boundaries, merging to `chunkSize` with overlap. |

Each chunk carries `documentId`, `chunkIndex`, and `chunkText`.

## Vector store

`src/api/embeddings/zvec.ts` uses `@zvec/zvec`, an in-process HNSW vector store.

- Location: `pocketbase/pb_data/zvec/<provider>_<dimensions>/`.
- One collection per provider + dimensions.
- Fields: `documentId`, `chunkIndex`, `chunkText`, `userId`, vector `embedding`.
- Metric: cosine; vectors are `fp32`.
- Every search filters on `userId`; do not remove that isolation.
- Collections are cached on `globalThis` so they survive HMR; HMR disposes and closes them to release RocksDB locks.
- `SIGTERM`/`SIGINT` calls `closeAllZvecCollections()` in `src/index.ts`.

Changing the embedding model usually changes dimensions. If the dimension for a provider changes, the collection path changes; old vectors remain on disk until cleaned up.

## Auto-embed lifecycle

`src/api/pocketbase-proxy.ts` observes PocketBase responses:

| Event | Action |
| --- | --- |
| Document create/update (`POST`/`PATCH`) | Resolve the user, then fire-and-forget `embedDocument()`. |
| Document delete | Fire-and-forget `deleteEmbeddings(userId, documentId)`. |
| Move document to trash | Delete its embeddings. |
| Move folder to trash | Delete embeddings for every moved document. |
| Restore document | Re-embed it. |
| Restore folder | Re-embed every restored document. |

The embedding path never blocks the save/delete response. Failures are logged and do not fail the user's operation.

`shouldAutoEmbed()` reads `embedding_config.autoEmbed`; the embed endpoint also supports `{ auto: true }` to respect it.

## Search

`POST /api/embeddings/search`:

- Embeds the query.
- Searches the user's vectors for the active provider/dimensions.
- Filters results below `similarityThreshold`.
- Returns `{ documentId, chunkIndex, chunkText, score }`.

`searchDocumentsByIds()` scopes results to the supplied document IDs and falls back to raw document content when embeddings are missing or search fails. This is what powers `#` document mentions in chat.

## Failure modes

| Symptom | Likely cause |
| --- | --- |
| `No AI provider is active` | `ai_config.activeProvider` is null. |
| `No embedding model configured` | Provider has no `embeddingModel`. |
| `Cannot connect to AI provider` | Bad base URL, provider down, or Ollama not running. |
| Embeddings empty after save | `autoEmbed` disabled, no provider/model, or embedding call failed; check logs with `DEBUG=true`. |
| Dimension mismatch | Embedding model changed without rebuilding the vector collection. |
| Zvec lock/open failure | A previous process still holds RocksDB locks, or HMR did not close collections. |

Logging uses `createLogger("Chat")`, `createLogger("Embeddings")`, `createLogger("Zvec")`, and `createLogger("Proxy")`.

## Related docs

- [`api.md`](api.md) — exact chat/embedding request and response shapes.
- [`pocketbase.md`](pocketbase.md) — settings collection and superuser bootstrap.
- [`security.md`](security.md) — token handling and data isolation.
- [`deployment.md`](deployment.md) — runtime data and Zvec persistence.
