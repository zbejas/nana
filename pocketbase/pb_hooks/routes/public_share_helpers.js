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
    var filter = "public_share_token = {:token}"
    if (collectionName === "documents" || collectionName === "folders") {
      filter += " && deleted_at = ''"
    }
    return $app.findFirstRecordByFilter(
      collectionName,
      filter,
      { token: token }
    )
  } catch (_) {
    return null
  }
}

/**
 * A public record inside a private or trashed folder is not public. Walk every
 * ancestor because the folder state is not denormalized onto the record and
 * the collection rules cannot express a recursive lookup.
 */
function ancestorsArePublic(record) {
  const collection = String(record.collection().name || "")
  let folderId = ""
  if (collection === "folders") {
    folderId = String(record.get("parent") || "")
  } else if (collection === "documents" || collection === "boards") {
    folderId = String(record.get("folder") || "")
  } else {
    return true
  }

  let steps = 0
  while (folderId) {
    let folder = null
    try {
      folder = $app.findRecordById("folders", folderId)
    } catch (_) {
      return false
    }
    if (!folder ||
        folder.getBool("is_private") ||
        String(folder.get("deleted_at") || "") !== "") {
      return false
    }
    folderId = String(folder.get("parent") || "")
    steps += 1
    if (steps > 1000) return false
  }
  return true
}

/**
 * Validates that a record is publicly accessible:
 * is_public=true, is_private=false, no private/trashed ancestor folder, and not
 * expired.
 */
function ensureActivePublicShare(record) {
  if (
    !record ||
    !record.getBool("is_public") ||
    record.getBool("is_private") ||
    String(record.get("deleted_at") || "") !== ""
  ) {
    throw new NotFoundError("Public share not found")
  }

  if (!ancestorsArePublic(record)) {
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

// Public assignees never expose an email address. A user without a display
// name is shown as a neutral member label instead.
function serializePublicAssignee(assigneeRecord) {
  if (!assigneeRecord) return null
  return {
    id: assigneeRecord.id,
    name: assigneeRecord.getString("name") || "Member",
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

function serializeBoard(record) {
  var columns = []
  var columnRecords = collectBoardColumns(record.id)
  for (var i = 0; i < columnRecords.length; i++) {
    columns.push(serializeBoardColumn(columnRecords[i]))
  }

  return {
    id: record.id,
    name: record.getString("name"),
    description: record.getString("description") || "",
    icon: record.getString("icon") || "",
    author: record.getString("author"),
    folder: record.getString("folder") || "",
    columns: columns,
    created: toIsoOrNull(record.get("created")),
    updated: toIsoOrNull(record.get("updated")),
  }
}

function serializeBoardColumn(record) {
  return {
    id: record.id,
    slug: record.getString("slug"),
    name: record.getString("name"),
    position: record.getInt("position") || 0,
    icon: record.getString("icon") || "",
    color: record.getString("color") || "",
    is_final: record.getBool("is_final"),
  }
}

function collectBoardColumns(boardId) {
  if (!boardId) return []
  return $app.findRecordsByFilter(
    "board_columns",
    "board = {:boardId}",
    "position,created",
    0,
    0,
    { boardId: boardId }
  )
}

/**
 * A task's linked note is intentionally omitted from public board shares.
 * The note has its own privacy and sharing state, so the board never exposes
 * a relation that could point at a private record. The assignee is reduced to
 * id and display name; its email address is never public.
 */
function serializeTask(record) {
  var assignee = null
  var assigneeId = record.getString("assignee")
  if (assigneeId) {
    assignee = serializePublicAssignee(findAuthorRecord(assigneeId))
  }

  return {
    id: record.id,
    title: record.getString("title"),
    description: record.getString("description") || "",
    status: record.getString("status") || "planned",
    priority: record.getString("priority") || "",
    due_date: toIsoOrNull(record.get("due_date")),
    start_date: toIsoOrNull(record.get("start_date")),
    completed_at: toIsoOrNull(record.get("completed_at")),
    task_number: record.getInt("task_number") || null,
    board_order: record.getInt("board_order") || 0,
    labels: record.getStringSlice("labels"),
    assignee: assignee,
    created: toIsoOrNull(record.get("created")),
    updated: toIsoOrNull(record.get("updated")),
  }
}

/**
 * A public folder board is the board payload plus its tasks. The tasks keep
 * the same read-only contract as a standalone board share: no author, board,
 * or linked note.
 */
function serializeBoardWithTasks(record) {
  var serialized = serializeBoard(record)
  var taskRecords = collectBoardTasks(record.id)
  var tasks = []

  for (var i = 0; i < taskRecords.length; i++) {
    tasks.push(serializeTask(taskRecords[i]))
  }

  serialized.tasks = tasks
  return serialized
}

function collectBoardTasks(boardId) {
  return $app.findRecordsByFilter(
    "tasks",
    "board = {:boardId}",
    "board_order,created",
    0,
    0,
    { boardId: boardId }
  )
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
      "parent = {:parentId} && deleted_at = ''",
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
      "folder = {:folderId} && deleted_at = ''",
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

/**
 * Collects active boards in the given folder IDs. A folder share never exposes
 * private boards, archived boards, or boards owned by someone else even if the
 * stored folder relation is inconsistent.
 */
function collectFolderBoards(folderIds, authorId) {
  var boards = []

  for (var f = 0; f < folderIds.length; f++) {
    var folderBoards = $app.findRecordsByFilter(
      "boards",
      "folder = {:folderId} && archived = false && author = {:authorId}",
      "+name",
      500,
      0,
      { folderId: folderIds[f], authorId: authorId }
    )

    for (var b = 0; b < folderBoards.length; b++) {
      if (!folderBoards[b].getBool("is_private")) {
        boards.push(folderBoards[b])
      }
    }
  }

  return boards
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
    ancestorsArePublic: ancestorsArePublic,
    ensureActivePublicShare: ensureActivePublicShare,
    findAuthorRecord: findAuthorRecord,
    serializeAuthor: serializeAuthor,
    serializePublicAssignee: serializePublicAssignee,
    serializeDocument: serializeDocument,
    serializeFolder: serializeFolder,
    serializeBoard: serializeBoard,
    serializeBoardColumn: serializeBoardColumn,
    serializeTask: serializeTask,
    serializeBoardWithTasks: serializeBoardWithTasks,
    collectBoardTasks: collectBoardTasks,
    collectBoardColumns: collectBoardColumns,
    collectFolderDescendants: collectFolderDescendants,
    collectFolderDocuments: collectFolderDocuments,
    collectFolderBoards: collectFolderBoards,
    buildRecordFileKey: buildRecordFileKey,
    getOriginalFilename: getOriginalFilename,
    ensureAttachmentExists: ensureAttachmentExists,
  }
}
