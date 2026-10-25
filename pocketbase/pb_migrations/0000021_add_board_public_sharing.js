/// <reference path="../pb_data/types.d.ts" />

// Boards can be shared publicly like notes and folders. The public route only
// serves active, non-private boards; archiving or making a board private stops
// the link without deleting the token. Expired links are disabled by the
// shared cleanup route and the public-sharing cron.

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function addPublicFields(collection) {
  if (!collection.fields.getByName("is_public")) {
    collection.fields.add(
      new BoolField({
        name: "is_public",
        required: false,
      })
    )
  }

  if (!collection.fields.getByName("public_share_token")) {
    collection.fields.add(
      new TextField({
        name: "public_share_token",
        required: false,
        unique: true,
      })
    )
  }

  if (!collection.fields.getByName("public_expires_at")) {
    collection.fields.add(
      new DateField({
        name: "public_expires_at",
        required: false,
      })
    )
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
    const boards = findCollection(app, "boards")
    if (!boards) {
      // Boards were never created; nothing to extend.
      return null
    }

    addPublicFields(boards)
    app.save(boards)
    return null
  },
  (app) => {
    const boards = findCollection(app, "boards")
    if (!boards) {
      return null
    }

    removePublicFields(boards)
    app.save(boards)
    return null
  }
)
