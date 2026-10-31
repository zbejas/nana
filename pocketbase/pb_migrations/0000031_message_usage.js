/// <reference path="../pb_data/types.d.ts" />

// Assistant messages keep the final model step's token usage. The chat UI uses
// it for the composer's context-usage ring; old rows simply have no usage.

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
    if (!messages || hasField(messages, "usage")) return null
    messages.fields.add(new JSONField({ name: "usage" }))
    app.save(messages)
    return null
  },
  (app) => {
    const messages = findCollection(app, "messages")
    if (!messages || !hasField(messages, "usage")) return null
    messages.fields.removeByName("usage")
    app.save(messages)
    return null
  }
)
