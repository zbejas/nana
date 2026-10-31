/// <reference path="../../pb_data/types.d.ts" />

// Permission enforcement for the broadened sharing rules in migration 0023.
//
// PocketBase rules answer "can this caller reach the record at all". The
// guards here answer "what may this caller change", including owner-only
// fields that the record-level rule cannot distinguish (folder, privacy,
// public-share fields, archive state, board moves, and task numbers).
//
// Every callback must require this module inside the callback.

const IGNORED_FIELDS = {
  id: true,
  created: true,
  updated: true,
  collectionId: true,
  collectionName: true,
}

const DOCUMENT_EDIT_FIELDS = {
  title: true,
  slug: true,
  content: true,
  attachments: true,
  tags: true,
  // Server-managed edit metadata. The revision guard validates the submitted
  // revision and stamps the actor before this guard runs; a grantee must not be
  // rejected for fields the hooks themselves just changed.
  revision: true,
  last_edited_by: true,
  last_edit_source: true,
}

const FOLDER_EDIT_FIELDS = {
  name: true,
  color: true,
}

const TASK_EDIT_FIELDS = {
  title: true,
  description: true,
  status: true,
  priority: true,
  due_date: true,
  board_order: true,
  labels: true,
  assignee: true,
  start_date: true,
  recurrence: true,
  completed_at: true,
  document: true,
}

function valueKey(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch (_) {
      return String(value)
    }
  }
  return String(value)
}

function fieldNames(record) {
  const seen = {}
  try {
    const names = record.collection().fields.fieldNames()
    for (let i = 0; i < names.length; i++) seen[names[i]] = true
  } catch (_) {}
  try {
    const data = record.fieldsData() || {}
    for (const name in data) seen[name] = true
  } catch (_) {}
  return Object.keys(seen)
}

function changedFields(record) {
  const original = record.original()
  if (!original || !original.id) return []

  const changed = []
  const names = fieldNames(record)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (IGNORED_FIELDS[name]) continue
    if (valueKey(record.get(name)) !== valueKey(original.get(name))) {
      changed.push(name)
    }
  }
  return changed
}

function assertOnlyFieldsChanged(record, allowed) {
  const changed = changedFields(record)
  for (let i = 0; i < changed.length; i++) {
    const name = changed[i]
    if (allowed[name]) continue
    throw new ForbiddenError(`You cannot change ${name} on this record`)
  }
}

function resolveAccess(targetType, targetId, authId) {
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const resolved = access.effectiveAccess(targetType, targetId, authId)
  if (!resolved) {
    throw new ForbiddenError("You do not have access to this record")
  }
  return resolved
}

function loadBoard(boardId) {
  if (!boardId) throw new BadRequestError("A task must belong to a board")
  try {
    return $app.findRecordById("boards", boardId)
  } catch (_) {
    throw new BadRequestError("Board not found")
  }
}

function assertBoardEditable(board, authId) {
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const resolved = access.effectiveAccess("board", board.id, authId)
  if (!resolved) throw new ForbiddenError("You do not have access to this board")
  if (resolved.level < 3) {
    throw new ForbiddenError("You can view or comment on this board but not edit its tasks")
  }
  if (board.getBool("archived")) {
    throw new BadRequestError("Boards in trash cannot be changed")
  }
  return resolved
}

function checkDocumentUpdate(record, authId) {
  const resolved = resolveAccess("document", record.id, authId)
  if (resolved.role === "owner") return
  if (resolved.level < 3) {
    throw new ForbiddenError("You can view or comment on this note but not edit it")
  }
  assertOnlyFieldsChanged(record, DOCUMENT_EDIT_FIELDS)
}

function checkFolderUpdate(record, authId) {
  const resolved = resolveAccess("folder", record.id, authId)
  if (resolved.role === "owner") return
  if (resolved.level < 3) {
    throw new ForbiddenError("You can view a shared folder but not change it")
  }
  assertOnlyFieldsChanged(record, FOLDER_EDIT_FIELDS)
}

function checkBoardUpdate(record, authId) {
  const resolved = resolveAccess("board", record.id, authId)
  if (resolved.role === "owner") return
  // Edit grantees may change tasks, not board settings, workflow columns, or
  // archive state. Structural fields (folder, privacy, public link) are never
  // writable by a grantee.
  throw new ForbiddenError("Only the owner can change board settings")
}

function checkTaskCreate(record, authId, submittedBody) {
  const board = loadBoard(String(record.get("board") || ""))
  assertBoardEditable(board, authId)
  if (Number(submittedBody && submittedBody.task_number || 0) > 0) {
    throw new BadRequestError("Task numbers are assigned automatically")
  }
}

function checkTaskUpdate(record, authId) {
  const original = record.original()
  if (!original || !original.id) return

  const boardId = String(record.get("board") || original.get("board") || "")
  const board = loadBoard(boardId)
  const resolved = assertBoardEditable(board, authId)

  const beforeBoard = String(original.get("board") || "")
  const afterBoard = String(record.get("board") || "")
  if (beforeBoard !== afterBoard) {
    throw new BadRequestError("A task cannot move to another board")
  }

  // Task numbers are server-assigned. Owners may not rewrite them either;
  // legacy/import writes use a superuser token, which bypasses this guard.
  if (valueKey(record.get("task_number")) !== valueKey(original.get("task_number"))) {
    throw new BadRequestError("Task numbers are assigned automatically")
  }

  if (resolved.role === "owner") return
  assertOnlyFieldsChanged(record, TASK_EDIT_FIELDS)
}

function checkTaskDelete(record, authId) {
  const board = loadBoard(String(record.get("board") || ""))
  const resolved = require(`${__hooks}/sharing/access_helpers.js`).effectiveAccess(
    "board",
    board.id,
    authId
  )
  if (!resolved) throw new ForbiddenError("You do not have access to this board")
  if (resolved.role === "owner") return
  if (resolved.level < 3) {
    throw new ForbiddenError("You can view or comment on this board but not delete tasks")
  }
  if (board.getBool("archived")) {
    throw new BadRequestError("Boards in trash cannot be changed")
  }
}

module.exports = {
  changedFields,
  checkDocumentUpdate,
  checkFolderUpdate,
  checkBoardUpdate,
  checkTaskCreate,
  checkTaskUpdate,
  checkTaskDelete,
}
