/// <reference path="../../../pb_data/types.d.ts" />

// Comments on shared notes, boards, and tasks. The comments collection is
// internal; every operation resolves target access through the sharing
// helpers. Bodies are stored and returned as plain text (never HTML) and are
// trimmed, length-capped, and rejected when empty.

routerAdd("GET", "/api/sharing/comments", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const targetType = h.queryValue(c, "targetType")
    const targetId = h.queryValue(c, "targetId")
    if (!h.isCommentTarget(targetType) || !targetId) {
      throw new BadRequestError("Comments require a note, board, or task")
    }

    const resolved = access.effectiveAccess(targetType, targetId, me)
    if (!resolved) throw new NotFoundError("Target not found")

    const comments = $app.findRecordsByFilter(
      "comments",
      `${targetType} = {:target}`,
      "+created",
      0,
      0,
      { target: targetId }
    )

    return c.json(200, {
      items: comments.map((comment) => h.serializeComment(comment, me, resolved)),
      permission: resolved.role,
      canComment: resolved.level >= 2,
    })
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof NotFoundError) return c.json(404, { error: "Target not found" })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to list comments:", err)
    return c.json(500, { error: "Failed to load comments" })
  }
}, $apis.requireAuth())

routerAdd("POST", "/api/sharing/comments", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const body = h.bodyValue(c)
    const targetType = String(body.targetType || "").trim()
    const targetId = String(body.targetId || "").trim()
    const text = h.normalizeCommentBody(body.body)

    if (!h.isCommentTarget(targetType) || !targetId) {
      throw new BadRequestError("Comments require a note, board, or task")
    }

    const resolved = access.effectiveAccess(targetType, targetId, me)
    if (!resolved) throw new NotFoundError("Target not found")
    if (resolved.level < 2) throw new ForbiddenError("You can view this item but not comment")

    const comments = $app.findCollectionByNameOrId("comments")
    const comment = new Record(comments)
    comment.set(targetType, targetId)
    comment.set("author", me)
    comment.set("body", text)
    $app.save(comment)

    return c.json(200, h.serializeComment(comment, me, resolved))
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof NotFoundError) return c.json(404, { error: "Target not found" })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to create comment:", err)
    return c.json(500, { error: "Failed to post comment" })
  }
}, $apis.requireAuth())

routerAdd("PATCH", "/api/sharing/comments/{id}", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const commentId = c.request.pathValue("id")
    const comment = h.loadComment(commentId)
    if (!comment) throw new NotFoundError("Comment not found")
    if (String(comment.get("author") || "") !== me) {
      throw new ForbiddenError("You can only edit your own comment")
    }

    const target = h.commentTarget(comment)
    if (!target || !target.record) throw new NotFoundError("Target not found")
    const resolved = access.effectiveAccess(target.type, target.id, me)
    if (!resolved) throw new NotFoundError("Target not found")
    if (resolved.level < 2) {
      throw new ForbiddenError("You can view this item but not comment")
    }

    const body = h.bodyValue(c)
    comment.set("body", h.normalizeCommentBody(body.body))
    $app.save(comment)
    return c.json(200, h.serializeComment(comment, me, resolved))
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof NotFoundError) return c.json(404, { error: "Comment not found" })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to update comment:", err)
    return c.json(500, { error: "Failed to update comment" })
  }
}, $apis.requireAuth())

routerAdd("DELETE", "/api/sharing/comments/{id}", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const commentId = c.request.pathValue("id")
    const comment = h.loadComment(commentId)
    if (!comment) throw new NotFoundError("Comment not found")

    const target = h.commentTarget(comment)
    if (!target || !target.record) throw new NotFoundError("Target not found")
    const resolved = access.effectiveAccess(target.type, target.id, me)
    if (!resolved) throw new NotFoundError("Target not found")

    const isAuthor = String(comment.get("author") || "") === me
    if (!isAuthor && resolved.level < 3) {
      throw new ForbiddenError("You cannot delete this comment")
    }

    $app.delete(comment)
    return c.json(200, { success: true })
  } catch (err) {
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof NotFoundError) return c.json(404, { error: "Comment not found" })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to delete comment:", err)
    return c.json(500, { error: "Failed to delete comment" })
  }
}, $apis.requireAuth())
