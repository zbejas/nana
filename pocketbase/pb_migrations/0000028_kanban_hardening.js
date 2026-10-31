/// <reference path="../pb_data/types.d.ts" />

// Kanban hardening repair.
//
// 0025 seeded defaults and 0026 tightened sharing, but databases that ran an
// older copy can be left with:
//
// - a board whose create hook failed after the board row was committed, so
//   default columns are missing or only partially present;
// - a column using the reserved virtual slug `planned` or `archived`;
// - a task counter below the highest assigned task number;
// - completion timestamps derived from the wrong column or bumped by the
//   backfill itself;
// - the pre-hardening rules on `board_columns`, `task_activity`, and
//   `task_relations`.
//
// Every step is idempotent. Data repairs are intentionally not reversed by
// down(): re-adding a user-deleted column or renumbering tasks cannot be done
// without losing information. down() only removes the repair queue.

const AUTH = "@request.auth.id != ''"

const DOCUMENT_SHARED_READ =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || (is_private = false && access_grants_via_document.user ?= @request.auth.id))`
const DOCUMENT_SHARED_WRITE =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || (is_private = false && access_grants_via_document.permission ?= 'edit'))`
const FOLDER_SHARED_READ =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || (is_private = false && access_grants_via_folder.user ?= @request.auth.id))`
const FOLDER_SHARED_WRITE =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || (is_private = false && access_grants_via_folder.permission ?= 'edit'))`
const BOARD_SHARED_READ =
  `${AUTH} && (author = @request.auth.id || (is_private = false && access_grants_via_board.user ?= @request.auth.id))`
const BOARD_SHARED_WRITE = `${AUTH} && author = @request.auth.id`
const TASK_SHARED_READ =
  `${AUTH} && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const TASK_SHARED_WRITE =
  `${AUTH} && board.archived = false && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.permission ?= 'edit'))`
const TASK_SHARED_DELETE =
  `${AUTH} && (board.author = @request.auth.id || (board.archived = false && board.is_private = false && board.access_grants_via_board.permission ?= 'edit'))`
const BOARD_COLUMNS_READ =
  `${AUTH} && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const BOARD_COLUMNS_WRITE = `${AUTH} && board.author = @request.auth.id`
const TASK_ACTIVITY_READ = BOARD_COLUMNS_READ
const TASK_RELATION_READ =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.user ?= @request.auth.id) || target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.user ?= @request.auth.id))`
const TASK_RELATION_WRITE =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.permission ?= 'edit')) && (target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.user ?= @request.auth.id))`
const TASK_RELATION_DELETE =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.permission ?= 'edit') || target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.permission ?= 'edit'))`

const DEFAULT_COLUMNS = [
  { slug: "backlog", name: "Backlog", icon: "inbox", color: "muted", position: 0, final: false },
  { slug: "next", name: "Next up", icon: "queue", color: "warning", position: 1, final: false },
  { slug: "progress", name: "In progress", icon: "bolt", color: "signal", position: 2, final: false },
  { slug: "done", name: "Done", icon: "check", color: "success", position: 3, final: true },
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

function applyRules(app) {
  const documents = findCollection(app, "documents")
  if (documents) {
    documents.listRule = DOCUMENT_SHARED_READ
    documents.viewRule = DOCUMENT_SHARED_READ
    documents.updateRule = DOCUMENT_SHARED_WRITE
    app.save(documents)
  }

  const folders = findCollection(app, "folders")
  if (folders) {
    folders.listRule = FOLDER_SHARED_READ
    folders.viewRule = FOLDER_SHARED_READ
    folders.updateRule = FOLDER_SHARED_WRITE
    app.save(folders)
  }

  const boards = findCollection(app, "boards")
  if (boards) {
    boards.listRule = BOARD_SHARED_READ
    boards.viewRule = BOARD_SHARED_READ
    boards.updateRule = BOARD_SHARED_WRITE
    app.save(boards)
  }

  const tasks = findCollection(app, "tasks")
  if (tasks) {
    tasks.listRule = TASK_SHARED_READ
    tasks.viewRule = TASK_SHARED_READ
    tasks.createRule = TASK_SHARED_WRITE
    tasks.updateRule = TASK_SHARED_WRITE
    tasks.deleteRule = TASK_SHARED_DELETE
    app.save(tasks)
  }

  const columns = findCollection(app, "board_columns")
  if (columns) {
    columns.listRule = BOARD_COLUMNS_READ
    columns.viewRule = BOARD_COLUMNS_READ
    columns.updateRule = BOARD_COLUMNS_WRITE
    app.save(columns)
  }

  const activity = findCollection(app, "task_activity")
  if (activity) {
    activity.listRule = TASK_ACTIVITY_READ
    activity.viewRule = TASK_ACTIVITY_READ
    app.save(activity)
  }

  const relations = findCollection(app, "task_relations")
  if (relations) {
    relations.listRule = TASK_RELATION_READ
    relations.viewRule = TASK_RELATION_READ
    relations.createRule = TASK_RELATION_WRITE
    relations.updateRule = TASK_RELATION_WRITE
    relations.deleteRule = TASK_RELATION_DELETE
    app.save(relations)
  }
}

function ensureRepairQueue(app) {
  let collection = findCollection(app, "sharing_repairs")
  if (collection) return collection

  collection = new Collection({
    name: "sharing_repairs",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE UNIQUE INDEX `idx_sharing_repairs_target` ON `sharing_repairs` (`target_type`, `target_id`)",
    ],
  })
  collection.fields.add(new TextField({ name: "target_type", required: true, max: 20 }))
  collection.fields.add(new TextField({ name: "target_id", required: true, max: 64 }))
  collection.fields.add(new TextField({ name: "reason", max: 80 }))
  collection.fields.add(new NumberField({ name: "attempts", required: false, min: 0 }))
  collection.fields.add(new TextField({ name: "last_error", max: 2000 }))
  collection.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
  collection.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  app.save(collection)
  return collection
}

function ensureCommentsIndex(app) {
  let comments = findCollection(app, "comments")
  if (!comments || !hasField(comments, "task")) return
  if (hasIndex(comments, "idx_comments_task_created")) return
  comments.indexes = indexesWithout(comments, "idx_comments_task_created").concat([
    "CREATE INDEX `idx_comments_task_created` ON `comments` (`task`, `created`)",
  ])
  app.save(comments)
}

function uniqueSlug(used, base) {
  let candidate = base
  let suffix = 2
  while (used[candidate]) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function repairReservedSlugs(app, board, columns, used) {
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]
    const slug = String(column.get("slug") || "")
    if (slug !== "planned" && slug !== "archived") continue

    const next = uniqueSlug(used, `${slug}-column`)
    // Keep the tasks that referenced the old row visible on that column.
    app.db()
      .newQuery("UPDATE tasks SET status = {:next} WHERE board = {:board} AND status = {:old}")
      .bind({ next: next, board: board.id, old: slug })
      .execute()
    column.set("slug", next)
    app.save(column)
    used[next] = true
    columns[i] = column
  }
}

function ensureColumnsForBoard(app, columnsCollection, board) {
  const columns = app.findRecordsByFilter(
    "board_columns",
    "board = {:board}",
    "+position",
    0,
    0,
    { board: board.id }
  )

  const used = {}
  const usedPositions = {}
  let nextPosition = 0
  for (let i = 0; i < columns.length; i++) {
    const slug = String(columns[i].get("slug") || "")
    if (slug) used[slug] = true
    const position = Number(columns[i].get("position") || 0)
    usedPositions[position] = true
    nextPosition = Math.max(nextPosition, position + 1)
  }

  repairReservedSlugs(app, board, columns, used)

  const tasks = app.findRecordsByFilter(
    "tasks",
    "board = {:board}",
    "+created",
    0,
    0,
    { board: board.id }
  )
  const statuses = []
  for (let i = 0; i < DEFAULT_COLUMNS.length; i++) statuses.push(DEFAULT_COLUMNS[i].slug)
  for (let i = 0; i < tasks.length; i++) {
    const status = String(tasks[i].get("status") || "").trim()
    if (!status || status === "planned" || status === "archived") continue
    if (statuses.indexOf(status) !== -1) continue
    statuses.push(status)
  }

  for (let i = 0; i < statuses.length; i++) {
    const slug = statuses[i]
    if (used[slug]) continue

    let preset = null
    for (let d = 0; d < DEFAULT_COLUMNS.length; d++) {
      if (DEFAULT_COLUMNS[d].slug === slug) preset = DEFAULT_COLUMNS[d]
    }

    let position = preset ? preset.position : nextPosition
    while (usedPositions[position]) position += 1
    usedPositions[position] = true
    if (position >= nextPosition) nextPosition = position + 1

    const record = new Record(columnsCollection)
    record.set("board", board.id)
    record.set("slug", slug)
    record.set("name", preset ? preset.name : slug.replace(/[-_]/g, " ").replace(/^./, function (c) { return c.toUpperCase() }))
    record.set("position", position)
    record.set("icon", preset ? preset.icon : "dot")
    record.set("color", preset ? preset.color : "muted")
    record.set("is_final", preset ? preset.final : false)
    app.save(record)
    used[slug] = true
  }
}

function repairTaskNumbers(app) {
  const boards = app.findRecordsByFilter("boards", "", "+created", 0, 0)
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i]
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
      const number = Number(tasks[j].get("task_number") || 0)
      if (number > counter) counter = number
    }
    for (let j = 0; j < tasks.length; j++) {
      if (Number(tasks[j].get("task_number") || 0) > 0) continue
      counter += 1
      app.db()
        .newQuery("UPDATE tasks SET task_number = {:number} WHERE id = {:id}")
        .bind({ number: counter, id: tasks[j].id })
        .execute()
    }
    if (Number(board.get("task_counter") || 0) !== counter) {
      app.db()
        .newQuery("UPDATE boards SET task_counter = {:counter} WHERE id = {:id}")
        .bind({ counter: counter, id: board.id })
        .execute()
    }
  }
}

function repairCompletion(app) {
  const boards = app.findRecordsByFilter("boards", "", "+created", 0, 0)
  for (let i = 0; i < boards.length; i++) {
    const board = boards[i]
    const finals = {}
    const columns = app.findRecordsByFilter(
      "board_columns",
      "board = {:board} && is_final = true",
      "",
      0,
      0,
      { board: board.id }
    )
    for (let c = 0; c < columns.length; c++) {
      finals[String(columns[c].get("slug") || "")] = true
    }

    const tasks = app.findRecordsByFilter(
      "tasks",
      "board = {:board}",
      "+created",
      0,
      0,
      { board: board.id }
    )
    for (let t = 0; t < tasks.length; t++) {
      const task = tasks[t]
      const complete = Boolean(finals[String(task.get("status") || "")])
      const current = String(task.get("completed_at") || "")
      if (complete && !current) {
        const stamp = String(task.get("updated") || task.get("created") || "")
        if (!stamp) continue
        app.db()
          .newQuery("UPDATE tasks SET completed_at = {:stamp} WHERE id = {:id}")
          .bind({ stamp: stamp, id: task.id })
          .execute()
      } else if (!complete && current) {
        app.db()
          .newQuery("UPDATE tasks SET completed_at = '' WHERE id = {:id}")
          .bind({ id: task.id })
          .execute()
      }
    }
  }
}

migrate(
  (app) => {
    const boards = app.findRecordsByFilter("boards", "", "+created", 0, 0)
    const columnsCollection = findCollection(app, "board_columns")
    if (columnsCollection) {
      for (let i = 0; i < boards.length; i++) {
        ensureColumnsForBoard(app, columnsCollection, boards[i])
      }
    }

    repairTaskNumbers(app)
    repairCompletion(app)
    ensureCommentsIndex(app)
    ensureRepairQueue(app)
    applyRules(app)
    return null
  },
  (app) => {
    const repairs = findCollection(app, "sharing_repairs")
    if (repairs) app.delete(repairs)
    // Data repairs stay in place; see the header comment.
    return null
  }
)
