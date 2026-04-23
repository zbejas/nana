/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const settingsCollection = app.findCollectionByNameOrId("settings")

  const record = new Record(settingsCollection, {
    key: "ai_config",
    value: {
      activeProvider: null,
      providers: {
        openai: {
          apiKey: "",
          baseUrl: "",
          activeModel: "",
          embeddingModel: "",
          temperature: null,
          maxTokens: null,
          topP: null,
        },
        google: {
          apiKey: "",
          baseUrl: "",
          activeModel: "",
          embeddingModel: "",
          temperature: null,
          maxTokens: null,
          topP: null,
        },
        ollama: {
          apiKey: "",
          baseUrl: "http://localhost:11434",
          activeModel: "",
          embeddingModel: "",
          temperature: null,
          maxTokens: null,
          topP: null,
        },
      },
    },
    description: "AI provider configuration (models, API keys, embedding settings)",
  })
  app.save(record)

  return null
}, (app) => {
  try {
    const record = app.findFirstRecordByFilter("settings", "key = 'ai_config'")
    app.delete(record)
  } catch (_) {
    // Record may not exist
  }
  return null
})
