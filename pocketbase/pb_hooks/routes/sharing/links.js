/// <reference path="../../../pb_data/types.d.ts" />

// Direct user share management. Only the target owner can create, change, or
// remove a grant. Folder changes rebuild inherited access for the subtree.
//
// Share mutation and grant rebuild run in one transaction: a failed rebuild
// must roll the share back instead of leaving stale access behind.

routerAdd("GET", "/api/sharing/links", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)

  try {
    const me = h.authId(c)
    const targetType = h.queryValue(c, "targetType")
    const targetId = h.queryValue(c, "targetId")
    h.assertTargetOwner(targetType, targetId, me)

    const shares = h.sharesForTarget(targetType, targetId)
    return c.json(200, {
      items: shares.map((share) => h.serializeShare(share)),
    })
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to list shares:", err)
    return c.json(500, { error: "Failed to list shares" })
  }
}, $apis.requireAuth())

routerAdd("POST", "/api/sharing/links", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const body = h.bodyValue(c)
    const targetType = String(body.targetType || "").trim()
    const targetId = String(body.targetId || "").trim()
    const userId = String(body.userId || "").trim()
    const permission = h.validatePermission(body.permission)

    if (!h.isShareTarget(targetType) || !targetId) {
      throw new BadRequestError("Invalid share target")
    }
    if (!userId) throw new BadRequestError("Choose a user")
    if (userId === me) throw new BadRequestError("You already own this record")

    const user = h.findUser(userId)
    if (!user) throw new BadRequestError("User not found")

    let shareId = ""
    $app.runInTransaction((txApp) => {
      const target = h.assertTargetOwner(targetType, targetId, me, txApp)
      h.assertTargetShareable(targetType, target, txApp)

      let share = h.findDirectShare(targetType, targetId, userId, txApp)
      if (!share) {
        const collection = txApp.findCollectionByNameOrId("shares")
        share = new Record(collection)
        share.set(targetType, targetId)
        share.set("user", userId)
        share.set("shared_by", me)
      }

      share.set("permission", permission)
      share.set("level", access.permissionLevel(permission))
      txApp.save(share)
      shareId = share.id

      access.rebuildForDirectShare(targetType, targetId, txApp)
    })

    const saved = h.loadShare(shareId)
    if (!saved) throw new Error("Share disappeared after save")
    return c.json(200, h.serializeShare(saved))
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to save share:", err)
    return c.json(500, { error: "Failed to save share" })
  }
}, $apis.requireAuth())

routerAdd("DELETE", "/api/sharing/links/{id}", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const shareId = c.request.pathValue("id")

    $app.runInTransaction((txApp) => {
      const share = h.loadShare(shareId, txApp)
      if (!share) throw new BadRequestError("Share not found")

      const target = h.shareTarget(share, txApp)
      if (!target || !target.record) throw new BadRequestError("Share target not found")
      h.assertTargetOwner(target.type, target.id, me, txApp)

      txApp.delete(share)
      access.rebuildForDirectShare(target.type, target.id, txApp)
    })

    return c.json(200, { success: true })
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to delete share:", err)
    return c.json(500, { error: "Failed to delete share" })
  }
}, $apis.requireAuth())
