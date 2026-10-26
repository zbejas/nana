/// <reference path="../../pb_data/types.d.ts" />

// Share/access resolution shared by custom routes and request guards.
// Direct shares live in `shares`; folder inheritance is materialized into
// `access_grants` for PocketBase rules and custom routes.

const PERMISSION_LEVELS = { view: 1, comment: 2, edit: 3 }
const LEVEL_PERMISSIONS = { 1: "view", 2: "comment", 3: "edit" }
const TARGET_COLLECTIONS = {
  document: "documents",
  folder: "folders",
  board: "boards",
}

function permissionLevel(permission) {
  return PERMISSION_LEVELS[String(permission || "")] || 0
}

function levelPermission(level) {
  return LEVEL_PERMISSIONS[Number(level)] || ""
}

function targetCollection(targetType) {
  return TARGET_COLLECTIONS[String(targetType || "")] || ""
}

function findRecord(collection, id) {
  if (!id) return null
  try {
    return $app.findRecordById(collection, id)
  } catch (_) {
    return null
  }
}

function isDeleted(record) {
  return Boolean(record && String(record.get("deleted_at") || "") !== "")
}

function findDirectShare(targetType, targetId, userId) {
  if (!targetType || !targetId || !userId) return null
  const field = String(targetType)
  try {
    return $app.findFirstRecordByFilter(
      "shares",
      `${field} = {:target} && user = {:user}`,
      { target: targetId, user: userId }
    )
  } catch (_) {
    return null
  }
}

function findFolderShares(folderId) {
  if (!folderId) return []
  try {
    return $app.findRecordsByFilter(
      "shares",
      "folder = {:folder}",
      "",
      0,
      0,
      { folder: folderId }
    )
  } catch (_) {
    return []
  }
}

function mergeUserLevel(map, userId, level) {
  if (!userId || level <= 0) return
  const current = map[userId] || 0
  if (level > current) map[userId] = level
}

/**
 * Returns the maximum level inherited from ancestor folder shares. Explicit
 * direct shares are handled separately. A private folder stops inheritance.
 */
function ancestorShareLevels(targetType, target) {
  const result = {}
  if (!target || target.getBool("is_private")) return result

  let folderId = ""
  if (targetType === "folder") {
    folderId = String(target.get("parent") || "")
  } else {
    folderId = String(target.get("folder") || "")
  }

  let steps = 0
  while (folderId) {
    const folder = findRecord("folders", folderId)
    if (!folder || isDeleted(folder) || folder.getBool("is_private")) {
      break
    }

    const shares = findFolderShares(folder.id)
    for (const share of shares) {
      mergeUserLevel(
        result,
        String(share.get("user") || ""),
        Number(share.get("level") || 0)
      )
    }

    folderId = String(folder.get("parent") || "")
    steps += 1
    if (steps > 1000) break
  }

  return result
}

/**
 * Resolve the caller's effective access to a record.
 * Returns { role, level, source } or null when the record is missing/trashed.
 */
function effectiveAccess(targetType, targetId, userId) {
  const collection = targetCollection(targetType)
  if (!collection || !userId) return null

  const target = findRecord(collection, targetId)
  if (!target || isDeleted(target)) return null

  if (String(target.get("author") || "") === userId) {
    return { role: "owner", level: 3, source: "owner" }
  }

  let level = 0
  let source = ""
  const direct = findDirectShare(targetType, targetId, userId)
  if (direct) {
    level = Number(direct.get("level") || 0)
    source = "direct"
  }

  const inherited = ancestorShareLevels(targetType, target)
  if ((inherited[userId] || 0) > level) {
    level = inherited[userId]
    source = "inherited"
  }

  if (level <= 0) return null
  return { role: levelPermission(level), level, source }
}

function canRead(targetType, targetId, userId) {
  return Boolean(effectiveAccess(targetType, targetId, userId))
}

function canComment(targetType, targetId, userId) {
  const access = effectiveAccess(targetType, targetId, userId)
  return Boolean(access && access.level >= 2)
}

function canEdit(targetType, targetId, userId) {
  const access = effectiveAccess(targetType, targetId, userId)
  return Boolean(access && access.level >= 3)
}

function grantsForTarget(targetType, targetId) {
  const field = String(targetType)
  try {
    return $app.findRecordsByFilter(
      "access_grants",
      `${field} = {:target}`,
      "",
      0,
      0,
      { target: targetId }
    )
  } catch (_) {
    return []
  }
}

/**
 * Recompute inherited grants for one record. Direct shares are not copied here;
 * PocketBase rules check `shares` separately.
 */
function rebuildResourceGrants(targetType, targetId) {
  const collection = targetCollection(targetType)
  if (!collection) return

  const existing = grantsForTarget(targetType, targetId)
  for (const grant of existing) {
    try {
      $app.delete(grant)
    } catch (_) {}
  }

  const target = findRecord(collection, targetId)
  if (!target || isDeleted(target) || target.getBool("is_private")) {
    return
  }

  const levels = ancestorShareLevels(targetType, target)
  const grants = findCollectionByNameOrId("access_grants")
  if (!grants) return

  for (const userId of Object.keys(levels)) {
    if (!userId || userId === String(target.get("author") || "")) continue
    const level = levels[userId]
    if (level <= 0) continue

    const record = new Record(grants)
    record.set(targetType, targetId)
    record.set("user", userId)
    record.set("permission", levelPermission(level))
    record.set("level", level)
    $app.save(record)
  }
}

function findCollectionByNameOrId(name) {
  try {
    return $app.findCollectionByNameOrId(name)
  } catch (_) {
    return null
  }
}

function collectFolderTree(folderId) {
  const root = findRecord("folders", folderId)
  if (!root) return []

  const result = []
  const seen = {}
  const queue = [root]

  while (queue.length > 0) {
    const folder = queue.shift()
    if (!folder || seen[folder.id]) continue
    seen[folder.id] = true
    result.push(folder)

    const children = $app.findRecordsByFilter(
      "folders",
      "parent = {:parent}",
      "+created",
      0,
      0,
      { parent: folder.id }
    )
    for (const child of children) {
      queue.push(child)
    }
  }

  return result
}

function collectFolderTargets(folderId) {
  const folders = collectFolderTree(folderId)
  const documents = []
  const boards = []
  const seenDocuments = {}
  const seenBoards = {}

  for (const folder of folders) {
    const docs = $app.findRecordsByFilter(
      "documents",
      "folder = {:folder}",
      "+created",
      0,
      0,
      { folder: folder.id }
    )
    for (const doc of docs) {
      if (!doc || seenDocuments[doc.id]) continue
      seenDocuments[doc.id] = true
      documents.push(doc)
    }

    const folderBoards = $app.findRecordsByFilter(
      "boards",
      "folder = {:folder}",
      "+created",
      0,
      0,
      { folder: folder.id }
    )
    for (const board of folderBoards) {
      if (!board || seenBoards[board.id]) continue
      seenBoards[board.id] = true
      boards.push(board)
    }
  }

  return { folders, documents, boards }
}

/** Recompute inherited grants for a folder and every descendant resource. */
function rebuildFolderSubtree(folderId) {
  const targets = collectFolderTargets(folderId)
  for (const folder of targets.folders) {
    rebuildResourceGrants("folder", folder.id)
  }
  for (const document of targets.documents) {
    rebuildResourceGrants("document", document.id)
  }
  for (const board of targets.boards) {
    rebuildResourceGrants("board", board.id)
  }
}

/** Called after a direct factory share changes on a folder. */
function rebuildForDirectShare(targetType, targetId) {
  if (targetType === "folder") {
    rebuildFolderSubtree(targetId)
  }
}

module.exports = {
  PERMISSION_LEVELS,
  permissionLevel,
  levelPermission,
  targetCollection,
  findRecord,
  isDeleted,
  findDirectShare,
  findFolderShares,
  ancestorShareLevels,
  effectiveAccess,
  canRead,
  canComment,
  canEdit,
  rebuildResourceGrants,
  rebuildFolderSubtree,
  rebuildForDirectShare,
}
