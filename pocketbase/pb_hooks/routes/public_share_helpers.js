/// <reference path="../../pb_data/types.d.ts" />

function toIsoOrNull(value) {
  if (!value) return null
  var asString = String(value).trim()
  return asString || null
}

function isExpired(record) {
  var expiresAt = toIsoOrNull(record.get("public_expires_at"))
  if (!expiresAt) return false
  var expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return false
  return expiresAtMs <= Date.now()
}

function disablePublicShare(record) {
  record.set("is_public", false)
  record.set("public_share_token", "")
  record.set("public_expires_at", "")
  $app.save(record)
}

function findPublicShareRecord(collectionName, token) {
  try {
    return $app.findFirstRecordByFilter(
      collectionName,
      "public_share_token = {:token}",
      { token: token }
    )
  } catch (_) {
    return null
  }
}

/**
 * Validates that a record is publicly accessible:
 * is_public=true, is_private=false, and not expired.
 */
function ensureActivePublicShare(record) {
  if (!record || !record.getBool("is_public") || record.getBool("is_private")) {
    throw new NotFoundError("Public share not found")
  }

  if (isExpired(record)) {
    disablePublicShare(record)
    throw new NotFoundError("Public share not found")
  }

  return record
}

function findAuthorRecord(authorId) {
  if (!authorId) return null
  try {
    return $app.findRecordById("users", authorId)
  } catch (_) {
    return null
  }
}

function serializeAuthor(authorRecord) {
  if (!authorRecord) return null
  return {
    id: authorRecord.id,
    name: authorRecord.getString("name") || authorRecord.getString("email") || "Unknown",
  }
}

function serializeDocument(record) {
  return {
    id: record.id,
    title: record.getString("title"),
    slug: record.getString("slug"),
    content: record.getString("content") || "",
    attachments: record.getStringSlice("attachments"),
    tags: record.get("tags") || [],
    author: record.getString("author"),
    folder: record.getString("folder") || "",
    word_count: record.getInt("word_count") || 0,
    reading_time: record.getInt("reading_time") || 0,
    created: toIsoOrNull(record.get("created")),
    updated: toIsoOrNull(record.get("updated")),
  }
}

function serializeFolder(record) {
  return {
    id: record.id,
    name: record.getString("name"),
    parent: record.getString("parent") || "",
    author: record.getString("author"),
    color: record.getString("color") || "",
    created: toIsoOrNull(record.get("created")),
    updated: toIsoOrNull(record.get("updated")),
  }
}

/**
 * Collects descendant folders, skipping private subfolders and their
 * entire subtrees.
 */
function collectFolderDescendants(folderRecord) {
  var descendants = []
  var queue = [folderRecord]

  while (queue.length > 0) {
    var current = queue.shift()
    if (!current) continue

    descendants.push(current)

    var children = $app.findRecordsByFilter(
      "folders",
      "parent = {:parentId}",
      "+name",
      500,
      0,
      { parentId: current.id }
    )

    for (var i = 0; i < children.length; i++) {
      if (!children[i].getBool("is_private")) {
        queue.push(children[i])
      }
    }
  }

  return descendants
}

/**
 * Collects documents in the given folder IDs, skipping private documents.
 */
function collectFolderDocuments(folderIds) {
  var documents = []

  for (var f = 0; f < folderIds.length; f++) {
    var folderDocuments = $app.findRecordsByFilter(
      "documents",
      "folder = {:folderId}",
      "+title",
      500,
      0,
      { folderId: folderIds[f] }
    )

    for (var d = 0; d < folderDocuments.length; d++) {
      if (!folderDocuments[d].getBool("is_private")) {
        documents.push(folderDocuments[d])
      }
    }
  }

  return documents
}

function buildRecordFileKey(record, filename) {
  var baseFilesPath = String(record.baseFilesPath() || "").replace(/\/+$/, "")
  var cleanFilename = String(filename || "").replace(/^\/+/, "")

  if (!baseFilesPath || !cleanFilename) {
    throw new Error("Cannot build file key for record attachment")
  }

  return baseFilesPath + "/" + cleanFilename
}

function getOriginalFilename(filename) {
  var match = filename.match(/^(.+?)_[a-zA-Z0-9]+(\.[^.]+)$/)
  if (match && match[1] && match[2]) {
    return match[1] + match[2]
  }
  return filename
}

function ensureAttachmentExists(record, filename) {
  var attachments = record.getStringSlice("attachments")
  if (!attachments.includes(filename)) {
    throw new NotFoundError("Attachment not found")
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    toIsoOrNull: toIsoOrNull,
    findPublicShareRecord: findPublicShareRecord,
    ensureActivePublicShare: ensureActivePublicShare,
    findAuthorRecord: findAuthorRecord,
    serializeAuthor: serializeAuthor,
    serializeDocument: serializeDocument,
    serializeFolder: serializeFolder,
    collectFolderDescendants: collectFolderDescendants,
    collectFolderDocuments: collectFolderDocuments,
    buildRecordFileKey: buildRecordFileKey,
    getOriginalFilename: getOriginalFilename,
    ensureAttachmentExists: ensureAttachmentExists,
  }
}
