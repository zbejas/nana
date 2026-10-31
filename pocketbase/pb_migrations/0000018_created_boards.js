/// <reference path="../pb_data/types.d.ts" />

// Multiple author-scoped boards. Boards are archived first and can only be
// deleted permanently from the archive; deleting a board cascades its tasks.
// Existing tasks are backfilled into one "My board" per author.

const AUTHOR_RULE = "@request.auth.id != '' && author = @request.auth.id"
const BOARD_DELETE_RULE =
  "@request.auth.id != '' && author = @request.auth.id && archived = true"
const TASK_BOARD_RULE =
  "@request.auth.id != '' && author = @request.auth.id && board.author = @request.auth.id && board.archived = false"

const BOARDS_INDEX_NAME = "idx_boards_author_archived"
const BOARDS_INDEX = `CREATE INDEX \`${BOARDS_INDEX_NAME}\` ON \`boards\` (\`author\`, \`archived\`)`
const TASKS_BOARD_INDEX_NAME = "idx_tasks_board_status_order"
const TASKS_BOARD_INDEX = `CREATE INDEX \`${TASKS_BOARD_INDEX_NAME}\` ON \`tasks\` (\`board\`, \`status\`, \`board_order\`)`

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

function ensureField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field)
  }
}

/**
 * Creates the boards collection or fills in the pieces a partially applied
 * copy may be missing. Safe to run more than once.
 */
function ensureBoardsCollection(app, usersCollection) {
  let boards = findCollection(app, "boards")

  if (!boards) {
    boards = new Collection({
      name: "boards",
      type: "base",
      listRule: AUTHOR_RULE,
      viewRule: AUTHOR_RULE,
      createRule: AUTHOR_RULE,
      updateRule: AUTHOR_RULE,
      deleteRule: BOARD_DELETE_RULE,
      indexes: [BOARDS_INDEX],
    })
  }

  ensureField(boards, new TextField({ name: "name", required: true, max: 120 }))
  ensureField(boards, new TextField({ name: "description", max: 500 }))
  ensureField(boards, new BoolField({ name: "archived" }))
  ensureField(
    boards,
    new RelationField({
      name: "author",
      required: true,
      collectionId: usersCollection.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )
  ensureField(
    boards,
    new AutodateField({ name: "created", onCreate: true, onUpdate: false })
  )
  ensureField(
    boards,
    new AutodateField({ name: "updated", onCreate: true, onUpdate: true })
  )

  boards.listRule = AUTHOR_RULE
  boards.viewRule = AUTHOR_RULE
  boards.createRule = AUTHOR_RULE
  boards.updateRule = AUTHOR_RULE
  boards.deleteRule = BOARD_DELETE_RULE

  if (!hasIndex(boards, BOARDS_INDEX_NAME)) {
    boards.indexes = indexesWithout(boards, BOARDS_INDEX_NAME).concat([
      BOARDS_INDEX,
    ])
  }

  app.save(boards)
  return boards
}

function findFirstBoardForAuthor(app, authorId) {
  try {
    const records = app.findRecordsByFilter(
      "boards",
      "author = {:author}",
      "+created",
      1,
      0,
      { author: authorId }
    )
    if (records && records.length > 0 && records[0]) {
      return records[0]
    }
  } catch (_) {
    // No board yet, or the collection/index is still settling.
  }
  return null
}

function findOrCreateBoardForAuthor(app, boardsCollection, authorId) {
  const existing = findFirstBoardForAuthor(app, authorId)
  if (existing) {
    return existing
  }

  const board = new Record(boardsCollection)
  board.set("name", "My board")
  board.set("description", "")
  board.set("archived", false)
  board.set("author", authorId)
  app.save(board)
  return board
}

/**
 * Moves every task that has no board yet onto its author's default board.
 * Tasks keep their status and board_order; only the relation is written.
 */
function backfillTasks(app, boardsCollection) {
  const unassigned = app.findRecordsByFilter(
    "tasks",
    'board = ""',
    "+created",
    0,
    0
  )
  const boardsByAuthor = {}

  for (let i = 0; i < unassigned.length; i++) {
    const task = unassigned[i]
    if (!task) continue

    const author = task.get("author")
    if (!author) continue

    let board = boardsByAuthor[author]
    if (!board) {
      board = findOrCreateBoardForAuthor(app, boardsCollection, author)
      boardsByAuthor[author] = board
    }

    task.set("board", board.id)
    app.save(task)
  }
}

migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId("users")
    if (!usersCollection) {
      throw new Error("users collection not found")
    }

    const boardsCollection = ensureBoardsCollection(app, usersCollection)

    const tasksCollection = app.findCollectionByNameOrId("tasks")
    if (!tasksCollection) {
      throw new Error("tasks collection not found")
    }

    // Add the relation as optional first so existing tasks can be backfilled.
    const existingBoardField = tasksCollection.fields.getByName("board")
    if (!existingBoardField || existingBoardField.collectionId !== boardsCollection.id) {
      const boardField = new RelationField({
        name: "board",
        required: false,
        collectionId: boardsCollection.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
      if (existingBoardField) {
        boardField.id = existingBoardField.id
      }
      tasksCollection.fields.add(boardField)
    }

    if (!hasIndex(tasksCollection, TASKS_BOARD_INDEX_NAME)) {
      tasksCollection.indexes = indexesWithout(
        tasksCollection,
        TASKS_BOARD_INDEX_NAME
      ).concat([TASKS_BOARD_INDEX])
    }

    app.save(tasksCollection)

    backfillTasks(app, boardsCollection)

    // Every task now belongs to a board. Enforce it going forward and keep
    // tasks off other users' boards and off archived boards.
    tasksCollection.createRule = TASK_BOARD_RULE
    tasksCollection.updateRule = TASK_BOARD_RULE
    tasksCollection.listRule = AUTHOR_RULE
    tasksCollection.viewRule = AUTHOR_RULE
    tasksCollection.deleteRule = AUTHOR_RULE

    const boardField = tasksCollection.fields.getByName("board")
    if (boardField) {
      boardField.required = true
    }

    app.save(tasksCollection)
    return null
  },
  (app) => {
    const tasksCollection = findCollection(app, "tasks")

    if (tasksCollection) {
      tasksCollection.listRule = AUTHOR_RULE
      tasksCollection.viewRule = AUTHOR_RULE
      tasksCollection.createRule = AUTHOR_RULE
      tasksCollection.updateRule = AUTHOR_RULE
      tasksCollection.deleteRule = AUTHOR_RULE

      if (tasksCollection.fields.getByName("board")) {
        tasksCollection.fields.removeByName("board")
      }
      tasksCollection.indexes = indexesWithout(
        tasksCollection,
        TASKS_BOARD_INDEX_NAME
      )

      // Only drop the relation after the field and its index are gone;
      // otherwise deleting boards would cascade-delete every task.
      app.save(tasksCollection)
    }

    const boardsCollection = findCollection(app, "boards")
    if (boardsCollection) {
      app.delete(boardsCollection)
    }

    return null
  }
)
