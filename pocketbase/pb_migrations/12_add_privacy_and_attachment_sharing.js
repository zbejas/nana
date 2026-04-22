/// <reference path="../pb_data/types.d.ts" />

function addPrivacyFields(collection) {
  if (!collection.fields.getByName("is_private")) {
    collection.fields.add(new BoolField({
      name: "is_private",
      required: false,
    }))
  }

  if (!collection.fields.getByName("share_attachments")) {
    collection.fields.add(new BoolField({
      name: "share_attachments",
      required: false,
    }))
  }
}

function removePrivacyFields(collection) {
  if (collection.fields.getByName("is_private")) {
    collection.fields.removeByName("is_private")
  }

  if (collection.fields.getByName("share_attachments")) {
    collection.fields.removeByName("share_attachments")
  }
}

migrate(
  (app) => {
    const foldersCollection = app.findCollectionByNameOrId("folders")
    const documentsCollection = app.findCollectionByNameOrId("documents")

    if (!foldersCollection || !documentsCollection) {
      throw new Error("Documents or folders collection not found")
    }

    addPrivacyFields(foldersCollection)
    addPrivacyFields(documentsCollection)

    app.save(foldersCollection)
    app.save(documentsCollection)

    return null
  },
  (app) => {
    const foldersCollection = app.findCollectionByNameOrId("folders")
    const documentsCollection = app.findCollectionByNameOrId("documents")

    if (!foldersCollection || !documentsCollection) {
      return null
    }

    removePrivacyFields(foldersCollection)
    removePrivacyFields(documentsCollection)

    app.save(foldersCollection)
    app.save(documentsCollection)

    return null
  }
)
