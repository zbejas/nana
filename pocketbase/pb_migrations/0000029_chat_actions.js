/// <reference path="../pb_data/types.d.ts" />

// Chat actions can be queued for confirmation (deletes) and can target
// folders (create/delete folder cards). Existing rows stay valid.

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function unionValues(current, additions) {
  const values = Array.isArray(current) ? current.slice() : []
  for (let i = 0; i < additions.length; i += 1) {
    if (values.indexOf(additions[i]) === -1) values.push(additions[i])
  }
  return values
}

function setSelectValues(app, collection, fieldName, additions) {
  if (!collection) return
  const field = collection.fields.getByName(fieldName)
  if (!field) return
  field.values = unionValues(field.values, additions)
  app.save(collection)
}

migrate(
  (app) => {
    const edits = findCollection(app, "chat_edits")
    if (!edits) return null

    setSelectValues(app, edits, "status", ["pending", "cancelled"])
    setSelectValues(app, edits, "target_type", ["folder"])
    return null
  },
  (app) => {
    const edits = findCollection(app, "chat_edits")
    if (!edits) return null

    // Keep extended values while records use them. Removing a select value
    // that is still referenced would make the existing rows unreadable.
    const used = app.findRecordsByFilter(
      "chat_edits",
      "status='pending' || status='cancelled' || target_type='folder'",
      "",
      1,
      0
    )
    if (used.length > 0) return null

    const status = edits.fields.getByName("status")
    if (status) status.values = ["applied", "undone", "failed"]
    const targetType = edits.fields.getByName("target_type")
    if (targetType) targetType.values = ["document", "board", "task"]
    app.save(edits)
    return null
  }
)
