/// <reference path="../../pb_data/types.d.ts" />

// Shared relation checks for request guards. Functions are loaded by
// require() inside each callback because PocketBase does not keep module-scope
// bindings alive across later hook invocations.

function findRecord(collection, id, label) {
  try {
    return $app.findRecordById(collection, id)
  } catch (_) {
    throw new BadRequestError(`${label} not found.`)
  }
}

function assertOwner(record, authId, label) {
  if (record.getString("author") !== authId) {
    throw new ForbiddenError(`You can only use your own ${label}.`)
  }
}

function assertFolder(id, authId) {
  const folder = findRecord("folders", id, "Folder")
  assertOwner(folder, authId, "folders")
  if (String(folder.getString("deleted_at") || "")) {
    throw new BadRequestError("Folder is in trash.")
  }
  return folder
}

function assertDocument(id, authId) {
  const document = findRecord("documents", id, "Document")
  assertOwner(document, authId, "documents")
  if (String(document.getString("deleted_at") || "")) {
    throw new BadRequestError("Document is in trash.")
  }
  return document
}

/** Author is set on create and can never be reassigned on update. */
function assertAuthorUnchanged(record) {
  const original = record.original()
  if (!original || !original.id) {
    return
  }
  if (record.getString("author") !== original.getString("author")) {
    throw new BadRequestError("Ownership cannot be changed.")
  }
}

/**
 * Relation rules see the stored value, so only a newly set or changed relation
 * needs an ownership check. This also lets a grantee update unrelated fields on
 * a record that lives in the owner's folder.
 */
function relationChanged(record, field) {
  const original = record.original()
  if (!original || !original.id) return true
  return String(record.getString(field) || "") !== String(original.getString(field) || "")
}

function assertFolderRelation(record, field, authId) {
  const id = String(record.getString(field) || "")
  if (!id) {
    return
  }
  assertFolder(id, authId)
}

/** Reject self-parenting and cycles that would detach a folder subtree. */
function assertFolderParent(record, authId) {
  const parentId = String(record.getString("parent") || "")
  if (!parentId) {
    return
  }

  const parent = assertFolder(parentId, authId)
  const currentId = String(record.id || "")
  let cursor = parent
  let steps = 0

  while (cursor) {
    if (currentId && cursor.id === currentId) {
      throw new BadRequestError("A folder cannot contain itself.")
    }
    const nextId = String(cursor.getString("parent") || "")
    if (!nextId) {
      break
    }
    try {
      cursor = $app.findRecordById("folders", nextId)
    } catch (_) {
      break
    }
    steps += 1
    if (steps > 1000) {
      throw new BadRequestError("Folder hierarchy is too deep.")
    }
  }
}

function assertTaskRelations(record, authId) {
  const boardId = String(record.getString("board") || "")
  if (!boardId) {
    throw new BadRequestError("A task must belong to a board.")
  }

  const board = findRecord("boards", boardId, "Board")
  // Task ownership derives from the board, but an edit grantee may also create
  // and update tasks. Resolve the caller's effective board permission instead
  // of requiring authorship; the permission guard enforces the exact level.
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const resolved = access.effectiveAccess("board", board.id, authId)
  if (!resolved || resolved.level < 3) {
    throw new ForbiddenError("You can only change tasks on boards you can edit.")
  }
  if (board.getBool("archived")) {
    throw new BadRequestError("Boards in trash cannot be changed.")
  }

  const documentId = String(record.getString("document") || "")
  if (!documentId) {
    return
  }

  // An existing task may keep a link to a note that was trashed later. Only
  // validate the relation when it is being set or changed.
  const original = record.original()
  const previousId = original && original.id
    ? String(original.getString("document") || "")
    : ""
  if (documentId !== previousId) {
    assertDocument(documentId, authId)
  }
}

function loadTask(id, label) {
  if (!id) throw new BadRequestError(`${label} is required.`)
  let task
  try {
    task = $app.findRecordById("tasks", id)
  } catch (_) {
    throw new BadRequestError(`${label} not found.`)
  }
  const boardId = String(task.getString("board") || "")
  if (!boardId) throw new BadRequestError(`${label} has no board.`)
  let board
  try {
    board = $app.findRecordById("boards", boardId)
  } catch (_) {
    throw new BadRequestError(`${label} board not found.`)
  }
  return { task, board }
}

/**
 * Task relations are directed edges between two tasks. Both tasks must exist
 * and be readable by the caller; the source also needs `edit` access and an
 * active board. Cross-board edges are allowed when both boards are accessible,
 * because they are explicit user-created links rather than implicit membership.
 */
function assertRelationEdge(record, authId) {
  const sourceId = String(record.getString("source") || "")
  const targetId = String(record.getString("target") || "")
  if (!sourceId || !targetId) {
    throw new BadRequestError("A relation needs a source and a target task.")
  }
  if (sourceId === targetId) {
    throw new BadRequestError("A task cannot relate to itself.")
  }

  const source = loadTask(sourceId, "Source task")
  const target = loadTask(targetId, "Target task")
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const sourceAccess = access.effectiveAccess("task", source.task.id, authId)
  const targetAccess = access.effectiveAccess("task", target.task.id, authId)

  if (!sourceAccess || sourceAccess.level < 3) {
    throw new ForbiddenError("You can only change relations on tasks you can edit.")
  }
  if (!targetAccess) {
    throw new ForbiddenError("You cannot relate a task you cannot read.")
  }
  if (source.board.getBool("archived")) {
    throw new BadRequestError("Boards in trash cannot be changed.")
  }
}

/** Either endpoint's editor may remove an edge. */
function assertRelationDelete(record, authId) {
  const sourceId = String(record.getString("source") || "")
  const targetId = String(record.getString("target") || "")
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  const sourceAccess = sourceId ? access.effectiveAccess("task", sourceId, authId) : null
  const targetAccess = targetId ? access.effectiveAccess("task", targetId, authId) : null
  const sourceEdit = Boolean(sourceAccess && sourceAccess.level >= 3)
  const targetEdit = Boolean(targetAccess && targetAccess.level >= 3)
  if (!sourceEdit && !targetEdit) {
    throw new ForbiddenError("You can only remove relations on tasks you can edit.")
  }
}

module.exports = {
  assertOwner,
  assertFolder,
  assertDocument,
  assertAuthorUnchanged,
  relationChanged,
  assertFolderRelation,
  assertFolderParent,
  assertTaskRelations,
  assertRelationEdge,
  assertRelationDelete,
}
