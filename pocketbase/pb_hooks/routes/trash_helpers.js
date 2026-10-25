/// <reference path="../../pb_data/types.d.ts" />

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

/**
 * Copy all collection-defined fields from source to target,
 * skipping auto-managed keys (id, created, updated).
 * Fields present in `overrides` are set from the override value instead.
 * Source fields that don't exist on the target collection are silently skipped.
 */
function copyFields(source, target, overrides) {
  const skip = new Set(["id", "created", "updated"])
  const ov = overrides || {}
  const data = source.fieldsData()
  for (const key of Object.keys(data)) {
    if (skip.has(key) || key in ov) continue
    target.setIfFieldExists(key, source.get(key))
  }
  for (const [key, value] of Object.entries(ov)) {
    target.set(key, value)
  }
}

function buildRecordFileKey(record, filename) {
  const baseFilesPath = String(record.baseFilesPath() || "").replace(/\/+$/, "")
  const cleanFilename = String(filename || "").replace(/^\/+/, "")

  if (!baseFilesPath || !cleanFilename) {
    throw new Error("Cannot build file key for record attachment")
  }

  return `${baseFilesPath}/${cleanFilename}`
}

function getFileFieldFilenames(record, fieldName) {
  const value = record.get(fieldName)
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item))
  }

  if (!value) {
    return []
  }

  return [String(value)]
}

// PocketBase file fields store filenames only, so cross-collection moves must reupload the files.
function saveRecordWithClonedAttachments(source, target) {
  const attachments = getFileFieldFilenames(source, "attachments")
  if (!attachments.length) {
    target.set("attachments", [])
    $app.save(target)
    return
  }

  const filesystem = $app.newFilesystem()

  try {
    const clonedFiles = attachments.map((filename) => {
      return filesystem.getReuploadableFile(buildRecordFileKey(source, filename), true)
    })

    target.set("attachments", clonedFiles)
    $app.save(target)
  } finally {
    filesystem.close()
  }
}

function saveTrashDocumentVersion(versionRecord, trashDocumentId, userId, deletedAt, originalDocumentId) {
  const collection = $app.findCollectionByNameOrId("trash_document_versions")
  const trashVersion = new Record(collection)
  copyFields(versionRecord, trashVersion, {
    trash_document: trashDocumentId,
    original_version_id: versionRecord.id,
    original_document_id: originalDocumentId,
    author: userId,
    deleted_at: deletedAt,
    source_created_at: versionRecord.get("source_created_at") || versionRecord.get("created") || null,
    source_version_record: versionRecord.id,
  })
  $app.save(trashVersion)
}

function restoreDocumentVersions(trashDocumentId, activeDocumentId) {
  const versions = $app.findRecordsByFilter(
    "trash_document_versions",
    `trash_document = "${trashDocumentId}"`,
    "+version_number"
  )

  const collection = $app.findCollectionByNameOrId("document_versions")

  for (const trashVersion of versions) {
    const restoredVersion = new Record(collection)
    copyFields(trashVersion, restoredVersion, {
      document: activeDocumentId,
    })
    $app.save(restoredVersion)
    $app.delete(trashVersion)
  }
}

function permanentlyDeleteTrashVersions(trashDocumentId) {
  const versions = $app.findRecordsByFilter(
    "trash_document_versions",
    `trash_document = "${trashDocumentId}"`,
    ""
  )
  for (const version of versions) {
    $app.delete(version)
  }
}

function moveDocumentToTrashById(documentId, userId, options) {
  const document = $app.findRecordById("documents", documentId)
  assertOwned(document, userId, "Document")

  const deletedAt = options?.deletedAt || new Date().toISOString()
  const targetTrashFolderId = options?.targetTrashFolderId || ""

  const trashCollection = $app.findCollectionByNameOrId("trash_documents")
  const trashDocument = new Record(trashCollection)
  copyFields(document, trashDocument, {
    attachments: [],
    author: userId,
    folder: targetTrashFolderId,
    original_document_id: document.id,
    original_folder_id: document.get("folder") || "",
    deleted_by: userId,
    deleted: true,
    deleted_at: deletedAt,
  })
  saveRecordWithClonedAttachments(document, trashDocument)

  const versions = $app.findRecordsByFilter(
    "document_versions",
    `document = "${document.id}"`,
    "+version_number"
  )

  for (const versionRecord of versions) {
    saveTrashDocumentVersion(versionRecord, trashDocument.id, userId, deletedAt, document.id)
    $app.delete(versionRecord)
  }

  // Physically delete the original document (no more soft-delete fallback)
  $app.delete(document)
  return trashDocument
}

/**
 * Boards are archived, not trashed. When a folder leaves the live tree, move
 * its boards to the root so a relation can never orphan them. Returns the ids
 * that were moved.
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

function collectFolderTree(folderRecord, collectionName) {
  const sourceCollection = collectionName || "folders"
  const result = [folderRecord]
  const children = $app.findRecordsByFilter(sourceCollection, `parent = "${folderRecord.id}"`, "+created")
  for (const child of children) {
    const nested = collectFolderTree(child, sourceCollection)
    for (const item of nested) {
      result.push(item)
    }
  }
  return result
}

module.exports = {
  getAuthUserId,
  assertOwned,
  parseBody,
  copyFields,
  saveRecordWithClonedAttachments,
  restoreDocumentVersions,
  permanentlyDeleteTrashVersions,
  moveDocumentToTrashById,
  rehomeBoardsFromFolderIds,
  collectFolderTree,
}
