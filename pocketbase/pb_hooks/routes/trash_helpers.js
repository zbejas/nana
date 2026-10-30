/// <reference path="../../pb_data/types.d.ts" />

// Shared soft-delete helpers for documents and folders. Trash is a state, not
// a second copy: records keep their id, attachments, and relations while
// `deleted_at` is set, and permanently deleting a folder relies on the
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

/**
 * Revoke materialized grants before a trash transition. Trash routes save
 * through `$app`, so they cannot use the request-hook transaction that makes
 * privacy changes atomic. Clearing first means a failed rebuild under-grants
 * instead of leaving access behind.
 */
function clearSharing(targets) {
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  for (const target of targets || []) {
    if (!target || !target.type || !target.id) continue
    access.clearResourceGrants(target.type, target.id)
  }
}

/**
 * Re-evaluate sharing after a trash transition. The sharing helper is required
 * lazily because this module is loaded by route files and helper bindings do
 * not survive hook invocations. Failures are queued for the repair cron.
 */
function syncSharing(targets) {
  const repair = require(`${__hooks}/sharing/repair_helpers.js`)
  for (const target of targets || []) {
    if (!target || !target.type || !target.id) continue
    repair.safeSync(target.type, target.id, $app, "trash_transition")
  }
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

/** Board ids currently placed in any of the given folders. */
function collectBoardIdsInFolders(folderIds) {
  const ids = []
  const seen = {}
  for (const folderId of folderIds || []) {
    const boards = $app.findRecordsByFilter(
      "boards",
      `folder = "${folderId}"`,
      ""
    )
    for (const board of boards) {
      if (seen[board.id]) continue
      seen[board.id] = true
      ids.push(board.id)
    }
  }
  return ids
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

  const targets = [{ type: "document", id: document.id }]
  clearSharing(targets)
  markDeleted(document, userId, nowIso())
  syncSharing(targets)
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

  const targets = [{ type: "document", id: document.id }]
  clearSharing(targets)
  markRestored(document)
  syncSharing(targets)
  return {
    documentId: document.id,
    folderId: document.getString("folder") || null,
  }
}

/** Permanently delete an already-trashed document. */
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

  // Collect every affected record before mutating so grants can be cleared
  // first. A failed rebuild after the trash transition then under-grants.
  for (const id of folderIds) {
    const documents = $app.findRecordsByFilter(
      "documents",
      `folder = "${id}" && deleted_at = ""`,
      ""
    )
    for (const document of documents) {
      documentIds.push(document.id)
    }
  }
  const boardIds = collectBoardIdsInFolders(folderIds)

  const targets = []
  for (const id of folderIds) targets.push({ type: "folder", id })
  for (const id of documentIds) targets.push({ type: "document", id })
  for (const id of boardIds) targets.push({ type: "board", id })
  clearSharing(targets)

  for (const node of tree) {
    markDeleted(node, userId, deletedAt)
  }

  for (const id of documentIds) {
    const document = $app.findRecordById("documents", id)
    markDeleted(document, userId, deletedAt)
  }

  const movedBoardIds = rehomeBoardsFromFolderIds(folderIds)
  syncSharing(targets)

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

  const restoredDocuments = []
  for (const node of tree) {
    const documents = $app.findRecordsByFilter(
      "documents",
      `folder = "${node.id}" && deleted_at != ""`,
      ""
    )
    for (const document of documents) {
      restoredDocuments.push(document)
    }
  }

  const targets = tree
    .map((node) => ({ type: "folder", id: node.id }))
    .concat(restoredDocuments.map((document) => ({ type: "document", id: document.id })))
  // Never let a stale grant from a failed trash rebuild surface when a record
  // becomes live again. The post-restore sync adds back only valid inheritance.
  clearSharing(targets)

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

  const restoredDocumentIds = []
  for (const document of restoredDocuments) {
    markRestored(document)
    restoredDocumentIds.push(document.id)
  }

  syncSharing(targets)

  return { folderId: root.id, restoredDocumentIds }
}

/** Permanently delete a trashed folder subtree through relation cascades. */
function permanentlyDeleteFolderTree(folderId, userId) {
  const root = $app.findRecordById("folders", folderId)
  assertOwned(root, userId, "Folder")
  assertInTrash(root, "Folder")

  const tree = collectFolderTree(root)
  const folderIds = tree.map((node) => node.id)
  const boardTargets = collectBoardIdsInFolders(folderIds).map((id) => ({ type: "board", id }))
  clearSharing(boardTargets)

  const movedBoardIds = rehomeBoardsFromFolderIds(folderIds)
  syncSharing(movedBoardIds.map((id) => ({ type: "board", id })))

  // Cascades delete child folders and documents. Clear optional task links
  // first because tasks deliberately do not cascade.
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
  syncSharing,
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
