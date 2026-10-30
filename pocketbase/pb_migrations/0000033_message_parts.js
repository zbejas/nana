/// <reference path="../pb_data/types.d.ts" />

// Assistant messages keep an ordered timeline of text, reasoning, tool calls,
// and edit cards. The flat `tools` field stays for older clients and summaries;
// `parts` is what lets the transcript show a call where it happened.

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function hasField(collection, name) {
  return Boolean(collection && collection.fields.getByName(name))
}

migrate(
  (app) => {
    const messages = findCollection(app, "messages")
    if (!messages || hasField(messages, "parts")) return null
    messages.fields.add(new JSONField({ name: "parts" }))
    app.save(messages)
    return null
  },
  (app) => {
    const messages = findCollection(app, "messages")
    if (!messages || !hasField(messages, "parts")) return null
    messages.fields.removeByName("parts")
    app.save(messages)
    return null
  }
)
