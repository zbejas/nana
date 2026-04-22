/// <reference path="../pb_data/types.d.ts" />

const DEFAULT_TITLE_PROMPT =
  "Generate a short title for the following conversation. " +
  "The title MUST start with a single relevant emoji, followed by a space and a concise descriptive name (max 5 words). " +
  "Output ONLY the title — no quotes, no extra text.\n\n" +
  "Examples:\n" +
  "📊 Sales Report Analysis\n" +
  "🐛 Fix Login Bug\n" +
  "✈️ Trip to Japan Planning"

migrate((app) => {
  try {
    const record = app.findFirstRecordByFilter("settings", "key = 'ai_config'")
    const value = record.get("value") || {}
    let changed = false

    if (value.systemPrompt === undefined) {
      value.systemPrompt = ""
      changed = true
    }
    if (value.titlePrompt === undefined) {
      value.titlePrompt = DEFAULT_TITLE_PROMPT
      changed = true
    }

    if (changed) {
      record.set("value", value)
      app.save(record)
    }
  } catch (_) {
    // Record may not exist yet — will be created with defaults on first save
  }

  return null
}, (app) => {
  try {
    const record = app.findFirstRecordByFilter("settings", "key = 'ai_config'")
    const value = record.get("value") || {}

    delete value.systemPrompt
    delete value.titlePrompt
    record.set("value", value)
    app.save(record)
  } catch (_) {
    // Record may not exist
  }

  return null
})
