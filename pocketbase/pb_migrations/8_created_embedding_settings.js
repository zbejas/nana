/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("settings")

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

    return null
  },
  (app) => {
    try {
      const records = app.findRecordsByFilter(
        "settings",
        'key = "embedding_config"',
        "",
        1,
        0
      )
      if (records && records.length > 0) {
        app.delete(records[0])
      }
    } catch (_) {
      // already gone
    }

    return null
  }
)
