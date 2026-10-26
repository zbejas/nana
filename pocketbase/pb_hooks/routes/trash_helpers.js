/// <reference path="../../pb_data/types.d.ts" />

// Shared soft-delete helpers for documents and folders. Trash is a state, not
// a second copy: records keep their id, attachments, versions, and relations
// while `deleted_at` is set, and permanently deleting a folder relies on the
// relation cascades declared in migration 0000022.

function getAuthUserId(c) {
  const authRecord = c.auth
  if (!authRecord) {
    throw new UnauthorizedError("Authentication required")
  }
  return authRecord.id
}

function assertOwned(record, userId, label) {
  const owner = record.get("author")
  if (owner !== userId) {
    throw new ForbiddenError(`${label} does not belong to the authenticated user`)
  }
}

function parseBody(c) {
  const { parseRequestBody } = require(`${__hooks}/utils.js`)
  return parseRequestBody(c)
}

function nowIso() {
  return new Date().toISOString()
}

function clearPublicShare(record) {
  record.setIfFieldExists("is_public", false)
  record.setIfFieldExists("public_share_token", "")
  record.setIfFieldExists("public_expires_at", "")
}

function markDeleted(record, userId, deletedAt) {
  record.setIfFieldExists("deleted_at", deletedAt || nowIso())
  record.setIfFieldExists("deleted_by", userId)
  clearPublicShare(record)
  $app.save(record)
}

function markRestored(record) {
  record.setIfFieldExists("deleted_at", "")
  record.setIfFieldExists("deleted_by", "")
  $app.save(record)
}

function assertInTrash(record, label) {
  if (!String(record.getString("deleted_at") || "")) {
    throw new BadRequestError(`${label} is not in trash`)
  }
}

/**
 * Boards are archived, never trashed. When a folder leaves the live tree its
 * boards move to the root so the folder relation can never dangle.
 */
function rehomeBoardsFromFolderIds(folderIds) {
  const movedBoardIds = []
  if (!Array.isArray(folderIds) || folderIds.length === 0) {
    return movedBoardIds
  }

  let boardsCollection
  try {
    boardsCollection = $app.findCollectionByNameOrId("boards")
  } catch (_) {
    return movedBoardIds
  }

  if (!boardsCollection.fields.getByName("folder")) {
    return movedBoardIds
  }

  const seenBoardIds = {}
  for (const folderId of folderIds) {
    const id = String(folderId || "")
    if (!id) continue

    const boards = $app.findRecordsByFilter("boards", `folder = "${id}"`, "")
    for (const board of boards) {
      if (seenBoardIds[board.id]) continue
      seenBoardIds[board.id] = true
      board.set("folder", "")
      $app.save(board)
      movedBoardIds.push(board.id)
    }
  }

  return movedBoardIds
}

function collectFolderTree(folderRecord) {
  const result = [folderRecord]
  const children = $app.findRecordsByFilter(
    "folders",
    `parent = "${folderRecord.id}"`,
    "+created"
  )
  for (const child of children) {
    const nested = collectFolderTree(child)
    for (const item of nested) {
      result.push(item)
    }
  }
  return result
}

function clearTaskDocumentLinks(documentId) {
  const tasks = $app.findRecordsByFilter(
    "tasks",
    `document = "${documentId}"`,
    ""
  )
  for (const task of tasks) {
    task.set("document", "")
    $app.save(task)
  }
}

/** Soft-delete a document and its public share. */
function moveDocumentToTrashById(documentId, userId) {
  const document = $app.findRecordById("documents", documentId)
  assertOwned(document, userId, "Document")
  if (String(document.getString("deleted_at") || "")) {
    throw new BadRequestError("Document is already in trash")
  }

  markDeleted(document, userId, nowIso())
  return document
}

/** Restore a document. A document whose folder is still trashed moves to root. */
function restoreDocumentById(documentId, userId) {
  const document = $app.findRecordById("documents", documentId)
  assertOwned(document, userId, "Document")
  assertInTrash(document, "Document")

  const folderId = String(document.getString("folder") || "")
  if (folderId) {
    let folder = null
    try {
      folder = $app.findRecordById("folders", folderId)
    } catch (_) {
      folder = null
    }
    if (!folder || String(folder.getString("deleted_at") || "")) {
      document.set("folder", "")
    }
  }

  markRestored(document)
  return {
    documentId: document.id,
    folderId: document.getString("folder") || null,
  }
}

/** Permanently delete an already-trashed document and its versions. */
function permanentlyDeleteDocumentById(documentId, userId) {
  const document = $app.findRecordById("documents", documentId)
  assertOwned(document, userId, "Document")
  assertInTrash(document, "Document")

  clearTaskDocumentLinks(document.id)
  $app.delete(document)
}

/**
 * Soft-delete a folder subtree, mark its documents deleted, and rehome boards.
 * The tree is collected before any row is saved so parents stay dereferenceable.
 */
function moveFolderToTrash(folderId, userId) {
  const folder = $app.findRecordById("folders", folderId)
  assertOwned(folder, userId, "Folder")
  if (String(folder.getString("deleted_at") || "")) {
    throw new BadRequestError("Folder is already in trash")
  }

  const deletedAt = nowIso()
  const tree = collectFolderTree(folder)
  const folderIds = tree.map((node) => node.id)
  const documentIds = []

  for (const node of tree) {
    markDeleted(node, userId, deletedAt)
  }

  for (const id of folderIds) {
    const documents = $app.findRecordsByFilter(
      "documents",
      `folder = "${id}" && deleted_at = ""`,
      ""
    )
    for (const document of documents) {
      markDeleted(document, userId, deletedAt)
      documentIds.push(document.id)
    }
  }

  const movedBoardIds = rehomeBoardsFromFolderIds(folderIds)
  return { folderId: folder.id, folderIds, documentIds, movedBoardIds }
}

/**
 * Restore a folder subtree and every document trashed with it. A subtree whose
 * parent is still trashed is re-rooted rather than left dangling.
 */
function restoreFolderTree(folderId, userId) {
  const root = $app.findRecordById("folders", folderId)
  assertOwned(root, userId, "Folder")
  assertInTrash(root, "Folder")

  const tree = collectFolderTree(root)
  const folderIdSet = {}
  for (const node of tree) {
    folderIdSet[node.id] = true
  }

  const restoredDocumentIds = []
  for (const node of tree) {
    const parentId = String(node.getString("parent") || "")
    if (parentId && !folderIdSet[parentId]) {
      let parent = null
      try {
        parent = $app.findRecordById("folders", parentId)
      } catch (_) {
        parent = null
      }
      if (!parent || String(parent.getString("deleted_at") || "")) {
        node.set("parent", "")
      }
    }
    markRestored(node)
  }

  for (const node of tree) {
    const documents = $app.findRecordsByFilter(
      "documents",
      `folder = "${node.id}" && deleted_at != ""`,
      ""
    )
    for (const document of documents) {
      markRestored(document)
      restoredDocumentIds.push(document.id)
    }
  }

  return { folderId: root.id, restoredDocumentIds }
}

/** Permanently delete a trashed folder subtree through relation cascades. */
function permanentlyDeleteFolderTree(folderId, userId) {
  const root = $app.findRecordById("folders", folderId)
  assertOwned(root, userId, "Folder")
  assertInTrash(root, "Folder")

  const tree = collectFolderTree(root)
  const folderIds = tree.map((node) => node.id)

  rehomeBoardsFromFolderIds(folderIds)

  // Cascades delete child folders, documents, and versions. Clear optional
  // task links first because tasks deliberately do not cascade.
  for (const id of folderIds) {
    const documents = $app.findRecordsByFilter(
      "documents",
      `folder = "${id}"`,
      ""
    )
    for (const document of documents) {
      clearTaskDocumentLinks(document.id)
    }
  }

  $app.delete(root)
}

module.exports = {
  getAuthUserId,
  assertOwned,
  parseBody,
  nowIso,
  clearPublicShare,
  markDeleted,
  markRestored,
  assertInTrash,
  rehomeBoardsFromFolderIds,
  collectFolderTree,
  moveDocumentToTrashById,
  restoreDocumentById,
  permanentlyDeleteDocumentById,
  moveFolderToTrash,
  restoreFolderTree,
  permanentlyDeleteFolderTree,
}
