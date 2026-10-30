/// <reference path="../pb_data/types.d.ts" />

// Version history is moving to git. This migration removes the old snapshot
// store and the document flag that triggered it:
//
// - drops `document_versions` (and the legacy `trash_document_versions` view)
//   together with every stored snapshot; the data is intentionally discarded;
// - removes `documents.published`, which only existed to request a snapshot;
// - rebuilds the `trash_documents` view without the removed column.
//
// `down()` can restore the schema, not the deleted rows: the collection comes
// back empty and old version history cannot be recovered.

const TRASH_DOCUMENTS_FIELDS = [
  "id",
  "title",
  "slug",
  "content",
  "attachments",
  "tags",
  "author",
  "word_count",
  "reading_time",
  "folder",
  "created",
  "updated",
  "is_public",
  "public_share_token",
  "public_expires_at",
  "is_private",
  "share_attachments",
  "deleted_at",
  "deleted_by",
]

const AUTHOR_RULE = "@request.auth.id != '' && author = @request.auth.id"
const VERSION_RULE =
  "@request.auth.id != '' && document.author = @request.auth.id && document.deleted_at = ''"

const MAX_CONTENT_SIZE_BYTES = 100 * 1024 * 1024

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

function trashDocumentsQuery(includePublished) {
  const fields = includePublished
    ? TRASH_DOCUMENTS_FIELDS.slice(0, 6).concat(["published"], TRASH_DOCUMENTS_FIELDS.slice(6))
    : TRASH_DOCUMENTS_FIELDS
  return `SELECT ${fields.join(", ")} FROM documents WHERE deleted_at != ''`
}

function syncTrashDocumentsView(app, includePublished) {
  const view = findCollection(app, "trash_documents")
  if (!view || view.type !== "view") return

  view.viewQuery = trashDocumentsQuery(includePublished)
  // Keep the existing rules; a fresh view gets the same owner-scoped access.
  if (view.listRule === null) view.listRule = AUTHOR_RULE
  if (view.viewRule === null) view.viewRule = AUTHOR_RULE
  app.save(view)
}

function removeDocumentVersions(app) {
  const legacyTrashView = findCollection(app, "trash_document_versions")
  if (legacyTrashView) app.delete(legacyTrashView)

  const versions = findCollection(app, "document_versions")
  if (versions) app.delete(versions)
}

function restoreDocumentVersions(app) {
  if (findCollection(app, "document_versions")) return

  const documents = app.findCollectionByNameOrId("documents")

  const versions = new Collection({
    name: "document_versions",
    type: "base",
    listRule: VERSION_RULE,
    viewRule: VERSION_RULE,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX `idx_document_versions_document_number` ON `document_versions` (`document`, `version_number`)",
    ],
  })

  versions.fields.add(
    new RelationField({
      name: "document",
      required: true,
      collectionId: documents.id,
      cascadeDelete: true,
      maxSelect: 1,
    })
  )
  versions.fields.add(
    new EditorField({ name: "content", required: false, maxSize: MAX_CONTENT_SIZE_BYTES })
  )
  versions.fields.add(new NumberField({ name: "version_number", required: true }))
  versions.fields.add(new TextField({ name: "change_summary" }))
  versions.fields.add(new TextField({ name: "source_created_at" }))
  versions.fields.add(
    new SelectField({
      name: "source",
      required: false,
      maxSelect: 1,
      values: ["publish", "ai", "undo"],
    })
  )
  versions.fields.add(new JSONField({ name: "snapshot" }))
  versions.fields.add(
    new SelectField({
      name: "actor_type",
      required: false,
      maxSelect: 1,
      values: ["user", "ai", "system"],
    })
  )
  versions.fields.add(new TextField({ name: "actor_label", max: 120 }))
  versions.fields.add(
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )

  app.save(versions)
}

migrate(
  (app) => {
    // Rebuild the view first so the column can be dropped without leaving a
    // query that still selects `published`.
    syncTrashDocumentsView(app, false)
    removeDocumentVersions(app)

    const documents = findCollection(app, "documents")
    if (documents && hasField(documents, "published")) {
      documents.fields.removeByName("published")
      app.save(documents)
    }

    // Re-materialize the view after the documents table change.
    syncTrashDocumentsView(app, false)
    return null
  },
  (app) => {
    const documents = findCollection(app, "documents")
    if (documents && !hasField(documents, "published")) {
      documents.fields.add(new BoolField({ name: "published" }))
      app.save(documents)
    }

    syncTrashDocumentsView(app, true)
    restoreDocumentVersions(app)
    return null
  }
)
