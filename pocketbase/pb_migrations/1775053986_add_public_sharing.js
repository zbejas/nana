/// <reference path="../pb_data/types.d.ts" />

const AUTHOR_ONLY_RULE = "@request.auth.id != '' && author = @request.auth.id"
const LEGACY_DOCUMENTS_RULE = "@request.auth.id != '' && (author = @request.auth.id || published = true)"
const LEGACY_DOCUMENT_VIEW_RULE = "author = @request.auth.id || published = true"

function addPublicFields(collection) {
  if (!collection.fields.getByName("is_public")) {
    collection.fields.add(new BoolField({
      name: "is_public",
      required: false,
    }))
  }

  if (!collection.fields.getByName("public_share_token")) {
    collection.fields.add(new TextField({
      name: "public_share_token",
      required: false,
      unique: true,
    }))
  }

  if (!collection.fields.getByName("public_expires_at")) {
    collection.fields.add(new DateField({
      name: "public_expires_at",
      required: false,
    }))
  }
}

function removePublicFields(collection) {
  if (collection.fields.getByName("is_public")) {
    collection.fields.removeByName("is_public")
  }

  if (collection.fields.getByName("public_share_token")) {
    collection.fields.removeByName("public_share_token")
  }

  if (collection.fields.getByName("public_expires_at")) {
    collection.fields.removeByName("public_expires_at")
  }
}

migrate(
  (app) => {
    const foldersCollection = app.findCollectionByNameOrId("folders")
    const documentsCollection = app.findCollectionByNameOrId("documents")

    if (!foldersCollection || !documentsCollection) {
      throw new Error("Documents or folders collection not found")
    }

    addPublicFields(foldersCollection)
    addPublicFields(documentsCollection)

    foldersCollection.listRule = AUTHOR_ONLY_RULE
    foldersCollection.viewRule = AUTHOR_ONLY_RULE
    documentsCollection.listRule = AUTHOR_ONLY_RULE
    documentsCollection.viewRule = AUTHOR_ONLY_RULE

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

    removePublicFields(foldersCollection)
    removePublicFields(documentsCollection)

    foldersCollection.listRule = LEGACY_DOCUMENTS_RULE
    foldersCollection.viewRule = LEGACY_DOCUMENT_VIEW_RULE
    documentsCollection.listRule = LEGACY_DOCUMENTS_RULE
    documentsCollection.viewRule = LEGACY_DOCUMENT_VIEW_RULE

    app.save(foldersCollection)
    app.save(documentsCollection)

    return null
  }
)