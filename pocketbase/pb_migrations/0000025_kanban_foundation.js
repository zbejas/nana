/// <reference path="../pb_data/types.d.ts" />

// Kanban foundation.
//
// - Boards own an ordered workflow of columns. Task.status stores the column
//   slug (stable across renames); `planned` and `archived` are virtual statuses
//   used by the backlog view and never have a column row.
// - Tasks gain scheduling, assignee, recurrence, numbering, and completion
//   fields. Labels stay as a JSON string array for compatibility; the `labels`
//   collection only owns colours and per-owner definitions.
// - Comments can target tasks. Relations and activity are separate collections
//   so a task graph never overloads the comments table.
//
// Existing boards get columns that match their current four statuses, and every
// existing task is numbered. New boards are seeded by
// `pb_hooks/boards/seed_columns.js`.

const BOARD_ACCESS =
  "(board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))"

const BOARD_OWNER = "@request.auth.id != '' && board.author = @request.auth.id"
const BOARD_READ = `@request.auth.id != '' && ${BOARD_ACCESS}`
const TASK_RELATION_READ = `@request.auth.id != '' && (source.board.author = @request.auth.id || source.board.shares_via_board.user ?= @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.user ?= @request.auth.id))`

const DEFAULT_COLUMNS = [
  { slug: "backlog", name: "Backlog", icon: "inbox", color: "muted", position: 0, final: false },
  { slug: "next", name: "Next up", icon: "queue", color: "warning", position: 1, final: false },
  { slug: "progress", name: "In progress", icon: "bolt", color: "signal", position: 2, final: false },
  { slug: "done", name: "Done", icon: "check", color: "success", position: 3, final: true },
]

const LABEL_COLORS = [
  "stone", "slate", "lavender", "sage", "forest", "amber", "terracotta",
  "rose", "crimson", "ocean", "sky", "lagoon", "orchid",
]

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

function hasIndex(collection, name) {
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) !== -1) return true
  }
  return false
}

function indexesWithout(collection, name) {
  const next = []
  const indexes = collection.indexes || []
  for (let i = 0; i < indexes.length; i++) {
    if (String(indexes[i]).indexOf(name) === -1) next.push(String(indexes[i]))
  }
  return next
}

function addFieldIfMissing(app, collection, field) {
  if (!hasField(collection, field.name)) {
    collection.fields.add(field)
    app.save(collection)
  }
}

function addRelation(collection, name, collectionId, required, cascade, maxSelect) {
  collection.fields.add(
    new RelationField({
      name: name,
      required: required === true,
      collectionId: collectionId,
      cascadeDelete: cascade === true,
      maxSelect: maxSelect || 1,
    })
  )
}

function ensureBoardColumns(app, boards) {
  let columns = findCollection(app, "board_columns")
  if (columns) {
    const position = columns.fields.getByName("position")
    if (position && position.required) {
      position.required = false
      app.save(columns)
    }
    return columns
  }

  columns = new Collection({
    name: "board_columns",
    type: "base",
    listRule: BOARD_READ,
    viewRule: BOARD_READ,
    createRule: BOARD_OWNER,
    updateRule: BOARD_OWNER,
    deleteRule: BOARD_OWNER,
    indexes: [
      "CREATE UNIQUE INDEX `idx_board_columns_board_slug` ON `board_columns` (`board`, `slug`)",
      "CREATE INDEX `idx_board_columns_board_position` ON `board_columns` (`board`, `position`)",
    ],
  })
  addRelation(columns, "board", boards.id, true, true, 1)
  columns.fields.add(new TextField({ name: "name", required: true, max: 80 }))
  columns.fields.add(new TextField({ name: "slug", required: true, max: 60 }))
  // PocketBase treats a required number as non-zero, so position 0 uses an
  // optional field and is always written by the seeder and column manager.
  columns.fields.add(new NumberField({ name: "position", required: false, min: 0 }))
  columns.fields.add(new TextField({ name: "icon", max: 40 }))
  columns.fields.add(new TextField({ name: "color", max: 20 }))
  columns.fields.add(new BoolField({ name: "is_final" }))
  columns.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  columns.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(columns)
  return columns
}

function ensureLabels(app, users) {
  let labels = findCollection(app, "labels")
  if (labels) return labels

  labels = new Collection({
    name: "labels",
    type: "base",
    listRule: "@request.auth.id != '' && author = @request.auth.id",
    viewRule: "@request.auth.id != '' && author = @request.auth.id",
    createRule: "@request.auth.id != '' && author = @request.auth.id",
    updateRule: "@request.auth.id != '' && author = @request.auth.id",
    deleteRule: "@request.auth.id != '' && author = @request.auth.id",
    indexes: [
      "CREATE UNIQUE INDEX `idx_labels_author_name` ON `labels` (`author`, `name`)",
    ],
  })
  addRelation(labels, "author", users.id, true, true, 1)
  labels.fields.add(new TextField({ name: "name", required: true, max: 40 }))
  labels.fields.add(new TextField({ name: "color", required: true, max: 20 }))
  labels.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  labels.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(labels)
  return labels
}

function ensureTaskRelations(app, tasks) {
  let relations = findCollection(app, "task_relations")
  if (relations) return relations

  relations = new Collection({
    name: "task_relations",
    type: "base",
    listRule: TASK_RELATION_READ,
    viewRule: TASK_RELATION_READ,
    createRule: "@request.auth.id != '' && source.board.author = @request.auth.id",
    updateRule: "@request.auth.id != '' && source.board.author = @request.auth.id",
    deleteRule: "@request.auth.id != '' && source.board.author = @request.auth.id",
    indexes: [
      "CREATE UNIQUE INDEX `idx_task_relations_source_target_type` ON `task_relations` (`source`, `target`, `type`)",
      "CREATE INDEX `idx_task_relations_target` ON `task_relations` (`target`)",
    ],
  })
  addRelation(relations, "source", tasks.id, true, true, 1)
  addRelation(relations, "target", tasks.id, true, true, 1)
  relations.fields.add(
    new SelectField({
      name: "type",
      required: true,
      maxSelect: 1,
      values: ["subtask", "blocks", "related"],
    })
  )
  relations.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  relations.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(relations)
  return relations
}

function ensureTaskActivity(app, tasks, boards, users) {
  let activity = findCollection(app, "task_activity")
  if (activity) return activity

  activity = new Collection({
    name: "task_activity",
    type: "base",
    listRule: BOARD_READ,
    viewRule: BOARD_READ,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX `idx_task_activity_task_created` ON `task_activity` (`task`, `created`)",
      "CREATE INDEX `idx_task_activity_board_created` ON `task_activity` (`board`, `created`)",
    ],
  })
  addRelation(activity, "task", tasks.id, true, true, 1)
  addRelation(activity, "board", boards.id, true, true, 1)
  addRelation(activity, "actor", users.id, false, false, 1)
  activity.fields.add(new TextField({ name: "type", required: true, max: 40 }))
  activity.fields.add(new JSONField({ name: "data" }))
  activity.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  app.save(activity)
  return activity
}

function convertTaskStatusToText(app) {
  let tasks = app.findCollectionByNameOrId("tasks")
  const status = tasks.fields.getByName("status")
  if (!status || status.type === "text") return

  // Keep the old column's data while PocketBase rebuilds the table around the
  // new field definition.
  tasks.indexes = indexesWithout(tasks, "idx_tasks_board_status_order")
  if (!hasField(tasks, "status_text")) {
    tasks.fields.add(new TextField({ name: "status_text" }))
  }
  app.save(tasks)
  app.db().newQuery("UPDATE tasks SET status_text = status").execute()

  tasks = app.findCollectionByNameOrId("tasks")
  tasks.fields.removeByName("status")
  app.save(tasks)

  tasks = app.findCollectionByNameOrId("tasks")
  tasks.fields.add(new TextField({ name: "status", required: true, max: 60 }))
  app.save(tasks)
  app.db().newQuery("UPDATE tasks SET status = COALESCE(NULLIF(status_text, ''), 'backlog')").execute()

  tasks = app.findCollectionByNameOrId("tasks")
  tasks.fields.removeByName("status_text")
  tasks.indexes = indexesWithout(tasks, "idx_tasks_board_status_order").concat([
    "CREATE INDEX `idx_tasks_board_status_order` ON `tasks` (`board`, `status`, `board_order`)",
  ])
  app.save(tasks)
}

function ensureTaskFields(app, users) {
  let tasks = app.findCollectionByNameOrId("tasks")

  addFieldIfMissing(
    app,
    tasks,
    new RelationField({
      name: "assignee",
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1,
    })
  )

  tasks = app.findCollectionByNameOrId("tasks")
  addFieldIfMissing(app, tasks, new DateField({ name: "start_date" }))
  tasks = app.findCollectionByNameOrId("tasks")
  addFieldIfMissing(app, tasks, new DateField({ name: "completed_at" }))
  tasks = app.findCollectionByNameOrId("tasks")
  addFieldIfMissing(app, tasks, new JSONField({ name: "recurrence" }))
  tasks = app.findCollectionByNameOrId("tasks")
  addFieldIfMissing(app, tasks, new NumberField({ name: "task_number", required: false, min: 0 }))

  tasks = app.findCollectionByNameOrId("tasks")
  if (!hasIndex(tasks, "idx_tasks_board_number")) {
    tasks.indexes = indexesWithout(tasks, "idx_tasks_board_number").concat([
      "CREATE UNIQUE INDEX `idx_tasks_board_number` ON `tasks` (`board`, `task_number`) WHERE `task_number` > 0",
    ])
    app.save(tasks)
  }
  if (!hasIndex(tasks, "idx_tasks_assignee")) {
    tasks = app.findCollectionByNameOrId("tasks")
    tasks.indexes = indexesWithout(tasks, "idx_tasks_assignee").concat([
      "CREATE INDEX `idx_tasks_assignee` ON `tasks` (`assignee`)",
    ])
    app.save(tasks)
  }
}

function ensureBoardFields(app) {
  let boards = app.findCollectionByNameOrId("boards")
  addFieldIfMissing(app, boards, new TextField({ name: "icon", max: 40 }))
  boards = app.findCollectionByNameOrId("boards")
  addFieldIfMissing(app, boards, new NumberField({ name: "task_counter", required: false, min: 0 }))
}

function ensureCommentTaskField(app, tasks) {
  let comments = findCollection(app, "comments")
  if (!comments) return
  if (!hasField(comments, "task")) {
    addRelation(comments, "task", tasks.id, false, true, 1)
    app.save(comments)
  }
  comments = app.findCollectionByNameOrId("comments")
  if (!hasIndex(comments, "idx_comments_task_created")) {
    comments.indexes = indexesWithout(comments, "idx_comments_task_created").concat([
      "CREATE INDEX `idx_comments_task_created` ON `comments` (`task`, `created`)",
    ])
    app.save(comments)
  }
}

function columnForSlug(slug) {
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    if (DEFAULT_COLUMNS[i].slug === slug) return DEFAULT_COLUMNS[i]
  }
  return null
}

function seedColumnsForBoard(app, columns, board) {
  const existing = app.findRecordsByFilter(
    "board_columns",
    "board = {:board}",
    "+position",
    0,
    0,
    { board: board.id }
  )
  if (existing.length > 0) return

  const tasks = app.findRecordsByFilter(
    "tasks",
    "board = {:board}",
    "+created",
    0,
    0,
    { board: board.id }
  )
  const seen = {}
  const statuses = []
  // Every board starts with the same four lanes so an empty or partial board
  // still has a complete workflow. Extra statuses follow in task order.
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
    const slug = DEFAULT_COLUMNS[i].slug
    seen[slug] = true
    statuses.push(slug)
  }
  for (let i = 0; i < tasks.length; i++) {
    const status = String(tasks[i].get("status") || "").trim()
    if (!status || seen[status]) continue
    seen[status] = true
    statuses.push(status)
  }

  for (let i = 0; i < statuses.length; i++) {
    const slug = statuses[i]
    const preset = columnForSlug(slug)
    const record = new Record(columns)
    record.set("board", board.id)
    record.set("slug", slug)
    record.set("name", preset ? preset.name : slug.replace(/[-_]/g, " ").replace(/^./, function (c) { return c.toUpperCase() }))
    record.set("position", i)
    record.set("icon", preset ? preset.icon : "dot")
    record.set("color", preset ? preset.color : "muted")
    record.set("is_final", preset ? preset.final : slug === "done")
    app.save(record)
  }
}

function seedColumns(app, columns) {
  const boards = app.findRecordsByFilter("boards", "", "+created", 0, 0)
  for (let i = 0; i < boards.length; i++) {
    seedColumnsForBoard(app, columns, boards[i])
  }
}

function seedLabels(app, labels) {
  const tasks = app.findRecordsByFilter("tasks", "", "+created", 0, 0)
  const cache = {}
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    let list = []
    try {
      list = JSON.parse(String(task.get("labels") || "[]"))
    } catch (_) {
      list = []
    }
    if (!Array.isArray(list) || list.length === 0) continue

    let boardId = String(task.get("board") || "")
    if (!boardId) continue
    let board
    try {
      board = app.findRecordById("boards", boardId)
    } catch (_) {
      continue
    }
    const author = String(board.get("author") || "")
    if (!author) continue

    for (let j = 0; j < list.length; j++) {
      const name = String(list[j] || "").trim().slice(0, 40)
      if (!name) continue
      const key = author + "|" + name
      if (cache[key]) continue
      try {
        const found = app.findRecordsByFilter(
          "labels",
          "author = {:author} && name = {:name}",
          "",
          1,
          0,
          { author: author, name: name }
        )
        if (found.length > 0) {
          cache[key] = true
          continue
        }
      } catch (_) {
        // Collection may not be ready on a retry; fall through.
      }
      const record = new Record(labels)
      record.set("author", author)
      record.set("name", name)
      record.set("color", LABEL_COLORS[(i + j) % LABEL_COLORS.length])
      app.save(record)
      cache[key] = true
    }
  }
}

function seedTaskNumbers(app, boards) {
  const allBoards = app.findRecordsByFilter("boards", "", "+created", 0, 0)
  for (let i = 0; i < allBoards.length; i++) {
    const board = allBoards[i]
    const tasks = app.findRecordsByFilter(
      "tasks",
      "board = {:board}",
      "+created",
      0,
      0,
      { board: board.id }
    )
    let counter = Number(board.get("task_counter") || 0)
    for (let j = 0; j < tasks.length; j++) {
      const task = tasks[j]
      if (Number(task.get("task_number") || 0) > 0) {
        counter = Math.max(counter, Number(task.get("task_number") || 0))
        continue
      }
      counter += 1
      task.set("task_number", counter)
      app.save(task)
    }
    if (Number(board.get("task_counter") || 0) !== counter) {
      board.set("task_counter", counter)
      app.save(board)
    }
  }
}

function backfillCompletion(app) {
  const tasks = app.findRecordsByFilter("tasks", "status = 'done'", "", 0, 0)
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    if (String(task.get("completed_at") || "")) continue
    const stamp = String(task.get("updated") || task.get("created") || "")
    if (stamp) {
      task.set("completed_at", stamp)
      app.save(task)
    }
  }
}

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    const boards = app.findCollectionByNameOrId("boards")
    const tasks = app.findCollectionByNameOrId("tasks")

    ensureBoardFields(app)
    convertTaskStatusToText(app)
    ensureTaskFields(app, users)

    const columns = ensureBoardColumns(app, boards)
    const labels = ensureLabels(app, users)
    ensureTaskRelations(app, tasks)
    ensureTaskActivity(app, tasks, boards, users)
    ensureCommentTaskField(app, tasks)

    seedColumns(app, columns)
    seedLabels(app, labels)
    seedTaskNumbers(app, boards)
    backfillCompletion(app)

    return null
  },
  (app) => {
    const boards = findCollection(app, "boards")
    const tasks = findCollection(app, "tasks")

    if (tasks) {
      const status = tasks.fields.getByName("status")
      if (status && status.type === "text") {
        tasks.indexes = indexesWithout(tasks, "idx_tasks_board_status_order")
        tasks.indexes = indexesWithout(tasks, "idx_tasks_board_number")
        tasks.indexes = indexesWithout(tasks, "idx_tasks_assignee")
        if (!hasField(tasks, "status_text")) {
          tasks.fields.add(new TextField({ name: "status_text" }))
        }
        app.save(tasks)
        app.db().newQuery("UPDATE tasks SET status_text = status").execute()

        const current = app.findCollectionByNameOrId("tasks")
        current.fields.removeByName("status")
        app.save(current)

        const next = app.findCollectionByNameOrId("tasks")
        next.fields.add(
          new SelectField({
            name: "status",
            required: true,
            maxSelect: 1,
            values: ["backlog", "next", "progress", "done"],
          })
        )
        app.save(next)
        app.db().newQuery(
          "UPDATE tasks SET status = CASE WHEN status_text IN ('backlog','next','progress','done') THEN status_text ELSE 'backlog' END"
        ).execute()

        const final = app.findCollectionByNameOrId("tasks")
        final.fields.removeByName("status_text")
        for (const name of ["assignee", "start_date", "completed_at", "recurrence", "task_number"]) {
          if (hasField(final, name)) final.fields.removeByName(name)
        }
        final.indexes = indexesWithout(final, "idx_tasks_board_status_order").concat([
          "CREATE INDEX `idx_tasks_board_status_order` ON `tasks` (`board`, `status`, `board_order`)",
        ])
        app.save(final)
      }
    }

    if (boards) {
      for (const name of ["icon", "task_counter"]) {
        if (hasField(boards, name)) boards.fields.removeByName(name)
      }
      app.save(boards)
    }

    const comments = findCollection(app, "comments")
    if (comments && hasField(comments, "task")) {
      comments.fields.removeByName("task")
      app.save(comments)
    }

    for (const name of ["task_activity", "task_relations", "labels", "board_columns"]) {
      const collection = findCollection(app, name)
      if (collection) app.delete(collection)
    }

    return null
  }
)
