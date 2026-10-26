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
  assertOwner(board, authId, "boards")
  if (board.getBool("archived")) {
    throw new BadRequestError("Archived boards cannot be changed.")
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

module.exports = {
  assertOwner,
  assertFolder,
  assertDocument,
  assertAuthorUnchanged,
  assertFolderRelation,
  assertFolderParent,
  assertTaskRelations,
}
