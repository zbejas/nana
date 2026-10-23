/// <reference path="../pb_data/types.d.ts" />

// PocketBase editor fields default to a 5 MB content limit when maxSize is 0.
// Notes (and their version/trash copies) can legitimately grow past that, so
// raise the cap. Keep all four content fields in sync: a version snapshot that
// is smaller than the document would otherwise fail to save.
const MAX_CONTENT_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

const CONTENT_FIELDS = [
  { collection: "documents", field: "content" },
  { collection: "document_versions", field: "content" },
  { collection: "trash_documents", field: "content" },
  { collection: "trash_document_versions", field: "content" },
]

function applyContentSizeLimit(app, maxSize) {
  for (const entry of CONTENT_FIELDS) {
    const collection = app.findCollectionByNameOrId(entry.collection)
    if (!collection) {
      throw new Error(`Collection not found: ${entry.collection}`)
    }

    const field = collection.fields.getByName(entry.field)
    if (!field) {
      throw new Error(`Field not found: ${entry.collection}.${entry.field}`)
    }

    if (field.maxSize === maxSize) {
      continue
    }

    field.maxSize = maxSize
    app.save(collection)
  }
}

migrate(
  (app) => {
    applyContentSizeLimit(app, MAX_CONTENT_SIZE_BYTES)
    return null
  },
  (app) => {
    // 0 restores PocketBase's built-in 5 MB editor default.
    applyContentSizeLimit(app, 0)
    return null
  }
)
