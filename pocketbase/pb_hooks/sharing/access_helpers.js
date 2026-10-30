/// <reference path="../../pb_data/types.d.ts" />

// Share/access resolution shared by custom routes, request guards, and
// lifecycle hooks.
//
// Direct shares live in `shares`; the effective set (direct shares plus folder
// inheritance) is materialized into `access_grants` for PocketBase rules and
// custom routes. Every function that touches the database accepts an optional
// app so route changes can run inside a transaction with the transaction app.
//
// The privacy contract is enforced here as well as in the routes:
// - a private record is never readable by a grantee, even with a stale share;
// - a private or trashed folder stops inheritance for its whole subtree;
// - records that become private/trashed lose their direct user shares.

const PERMISSION_LEVELS = { view: 1, comment: 2, edit: 3 }
const LEVEL_PERMISSIONS = { 1: "view", 2: "comment", 3: "edit" }
const TARGET_COLLECTIONS = {
  document: "documents",
  folder: "folders",
  board: "boards",
  task: "tasks",
}

function appOrGlobal(app) {
  return app || $app
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

function findRecord(collection, id, app) {
  if (!id) return null
  try {
    return appOrGlobal(app).findRecordById(collection, id)
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

function findDirectShare(targetType, targetId, userId, app) {
  if (!targetType || targetId === "" || !userId) return null
  const field = String(targetType)
  try {
    return appOrGlobal(app).findFirstRecordByFilter(
      "shares",
      `${field} = {:target} && user = {:user}`,
      { target: targetId, user: userId }
    )
  } catch (_) {
    return null
  }
}

function findFolderShares(folderId, app) {
  if (!folderId) return []
  try {
    return appOrGlobal(app).findRecordsByFilter(
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

function sharesForTarget(targetType, targetId, app) {
  if (!targetType || targetId === "") return []
  try {
    return appOrGlobal(app).findRecordsByFilter(
      "shares",
      `${targetType} = {:target}`,
      "",
      0,
      0,
      { target: targetId }
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

/** The folder a record's inheritance starts from, if any. */
function parentFolderId(targetType, target) {
  if (!target) return ""
  if (targetType === "folder") return String(target.get("parent") || "")
  if (targetType === "document" || targetType === "board") {
    return String(target.get("folder") || "")
  }
  return ""
}

/**
 * Walk the folder ancestors. Returns `{ levels, locked }`:
 * - `levels` merges folder shares up the chain, stopping at a private/trashed
 *   folder;
 * - `locked` is true when the record is inside a private or trashed folder.
 */
function walkAncestorFolders(targetType, target, app) {
  const levels = {}
  if (!target) return { levels, locked: false }

  let folderId = parentFolderId(targetType, target)
  let locked = false
  let steps = 0

  while (folderId) {
    const folder = findRecord("folders", folderId, app)
    if (!folder || isDeleted(folder)) {
      locked = true
      break
    }
    if (isPrivate(folder)) {
      locked = true
      break
    }

    const shares = findFolderShares(folder.id, app)
    for (const share of shares) {
      mergeUserLevel(
        levels,
        String(share.get("user") || ""),
        Number(share.get("level") || 0)
      )
    }

    folderId = String(folder.get("parent") || "")
    steps += 1
    if (steps > 1000) {
      locked = true
      break
    }
  }

  return { levels, locked }
}

/** True when the record itself is private or sits under a private/trashed folder. */
function targetIsLocked(targetType, target, app) {
  if (!target) return true
  if (targetType === "folder" && isPrivate(target)) return true
  if ((targetType === "document" || targetType === "board") && isPrivate(target)) return true
  return walkAncestorFolders(targetType, target, app).locked
}

/** Trashed, private, or inside a private/trashed folder. */
function targetIsPrivateOrTrashed(targetType, target, app) {
  if (!target) return true
  if (isDeleted(target)) return true
  return targetIsLocked(targetType, target, app)
}

/** Person-to-person sharing is allowed only for live, non-private records. */
function targetIsShareable(targetType, target, app) {
  if (!target) return false
  if (targetType !== "document" && targetType !== "folder" && targetType !== "board") {
    return false
  }
  if (targetIsPrivateOrTrashed(targetType, target, app)) return false
  if (targetType === "board" && target.getBool("archived")) return false
  return true
}

/**
 * Returns the maximum level inherited from ancestor folder shares. Explicit
 * direct shares are handled separately. A private folder stops inheritance.
 */
function ancestorShareLevels(targetType, target, app) {
  if (!target || targetType === "task" || isPrivate(target)) return {}
  return walkAncestorFolders(targetType, target, app).levels
}

/**
 * Resolve the caller's effective access to a record.
 * Returns { role, level, source } or null when the record is missing/trashed,
 * private, or in a private/trashed folder.
 *
 * Task access follows the task's board. Ownership of a task means ownership of
 * the board; task records have no author field.
 */
function effectiveAccess(targetType, targetId, userId, app) {
  if (!userId) return null

  if (targetType === "task") {
    const task = findRecord("tasks", targetId, app)
    if (!task) return null
    const boardId = String(task.get("board") || "")
    if (!boardId) return null
    const boardAccess = effectiveAccess("board", boardId, userId, app)
    if (!boardAccess) return null
    return {
      role: boardAccess.role,
      level: boardAccess.level,
      source: `board-${boardAccess.source}`,
    }
  }

  const collection = targetCollection(targetType)
  if (!collection) return null

  const target = findRecord(collection, targetId, app)
  if (!target || isDeleted(target)) return null

  if (String(target.get("author") || "") === userId) {
    return { role: "owner", level: 3, source: "owner" }
  }

  // A private record or a descendant of a private folder never leaks through a
  // stale direct share. The owner check above still wins.
  if (targetIsLocked(targetType, target, app)) return null

  let level = 0
  let source = ""
  const direct = findDirectShare(targetType, targetId, userId, app)
  if (direct) {
    level = Number(direct.get("level") || 0)
    source = "direct"
  }

  const inherited = ancestorShareLevels(targetType, target, app)
  if ((inherited[userId] || 0) > level) {
    level = inherited[userId]
    source = "inherited"
  }

  if (level <= 0) return null
  return { role: levelPermission(level), level, source }
}

function canRead(targetType, targetId, userId, app) {
  return Boolean(effectiveAccess(targetType, targetId, userId, app))
}

function canComment(targetType, targetId, userId, app) {
  const access = effectiveAccess(targetType, targetId, userId, app)
  return Boolean(access && access.level >= 2)
}

function canEdit(targetType, targetId, userId, app) {
  const access = effectiveAccess(targetType, targetId, userId, app)
  return Boolean(access && access.level >= 3)
}

function grantsForTarget(targetType, targetId, app) {
  if (!targetType || targetId === "") return []
  const field = String(targetType)
  try {
    return appOrGlobal(app).findRecordsByFilter(
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
 * Strict variant for write paths. A failed read here must abort the privacy
 * transition instead of leaving existing grants in place.
 */
function grantsForTargetStrict(targetType, targetId, app) {
  if (!targetType || targetId === "") return []
  const field = String(targetType)
  return appOrGlobal(app).findRecordsByFilter(
    "access_grants",
    `${field} = {:target}`,
    "",
    0,
    0,
    { target: targetId }
  )
}

/**
 * Remove direct shares for a record. Used when a record stops being shareable
 * (privacy flip, move into a private folder, trash) so a stale grant can never
 * survive the transition.
 */
function pruneTargetShares(targetType, targetId, app) {
  if (!targetType || targetId === "" || targetType === "task") return 0
  const db = appOrGlobal(app)
  let removed = 0
  const shares = (() => {
    try {
      return db.findRecordsByFilter(
        "shares",
        `${targetType} = {:target}`,
        "",
        0,
        0,
        { target: targetId }
      )
    } catch (_) {
      return []
    }
  })()

  for (const share of shares) {
    try {
      db.delete(share)
      removed += 1
    } catch (_) {}
  }
  return removed
}

/**
 * Remove every materialized grant for one record. Lifecycle hooks call this
 * before a privacy/folder transition is saved so a failed post-save rebuild
 * under-grants instead of leaving access behind.
 */
function clearResourceGrants(targetType, targetId, app) {
  if (!targetType || targetId === "" || targetType === "task") return 0
  const db = appOrGlobal(app)
  const existing = grantsForTargetStrict(targetType, targetId, db)
  for (const grant of existing) {
    db.delete(grant)
  }
  return existing.length
}

/** Remove grants for a folder and every descendant resource. */
function clearFolderSubtreeGrants(folderId, app) {
  const db = appOrGlobal(app)
  const targets = collectFolderTargets(folderId, db)
  let removed = 0
  for (const folder of targets.folders) {
    removed += clearResourceGrants("folder", folder.id, db)
  }
  for (const document of targets.documents) {
    removed += clearResourceGrants("document", document.id, db)
  }
  for (const board of targets.boards) {
    removed += clearResourceGrants("board", board.id, db)
  }
  return removed
}

/**
 * Recompute grants for one record. `access_grants` is the effective set the
 * rules read: it contains both direct shares and inherited folder grants, so a
 * stale `shares` row on a private/descendant record cannot bypass the rules.
 */
function rebuildResourceGrants(targetType, targetId, app) {
  const collection = targetCollection(targetType)
  if (!collection || targetType === "task") return

  const db = appOrGlobal(app)
  const existing = grantsForTargetStrict(targetType, targetId, db)
  for (const grant of existing) {
    db.delete(grant)
  }

  const target = findRecord(collection, targetId, db)
  if (!target || isDeleted(target) || targetIsLocked(targetType, target, db)) {
    return
  }

  const levels = ancestorShareLevels(targetType, target, db)

  // Direct shares are mirrored into the same effective grant table. The
  // `shares` collection stays the management source of truth; rules only read
  // grants, which are rebuilt whenever privacy, move, or trash state changes.
  const directShares = sharesForTarget(targetType, targetId, db)
  for (const share of directShares) {
    mergeUserLevel(
      levels,
      String(share.get("user") || ""),
      Number(share.get("level") || 0)
    )
  }

  let grants = null
  try {
    grants = db.findCollectionByNameOrId("access_grants")
  } catch (_) {
    grants = null
  }
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
    db.save(record)
  }
}

/** Rebuild grants and drop shares that are no longer permitted. */
function syncResourceSharing(targetType, targetId, app) {
  const db = appOrGlobal(app)
  const collection = targetCollection(targetType)
  if (!collection || targetType === "task") return

  const target = findRecord(collection, targetId, db)
  if (!target) return

  if (targetIsPrivateOrTrashed(targetType, target, db)) {
    pruneTargetShares(targetType, targetId, db)
  }
  rebuildResourceGrants(targetType, targetId, db)
}

function collectFolderTree(folderId, app) {
  const db = appOrGlobal(app)
  const root = findRecord("folders", folderId, db)
  if (!root) return []

  const result = []
  const seen = {}
  const queue = [root]

  while (queue.length > 0) {
    const folder = queue.shift()
    if (!folder || seen[folder.id]) continue
    seen[folder.id] = true
    result.push(folder)

    const children = db.findRecordsByFilter(
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

function collectFolderTargets(folderId, app) {
  const db = appOrGlobal(app)
  const folders = collectFolderTree(folderId, db)
  const documents = []
  const boards = []
  const seenDocuments = {}
  const seenBoards = {}

  for (const folder of folders) {
    const docs = db.findRecordsByFilter(
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

    const folderBoards = db.findRecordsByFilter(
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
function rebuildFolderSubtree(folderId, app) {
  const db = appOrGlobal(app)
  const targets = collectFolderTargets(folderId, db)
  for (const folder of targets.folders) {
    rebuildResourceGrants("folder", folder.id, db)
  }
  for (const document of targets.documents) {
    rebuildResourceGrants("document", document.id, db)
  }
  for (const board of targets.boards) {
    rebuildResourceGrants("board", board.id, db)
  }
}

/**
 * Rebuild a folder subtree and prune shares from records that became private
 * or trashed. Used on folder privacy/parent changes and trash transitions.
 */
function syncFolderSubtree(folderId, app) {
  const db = appOrGlobal(app)
  const targets = collectFolderTargets(folderId, db)
  for (const folder of targets.folders) {
    syncResourceSharing("folder", folder.id, db)
  }
  for (const document of targets.documents) {
    syncResourceSharing("document", document.id, db)
  }
  for (const board of targets.boards) {
    syncResourceSharing("board", board.id, db)
  }
}

/**
 * Re-evaluate grants for an explicit set of records. Trash helpers use it when
 * a folder operation touches records that are no longer in one subtree.
 */
function syncRecordSet(targets, app) {
  const db = appOrGlobal(app)
  for (const item of targets || []) {
    if (!item || !item.type || !item.id) continue
    syncResourceSharing(item.type, item.id, db)
  }
}

/** Called after a direct share changes on any target. */
function rebuildForDirectShare(targetType, targetId, app) {
  if (targetType === "folder") {
    rebuildFolderSubtree(targetId, app)
    return
  }
  rebuildResourceGrants(targetType, targetId, app)
}

/**
 * Find the nearest ancestor folder that is directly shared with the user.
 * Used to attribute inherited access in the shared-with-me list.
 */
function findAncestorShare(targetType, target, userId, app) {
  if (!target || !userId) return null
  let folderId = parentFolderId(targetType, target)

  let steps = 0
  while (folderId) {
    const share = findDirectShare("folder", folderId, userId, app)
    if (share) return share

    const folder = findRecord("folders", folderId, app)
    if (!folder) return null
    folderId = String(folder.get("parent") || "")
    steps += 1
    if (steps > 1000) return null
  }

  return null
}

module.exports = {
  PERMISSION_LEVELS,
  permissionLevel,
  levelPermission,
  targetCollection,
  findRecord,
  isDeleted,
  isPrivate,
  findDirectShare,
  findFolderShares,
  sharesForTarget,
  targetIsLocked,
  targetIsPrivateOrTrashed,
  targetIsShareable,
  ancestorShareLevels,
  effectiveAccess,
  canRead,
  canComment,
  canEdit,
  grantsForTarget,
  grantsForTargetStrict,
  pruneTargetShares,
  clearResourceGrants,
  clearFolderSubtreeGrants,
  rebuildResourceGrants,
  syncResourceSharing,
  collectFolderTree,
  collectFolderTargets,
  rebuildFolderSubtree,
  syncFolderSubtree,
  syncRecordSet,
  rebuildForDirectShare,
  findAncestorShare,
}
