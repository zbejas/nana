/// <reference path="../pb_data/types.d.ts" />

// The embeddings/RAG layer was removed in favour of AI read tools. The
// `embedding_config` setting no longer drives anything, so drop the seeded
// record. Vector files already on disk are intentionally left alone; delete
// `pb_data/zvec` manually when reclaiming space.
migrate(
  (app) => {
    try {
      const records = app.findRecordsByFilter(
        "settings",
        'key = "embedding_config"',
        "",
        100,
        0
      )

      for (const record of records) {
        app.delete(record)
      }
    } catch (_) {
      // Settings collection or record already gone; nothing to remove.
    }

    return null
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId("settings")

      const existing = app.findRecordsByFilter(
        "settings",
        'key = "embedding_config"',
        "",
        1,
        0
      )

      if (existing && existing.length > 0) {
        return null
      }

      const record = new Record(collection, {
        key: "embedding_config",
        value: {
          chunkingStrategy: "paragraph",
          chunkSize: 500,
          chunkOverlap: 50,
          topk: 5,
          embeddingDimensions: {
            openai: 1536,
            google: 768,
            ollama: 768,
          },
          autoEmbed: true,
        },
        description:
          "Embedding pipeline configuration (chunking, dimensions, search settings)",
      })

      app.save(record)
    } catch (_) {
      // Collection missing on a partial rollback; leave settings untouched.
    }

    return null
  }
)
