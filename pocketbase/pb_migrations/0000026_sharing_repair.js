/// <reference path="../pb_data/types.d.ts" />

// Sharing repair.
//
// 0023 added `shares`, `access_grants`, and the shared-read rules, but the
// grant materializer was never registered and the rules trusted every direct
// share. This migration:
//
// - removes direct shares that target a private/trashed record or a descendant
//   of a private/trashed folder (private means not shareable with people);
// - rebuilds every inherited `access_grants` row from the remaining folder
//   shares;
// - makes every new kanban collection use the same privacy-safe, grant-only
//   model as documents/folders/boards/tasks;
// - narrows write rules to the owner or an `edit` grant. Request guards still
//   enforce owner-only fields; the rule is the second line of defence when a
//   hook is missing.
//
// It is idempotent: grants are fully derived, and a second run recomputes the
// same rows. `down()` rebuilds the derived grants before restoring the 0023
// rules so inherited folder access survives the rollback. Revoked invalid
// shares are not restored; they were never valid under the privacy contract.

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
// Board settings, sharing, privacy, archive state, and folder are owner-only.
const BOARD_SHARED_WRITE =
  `${AUTH} && author = @request.auth.id`
const TASK_SHARED_READ =
  `${AUTH} && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const TASK_SHARED_WRITE =
  `${AUTH} && board.archived = false && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.permission ?= 'edit'))`
// Deleting a task is allowed on archived boards (cleanup stays possible), and
// follows the same owner-or-edit grant rule.
const TASK_SHARED_DELETE =
  `${AUTH} && (board.author = @request.auth.id || (board.archived = false && board.is_private = false && board.access_grants_via_board.permission ?= 'edit'))`

const BOARD_COLUMNS_READ =
  `${AUTH} && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const BOARD_COLUMNS_WRITE =
  `${AUTH} && board.author = @request.auth.id`
const TASK_ACTIVITY_READ =
  `${AUTH} && (board.author = @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
// A relation is readable from either endpoint: the target board owner must be
// able to see and remove an inbound edge.
const TASK_RELATION_READ =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.user ?= @request.auth.id) || target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.user ?= @request.auth.id))`
// Writes need edit access to the source and at least read access to the target.
const TASK_RELATION_WRITE =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.permission ?= 'edit')) && (target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.user ?= @request.auth.id))`
// Either side may remove an edge it can edit.
const TASK_RELATION_DELETE =
  `${AUTH} && (source.board.author = @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.permission ?= 'edit') || target.board.author = @request.auth.id || (target.board.is_private = false && target.board.access_grants_via_board.permission ?= 'edit'))`

// Rules as they stood after 0023. Used by down().
const LEGACY_DOCUMENT_SHARED_READ =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || shares_via_document.user ?= @request.auth.id || (is_private = false && access_grants_via_document.user ?= @request.auth.id))`
const LEGACY_FOLDER_SHARED_READ =
  `${AUTH} && deleted_at = '' && (author = @request.auth.id || shares_via_folder.user ?= @request.auth.id || (is_private = false && access_grants_via_folder.user ?= @request.auth.id))`
const LEGACY_BOARD_SHARED_READ =
  `${AUTH} && (author = @request.auth.id || shares_via_board.user ?= @request.auth.id || (is_private = false && access_grants_via_board.user ?= @request.auth.id))`
const LEGACY_TASK_SHARED_READ =
  `${AUTH} && (board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const LEGACY_TASK_SHARED_WRITE =
  `${AUTH} && board.archived = false && (board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const LEGACY_BOARD_COLUMNS_READ =
  `${AUTH} && (board.author = @request.auth.id || board.shares_via_board.user ?= @request.auth.id || (board.is_private = false && board.access_grants_via_board.user ?= @request.auth.id))`
const LEGACY_TASK_ACTIVITY_READ = LEGACY_BOARD_COLUMNS_READ
const LEGACY_TASK_RELATION_READ =
  `${AUTH} && (source.board.author = @request.auth.id || source.board.shares_via_board.user ?= @request.auth.id || (source.board.is_private = false && source.board.access_grants_via_board.user ?= @request.auth.id))`

const PERMISSION_BY_LEVEL = { 1: "view", 2: "comment", 3: "edit" }
const TARGET_COLLECTIONS = [
  { type: "folder", collection: "folders" },
  { type: "document", collection: "documents" },
  { type: "board", collection: "boards" },
]

function findCollection(app, name) {
  try {
    return app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function isDeleted(record) {
  return Boolean(record && String(record.get("deleted_at") || "") !== "")
}

function isPrivate(record) {
  return Boolean(record && record.getBool("is_private"))
}

function loadFolders(app) {
  const map = {}
  const folders = app.findRecordsByFilter("folders", "", "+created", 0, 0)
  for (let i = 0; i < folders.length; i++) {
    map[folders[i].id] = folders[i]
  }
  return map
}

function folderIsLocked(folderId, folders) {
  let current = folders[folderId]
  let steps = 0
  while (current) {
    if (isDeleted(current) || isPrivate(current)) return true
    const parentId = String(current.get("parent") || "")
    if (!parentId) return false
    const parent = folders[parentId]
    if (!parent) return true
    current = parent
    steps += 1
    if (steps > 1000) return true
  }
  return false
}

function targetIsInvalid(type, record, folders) {
  if (!record) return true
  if ((type === "document" || type === "folder") && isDeleted(record)) return true
  if (isPrivate(record)) return true
  const folderId = type === "folder"
    ? String(record.get("parent") || "")
    : String(record.get("folder") || "")
  return folderId ? folderIsLocked(folderId, folders) : false
}

function targetInfo(share) {
  for (const type of ["document", "folder", "board"]) {
    const id = String(share.get(type) || "")
    if (id) return { type, id, field: type }
  }
  return null
}

function loadShares(app) {
  try {
    return app.findRecordsByFilter("shares", "", "+created", 0, 0)
  } catch (_) {
    return []
  }
}

function mergeLevel(map, userId, level) {
  if (!userId || level <= 0) return
  if (level > (map[userId] || 0)) map[userId] = level
}

function ancestorLevels(type, record, folders, sharesByFolder) {
  const levels = {}
  let folderId = type === "folder"
    ? String(record.get("parent") || "")
    : String(record.get("folder") || "")
  let steps = 0

  while (folderId) {
    const folder = folders[folderId]
    if (!folder || isDeleted(folder) || isPrivate(folder)) break

    const shares = sharesByFolder[folderId] || []
    for (let i = 0; i < shares.length; i++) {
      mergeLevel(levels, String(shares[i].get("user") || ""), Number(shares[i].get("level") || 0))
    }

    folderId = String(folder.get("parent") || "")
    steps += 1
    if (steps > 1000) break
  }

  return levels
}

function clearGrants(app) {
  const grants = findCollection(app, "access_grants")
  if (!grants) return
  const records = app.findRecordsByFilter("access_grants", "", "", 0, 0)
  for (let i = 0; i < records.length; i++) {
    try {
      app.delete(records[i])
    } catch (_) {}
  }
}

function rebuildGrants(app) {
  const grants = findCollection(app, "access_grants")
  if (!grants) return

  const folders = loadFolders(app)
  const allShares = loadShares(app)
  const sharesByFolder = {}
  const directLevels = {}

  for (let i = 0; i < allShares.length; i++) {
    const share = allShares[i]
    const info = targetInfo(share)
    if (!info) continue
    let target = null
    try {
      target = app.findRecordById(
        info.type === "document" ? "documents" : info.type === "folder" ? "folders" : "boards",
        info.id
      )
    } catch (_) {
      target = null
    }
    if (!target || targetIsInvalid(info.type, target, folders)) {
      try {
        app.delete(share)
      } catch (_) {}
      continue
    }

    const key = `${info.type}:${info.id}`
    const levels = directLevels[key] || {}
    mergeLevel(levels, String(share.get("user") || ""), Number(share.get("level") || 0))
    directLevels[key] = levels

    if (info.type === "folder") {
      const bucket = sharesByFolder[info.id] || []
      bucket.push(share)
      sharesByFolder[info.id] = bucket
    }
  }

  clearGrants(app)

  for (const target of TARGET_COLLECTIONS) {
    const records = app.findRecordsByFilter(target.collection, "", "+created", 0, 0)
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (targetIsInvalid(target.type, record, folders)) continue

      const levels = ancestorLevels(target.type, record, folders, sharesByFolder)
      const direct = directLevels[`${target.type}:${record.id}`] || {}
      const directUsers = Object.keys(direct)
      for (let d = 0; d < directUsers.length; d++) {
        mergeLevel(levels, directUsers[d], direct[directUsers[d]])
      }

      const author = String(record.get("author") || "")
      const users = Object.keys(levels)
      for (let j = 0; j < users.length; j++) {
        const userId = users[j]
        const level = levels[userId]
        if (!userId || userId === author || level <= 0) continue

        const grant = new Record(grants)
        grant.set(target.type, record.id)
        grant.set("user", userId)
        grant.set("permission", PERMISSION_BY_LEVEL[level] || "view")
        grant.set("level", level)
        app.save(grant)
      }
    }
  }
}

function applyRules(app, rules) {
  const documents = findCollection(app, "documents")
  if (documents) {
    documents.listRule = rules.documentsRead
    documents.viewRule = rules.documentsRead
    documents.updateRule = rules.documentsWrite
    app.save(documents)
  }

  const folders = findCollection(app, "folders")
  if (folders) {
    folders.listRule = rules.foldersRead
    folders.viewRule = rules.foldersRead
    folders.updateRule = rules.foldersWrite
    app.save(folders)
  }

  const boards = findCollection(app, "boards")
  if (boards) {
    boards.listRule = rules.boardsRead
    boards.viewRule = rules.boardsRead
    boards.updateRule = rules.boardsWrite
    app.save(boards)
  }

  const tasks = findCollection(app, "tasks")
  if (tasks) {
    tasks.listRule = rules.tasksRead
    tasks.viewRule = rules.tasksRead
    tasks.deleteRule = rules.tasksDelete
    tasks.createRule = rules.tasksWrite
    tasks.updateRule = rules.tasksWrite
    app.save(tasks)
  }

  const columns = findCollection(app, "board_columns")
  if (columns) {
    columns.listRule = rules.columnsRead
    columns.viewRule = rules.columnsRead
    columns.updateRule = rules.columnsWrite
    app.save(columns)
  }

  const activity = findCollection(app, "task_activity")
  if (activity) {
    activity.listRule = rules.activityRead
    activity.viewRule = rules.activityRead
    app.save(activity)
  }

  const relations = findCollection(app, "task_relations")
  if (relations) {
    relations.listRule = rules.relationsRead
    relations.viewRule = rules.relationsRead
    relations.createRule = rules.relationsWrite
    relations.updateRule = rules.relationsWrite
    relations.deleteRule = rules.relationsDelete
    app.save(relations)
  }
}

const HARDENED_RULES = {
  documentsRead: DOCUMENT_SHARED_READ,
  documentsWrite: DOCUMENT_SHARED_WRITE,
  foldersRead: FOLDER_SHARED_READ,
  foldersWrite: FOLDER_SHARED_WRITE,
  boardsRead: BOARD_SHARED_READ,
  boardsWrite: BOARD_SHARED_WRITE,
  tasksRead: TASK_SHARED_READ,
  tasksWrite: TASK_SHARED_WRITE,
  tasksDelete: TASK_SHARED_DELETE,
  columnsRead: BOARD_COLUMNS_READ,
  columnsWrite: BOARD_COLUMNS_WRITE,
  activityRead: TASK_ACTIVITY_READ,
  relationsRead: TASK_RELATION_READ,
  relationsWrite: TASK_RELATION_WRITE,
  relationsDelete: TASK_RELATION_DELETE,
}

const LEGACY_RULES = {
  documentsRead: LEGACY_DOCUMENT_SHARED_READ,
  documentsWrite: LEGACY_DOCUMENT_SHARED_READ,
  foldersRead: LEGACY_FOLDER_SHARED_READ,
  foldersWrite: LEGACY_FOLDER_SHARED_READ,
  boardsRead: LEGACY_BOARD_SHARED_READ,
  boardsWrite: LEGACY_BOARD_SHARED_READ,
  tasksRead: LEGACY_TASK_SHARED_READ,
  tasksWrite: LEGACY_TASK_SHARED_WRITE,
  tasksDelete: LEGACY_TASK_SHARED_READ,
  columnsRead: LEGACY_BOARD_COLUMNS_READ,
  // 0025 created columns with the owner-only write rule, which is also the
  // hardened rule. The legacy read rule is the only part that changes.
  columnsWrite: BOARD_COLUMNS_WRITE,
  activityRead: LEGACY_TASK_ACTIVITY_READ,
  relationsRead: LEGACY_TASK_RELATION_READ,
  // Restore the 0025 owner-only relation writes.
  relationsWrite: `${AUTH} && source.board.author = @request.auth.id`,
  relationsDelete: `${AUTH} && source.board.author = @request.auth.id`,
}

migrate(
  (app) => {
    if (findCollection(app, "shares") && findCollection(app, "access_grants")) {
      rebuildGrants(app)
    }
    applyRules(app, HARDENED_RULES)
    return null
  },
  (app) => {
    // Rebuild inherited grants while the tracking rows still exist, then hand
    // the read model back to 0023. Direct shares were never deleted by this
    // migration; only invalid ones were pruned.
    if (findCollection(app, "shares") && findCollection(app, "access_grants")) {
      rebuildGrants(app)
    }
    applyRules(app, LEGACY_RULES)
    return null
  }
)
