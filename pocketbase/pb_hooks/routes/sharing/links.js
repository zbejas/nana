/// <reference path="../../../pb_data/types.d.ts" />

// Direct user share management. Only the target owner can create, change, or
// remove a grant. Folder changes rebuild inherited access for the subtree.

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

    const target = h.assertTargetOwner(targetType, targetId, me)
    h.assertTargetShareable(targetType, target)

    if (!userId) throw new BadRequestError("Choose a user")
    if (userId === me) throw new BadRequestError("You already own this record")

    const user = h.findUser(userId)
    if (!user) throw new BadRequestError("User not found")

    let share = h.findDirectShare(targetType, targetId, userId)
    if (!share) {
      const collection = $app.findCollectionByNameOrId("shares")
      share = new Record(collection)
      share.set(targetType, targetId)
      share.set("user", userId)
      share.set("shared_by", me)
    }

    share.set("permission", permission)
    share.set("level", access.permissionLevel(permission))
    $app.save(share)

    access.rebuildForDirectShare(targetType, targetId)

    return c.json(200, h.serializeShare(share))
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
    const share = h.loadShare(shareId)
    if (!share) throw new BadRequestError("Share not found")

    const target = h.shareTarget(share)
    if (!target) throw new BadRequestError("Share target not found")
    h.assertTargetOwner(target.type, target.id, me)

    $app.delete(share)
    access.rebuildForDirectShare(target.type, target.id)

    return c.json(200, { success: true })
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof ForbiddenError) return c.json(403, { error: String(err) })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to delete share:", err)
    return c.json(500, { error: "Failed to delete share" })
  }
}, $apis.requireAuth())
