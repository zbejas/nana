/// <reference path="../../../pb_data/types.d.ts" />

// Small serializers and validation shared by the user-sharing routes.

const SHARE_TARGETS = ["document", "folder", "board"]
const COMMENT_TARGETS = ["document", "board", "task"]
const MAX_COMMENT_LENGTH = 10000

function authId(c) {
  if (!c.auth) throw new UnauthorizedError("Authentication required")
  return c.auth.id
}

function queryValue(c, name) {
  const info = c.requestInfo()
  const value = info && info.query ? info.query[name] : ""
  return value === null || value === undefined ? "" : String(value).trim()
}

function queryNumber(c, name, fallback, min, max) {
  const text = queryValue(c, name)
  if (!text) return fallback
  const raw = Number(text)
  const value = Number.isFinite(raw) ? raw : fallback
  return Math.min(max, Math.max(min, value))
}

function bodyValue(c) {
  const { parseRequestBody } = require(`${__hooks}/utils.js`)
  return parseRequestBody(c)
}

function isShareTarget(type) {
  return SHARE_TARGETS.indexOf(String(type || "")) !== -1
}

function isCommentTarget(type) {
  return COMMENT_TARGETS.indexOf(String(type || "")) !== -1
}

function targetCollection(type) {
  if (type === "document") return "documents"
  if (type === "folder") return "folders"
  if (type === "board") return "boards"
  if (type === "task") return "tasks"
  return ""
}

function loadRecord(collection, id, app) {
  if (!collection || !id) return null
  try {
    return (app || $app).findRecordById(collection, id)
  } catch (_) {
    return null
  }
}

function loadTarget(type, id, app) {
  return loadRecord(targetCollection(type), id, app)
}

function targetIdForShare(share) {
  for (const type of SHARE_TARGETS) {
    const value = String(share.get(type) || "")
    if (value) return { type, id: value }
  }
  return null
}

function loadShare(id, app) {
  return loadRecord("shares", id, app)
}

function loadComment(id, app) {
  return loadRecord("comments", id, app)
}

function shareTarget(share, app) {
  const target = targetIdForShare(share)
  if (!target) return null
  return {
    type: target.type,
    id: target.id,
    record: loadTarget(target.type, target.id, app),
  }
}

/**
 * User objects exposed to the share picker and share lists never include
 * email, admin, or verification state. Email is added only by the directory
 * route for an exact address match.
 */
function serializeUser(user) {
  if (!user) return null
  return {
    id: user.id,
    collectionName: "users",
    name: String(user.get("name") || ""),
    avatar: String(user.get("avatar") || ""),
  }
}

function serializeDirectoryUser(user, includeEmail) {
  const serialized = serializeUser(user)
  if (serialized && includeEmail) {
    serialized.email = String(user.get("email") || "")
  }
  return serialized
}

function findUser(id, app) {
  return loadRecord("users", id, app)
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

  if (type === "task") {
    return {
      id: record.id,
      title: String(record.get("title") || ""),
      status: String(record.get("status") || ""),
      board: String(record.get("board") || ""),
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

function serializeShare(share, app) {
  const target = targetIdForShare(share)
  return {
    id: share.id,
    targetType: target ? target.type : "",
    targetId: target ? target.id : "",
    user: serializeUser(findUser(String(share.get("user") || ""), app)),
    sharedBy: serializeUser(findUser(String(share.get("shared_by") || ""), app)),
    permission: String(share.get("permission") || ""),
    level: Number(share.get("level") || 0),
    created: String(share.get("created") || ""),
    updated: String(share.get("updated") || ""),
  }
}

function assertTargetOwner(type, id, userId, app) {
  if (!isShareTarget(type)) throw new BadRequestError("Invalid share target type")
  const target = loadTarget(type, id, app)
  if (!target) throw new BadRequestError("Share target not found")
  if (String(target.get("author") || "") !== userId) {
    throw new ForbiddenError("Only the owner can manage sharing")
  }
  return target
}

/** Private means not shareable with people, including descendants of a private folder. */
function assertTargetShareable(type, target, app) {
  const access = require(`${__hooks}/sharing/access_helpers.js`)
  if (target.getBool("is_private")) {
    throw new BadRequestError("Private records cannot be shared with people")
  }
  if (String(target.get("deleted_at") || "") !== "") {
    throw new BadRequestError("Trashed records cannot be shared")
  }
  if (access.targetIsLocked(type, target, app)) {
    throw new BadRequestError("Records inside a private folder cannot be shared with people")
  }
  if (type === "board" && target.getBool("archived")) {
    throw new BadRequestError("Archived boards cannot be shared with people")
  }
  if (!access.targetIsShareable(type, target, app)) {
    throw new BadRequestError("This record cannot be shared with people")
  }
}

function validatePermission(permission) {
  const value = String(permission || "").trim()
  if (value !== "view" && value !== "comment" && value !== "edit") {
    throw new BadRequestError("Permission must be view, comment, or edit")
  }
  return value
}

function normalizeCommentBody(value) {
  const text = (typeof value === "string" ? value : "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
  if (!text) throw new BadRequestError("Write a comment first")
  if (text.length > MAX_COMMENT_LENGTH) throw new BadRequestError("Comment is too long")
  return text
}

function findDirectShare(type, targetId, userId, app) {
  try {
    return (app || $app).findFirstRecordByFilter(
      "shares",
      `${type} = {:target} && user = {:user}`,
      { target: targetId, user: userId }
    )
  } catch (_) {
    return null
  }
}

function sharesForTarget(type, targetId, app) {
  try {
    return (app || $app).findRecordsByFilter(
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

function commentTarget(comment, app) {
  const taskId = String(comment.get("task") || "")
  if (taskId) {
    return { type: "task", id: taskId, record: loadRecord("tasks", taskId, app) }
  }
  const documentId = String(comment.get("document") || "")
  if (documentId) {
    return { type: "document", id: documentId, record: loadRecord("documents", documentId, app) }
  }
  const boardId = String(comment.get("board") || "")
  if (boardId) {
    return { type: "board", id: boardId, record: loadRecord("boards", boardId, app) }
  }
  return null
}

function serializeComment(comment, viewerId, access, app) {
  const target = commentTarget(comment, app)
  return {
    id: comment.id,
    targetType: target ? target.type : "",
    targetId: target ? target.id : "",
    body: String(comment.get("body") || ""),
    author: serializeUser(findUser(String(comment.get("author") || ""), app)),
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
  COMMENT_TARGETS,
  MAX_COMMENT_LENGTH,
  authId,
  queryValue,
  queryNumber,
  bodyValue,
  isShareTarget,
  isCommentTarget,
  targetCollection,
  loadTarget,
  loadShare,
  loadComment,
  shareTarget,
  serializeUser,
  serializeDirectoryUser,
  findUser,
  serializeTarget,
  serializeShare,
  assertTargetOwner,
  assertTargetShareable,
  validatePermission,
  normalizeCommentBody,
  findDirectShare,
  sharesForTarget,
  commentTarget,
  serializeComment,
}
