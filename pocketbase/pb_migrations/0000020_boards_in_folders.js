/// <reference path="../pb_data/types.d.ts" />

// Boards can live in the same folder tree as notes and can be marked private.
// A folder relation uses cascadeDelete:false so deleting or trashing a folder
// never deletes a board; the trash routes rehome those boards to the root.

const BOARDS_FOLDER_INDEX_NAME = "idx_boards_author_folder"
const BOARDS_FOLDER_INDEX = `CREATE INDEX \`${BOARDS_FOLDER_INDEX_NAME}\` ON \`boards\` (\`author\`, \`folder\`)`

/** Collection lookups throw when missing; migrations should tolerate retries. */
function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function hasIndex(collection, name) {
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) {
      return true
    }
  }
  return false
}

function indexesWithout(collection, name) {
  const next = []
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) === -1) {
      next.push(String(indexes[i]))
    }
  }
  return next
}

migrate(
  (app) => {
    const boards = findCollection(app, "boards")
    if (!boards) {
      // Boards were never created; nothing to extend.
      return null
    }

    const folders = findCollection(app, "folders")
    if (folders && !boards.fields.getByName("folder")) {
      boards.fields.add(
        new RelationField({
          name: "folder",
          required: false,
          collectionId: folders.id,
          cascadeDelete: false,
          maxSelect: 1,
        })
      )
    }

    if (!boards.fields.getByName("is_private")) {
      boards.fields.add(
        new BoolField({
          name: "is_private",
          required: false,
        })
      )
    }

    if (boards.fields.getByName("folder") && !hasIndex(boards, BOARDS_FOLDER_INDEX_NAME)) {
      boards.indexes = indexesWithout(boards, BOARDS_FOLDER_INDEX_NAME).concat([
        BOARDS_FOLDER_INDEX,
      ])
    }

    app.save(boards)
    return null
  },
  (app) => {
    const boards = findCollection(app, "boards")
    if (!boards) {
      return null
    }

    // Remove the index before dropping the column it references.
    boards.indexes = indexesWithout(boards, BOARDS_FOLDER_INDEX_NAME)

    if (boards.fields.getByName("folder")) {
      boards.fields.removeByName("folder")
    }

    if (boards.fields.getByName("is_private")) {
      boards.fields.removeByName("is_private")
    }

    app.save(boards)
    return null
  }
)
