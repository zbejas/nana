/// <reference path="../../../pb_data/types.d.ts" />

// Small serializers and validation shared by the user-sharing routes.

const SHARE_TARGETS = ["document", "folder", "board"]

function authId(c) {
  if (!c.auth) throw new UnauthorizedError("Authentication required")
  return c.auth.id
}

function queryValue(c, name) {
  const info = c.requestInfo()
  const value = info && info.query ? info.query[name] : ""
  return value === null || value === undefined ? "" : String(value).trim()
}

function bodyValue(c) {
  const { parseRequestBody } = require(`${__hooks}/utils.js`)
  return parseRequestBody(c)
}

function isShareTarget(type) {
  return SHARE_TARGETS.indexOf(String(type || "")) !== -1
}

function targetCollection(type) {
  if (type === "document") return "documents"
  if (type === "folder") return "folders"
  if (type === "board") return "boards"
  return ""
}

function loadRecord(collection, id) {
  if (!collection || !id) return null
  try {
    return $app.findRecordById(collection, id)
  } catch (_) {
    return null
  }
}

function loadTarget(type, id) {
  return loadRecord(targetCollection(type), id)
}

function targetIdForShare(share) {
  for (const type of SHARE_TARGETS) {
    const value = String(share.get(type) || "")
    if (value) return { type, id: value }
  }
  return null
}

function loadShare(id) {
  return loadRecord("shares", id)
}

function shareTarget(share) {
  const target = targetIdForShare(share)
  if (!target) return null
  return { type: target.type, id: target.id, record: loadTarget(target.type, target.id) }
}

function serializeUser(user) {
  if (!user) return null
  return {
    id: user.id,
    collectionName: "users",
    name: String(user.get("name") || ""),
    email: String(user.get("email") || ""),
    avatar: String(user.get("avatar") || ""),
    verified: user.getBool("verified"),
    admin: user.getBool("admin"),
  }
}

function findUser(id) {
  return loadRecord("users", id)
}

function serializeTarget(type, record) {
  if (!record) return null

  if (type === "document") {
    return {
      id: record.id,
      title: String(record.get("title") || ""),
      slug: String(record.get("slug") || ""),
      tags: record.get("tags") || [],
      folder: String(record.get("folder") || ""),
      is_private: record.getBool("is_private"),
      is_public: record.getBool("is_public"),
      word_count: Number(record.get("word_count") || 0),
      reading_time: Number(record.get("reading_time") || 0),
      created: String(record.get("created") || ""),
      updated: String(record.get("updated") || ""),
    }
  }

  if (type === "folder") {
    return {
      id: record.id,
      name: String(record.get("name") || ""),
      color: String(record.get("color") || ""),
      parent: String(record.get("parent") || ""),
      is_private: record.getBool("is_private"),
      is_public: record.getBool("is_public"),
      created: String(record.get("created") || ""),
      updated: String(record.get("updated") || ""),
    }
  }

  return {
    id: record.id,
    name: String(record.get("name") || ""),
    description: String(record.get("description") || ""),
    archived: record.getBool("archived"),
    folder: String(record.get("folder") || ""),
    is_private: record.getBool("is_private"),
    is_public: record.getBool("is_public"),
    created: String(record.get("created") || ""),
    updated: String(record.get("updated") || ""),
  }
}

function serializeShare(share) {
  const target = targetIdForShare(share)
  return {
    id: share.id,
    targetType: target ? target.type : "",
    targetId: target ? target.id : "",
    user: serializeUser(findUser(String(share.get("user") || ""))),
    sharedBy: serializeUser(findUser(String(share.get("shared_by") || ""))),
    permission: String(share.get("permission") || ""),
    level: Number(share.get("level") || 0),
    created: String(share.get("created") || ""),
    updated: String(share.get("updated") || ""),
  }
}

function assertTargetOwner(type, id, userId) {
  if (!isShareTarget(type)) throw new BadRequestError("Invalid share target type")
  const target = loadTarget(type, id)
  if (!target) throw new BadRequestError("Share target not found")
  if (String(target.get("author") || "") !== userId) {
    throw new ForbiddenError("Only the owner can manage sharing")
  }
  return target
}

function assertTargetShareable(type, target) {
  if (String(target.get("deleted_at") || "") !== "") {
    throw new BadRequestError("Trashed records cannot be shared")
  }
  if (type === "folder" && target.getBool("is_private")) {
    throw new BadRequestError("Private folders cannot be shared with people")
  }
}

function validatePermission(permission) {
  const value = String(permission || "").trim()
  if (value !== "view" && value !== "comment" && value !== "edit") {
    throw new BadRequestError("Permission must be view, comment, or edit")
  }
  return value
}

function findDirectShare(type, targetId, userId) {
  try {
    return $app.findFirstRecordByFilter(
      "shares",
      `${type} = {:target} && user = {:user}`,
      { target: targetId, user: userId }
    )
  } catch (_) {
    return null
  }
}

function sharesForTarget(type, targetId) {
  try {
    return $app.findRecordsByFilter(
      "shares",
      `${type} = {:target}`,
      "+created",
      0,
      0,
      { target: targetId }
    )
  } catch (_) {
    return []
  }
}

function commentTarget(comment) {
  const documentId = String(comment.get("document") || "")
  if (documentId) {
    return { type: "document", id: documentId, record: loadRecord("documents", documentId) }
  }
  const boardId = String(comment.get("board") || "")
  if (boardId) {
    return { type: "board", id: boardId, record: loadRecord("boards", boardId) }
  }
  return null
}

function serializeComment(comment, viewerId, access) {
  return {
    id: comment.id,
    targetType: commentTarget(comment)?.type || "",
    targetId: commentTarget(comment)?.id || "",
    body: String(comment.get("body") || ""),
    author: serializeUser(findUser(String(comment.get("author") || ""))),
    created: String(comment.get("created") || ""),
    updated: String(comment.get("updated") || ""),
    canEdit: String(comment.get("author") || "") === viewerId,
    canDelete:
      String(comment.get("author") || "") === viewerId ||
      Boolean(access && access.level >= 3),
  }
}

module.exports = {
  SHARE_TARGETS,
  authId,
  queryValue,
  bodyValue,
  isShareTarget,
  targetCollection,
  loadTarget,
  loadShare,
  shareTarget,
  serializeUser,
  findUser,
  serializeTarget,
  serializeShare,
  assertTargetOwner,
  assertTargetShareable,
  validatePermission,
  findDirectShare,
  sharesForTarget,
  commentTarget,
  serializeComment,
}
