/// <reference path="../../../pb_data/types.d.ts" />

// Read surface for records another user has shared with the caller.

routerAdd("GET", "/api/sharing/shared", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    // Bounded, offset-paged list: default 50, maximum 100. The response keeps
    // `items` for existing clients and adds limit/offset/hasMore/nextOffset.
    const limit = h.queryNumber(c, "limit", 50, 1, 100)
    const offset = h.queryNumber(c, "offset", 0, 0, 100000)

    const items = []
    const seen = {}

    const addItem = (type, record, permission, level, sharedBy, id, shareId, grantId, inherited) => {
      if (!record) return
      if (seen[`${type}:${record.id}`]) return
      if (access.isDeleted(record)) return
      if (type === "board" && record.getBool("archived")) return

      const resolved = access.effectiveAccess(type, record.id, me)
      if (!resolved) return

      seen[`${type}:${record.id}`] = true
      items.push({
        id,
        shareId,
        grantId,
        type,
        permission: resolved.role || permission,
        level: resolved.level || level,
        inherited,
        sharedBy: h.serializeUser(sharedBy),
        target: h.serializeTarget(type, record),
      })
    }

    const shares = $app.findRecordsByFilter(
      "shares",
      "user = {:user}",
      "-updated",
      0,
      0,
      { user: me }
    )

    for (const share of shares) {
      const target = h.shareTarget(share)
      if (!target || !target.record) continue
      const level = Number(share.get("level") || 0)
      const permission = String(share.get("permission") || "") || access.levelPermission(level)
      const sharedBy =
        h.findUser(String(share.get("shared_by") || "")) ||
        h.findUser(String(target.record.get("author") || ""))

      addItem(
        target.type,
        target.record,
        permission,
        level,
        sharedBy,
        share.id,
        share.id,
        "",
        false
      )
    }

    const grants = $app.findRecordsByFilter(
      "access_grants",
      "user = {:user}",
      "-updated",
      0,
      0,
      { user: me }
    )

    for (const grant of grants) {
      let type = ""
      let targetId = ""
      for (const candidate of ["document", "folder", "board"]) {
        const value = String(grant.get(candidate) || "")
        if (value) {
          type = candidate
          targetId = value
          break
        }
      }
      if (!type || !targetId) continue
      if (seen[`${type}:${targetId}`]) continue

      const record = h.loadTarget(type, targetId)
      if (!record) continue

      // Only the top-most inherited folder is a useful "shared folder" entry.
      if (type === "folder") {
        const parentId = String(record.get("parent") || "")
        if (parentId && access.effectiveAccess("folder", parentId, me)) continue
      }

      const resolved = access.effectiveAccess(type, targetId, me)
      if (!resolved || resolved.source === "owner") continue

      const ancestorShare = access.findAncestorShare(type, record, me)
      const sharedBy = ancestorShare
        ? h.findUser(String(ancestorShare.get("shared_by") || ""))
        : h.findUser(String(record.get("author") || ""))

      addItem(
        type,
        record,
        resolved.role,
        resolved.level,
        sharedBy,
        grant.id,
        "",
        grant.id,
        true
      )
    }

    items.sort((a, b) => {
      const left = Date.parse(String(a.target.updated || ""))
      const right = Date.parse(String(b.target.updated || ""))
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
    })

    const page = items.slice(offset, offset + limit)
    const hasMore = items.length > offset + page.length
    return c.json(200, {
      items: page,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to list shared records:", err)
    return c.json(500, { error: "Failed to list shared records" })
  }
}, $apis.requireAuth())

routerAdd("GET", "/api/sharing/access", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const targetType = h.queryValue(c, "targetType")
    const targetId = h.queryValue(c, "targetId")
    if (!h.isShareTarget(targetType) || !targetId) {
      throw new BadRequestError("Invalid target")
    }

    const resolved = access.effectiveAccess(targetType, targetId, me)
    return c.json(200, resolved || { role: null, level: 0, source: "" })
  } catch (err) {
    if (err instanceof BadRequestError) return c.json(400, { error: String(err) })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to resolve share access:", err)
    return c.json(500, { error: "Failed to resolve access" })
  }
}, $apis.requireAuth())

routerAdd("GET", "/api/sharing/folders/{id}", (c) => {
  const h = require(`${__hooks}/routes/sharing/sharing_helpers.js`)
  const access = require(`${__hooks}/sharing/access_helpers.js`)

  try {
    const me = h.authId(c)
    const folderId = c.request.pathValue("id")
    const resolved = access.effectiveAccess("folder", folderId, me)
    if (!resolved) throw new NotFoundError("Folder not found")

    const folder = h.loadTarget("folder", folderId)
    if (!folder) throw new NotFoundError("Folder not found")

    const visible = (type, record) => Boolean(access.effectiveAccess(type, record.id, me))
    const folders = $app.findRecordsByFilter(
      "folders",
      "parent = {:parent} && deleted_at = ''",
      "+name",
      0,
      0,
      { parent: folderId }
    ).filter((item) => visible("folder", item))

    const documents = $app.findRecordsByFilter(
      "documents",
      "folder = {:folder} && deleted_at = ''",
      "+title",
      0,
      0,
      { folder: folderId }
    ).filter((item) => visible("document", item))

    const boards = $app.findRecordsByFilter(
      "boards",
      "folder = {:folder} && archived = false",
      "+name",
      0,
      0,
      { folder: folderId }
    ).filter((item) => visible("board", item))

    let parent = null
    const parentId = String(folder.get("parent") || "")
    if (parentId) {
      const parentAccess = access.effectiveAccess("folder", parentId, me)
      const parentRecord = parentAccess ? h.loadTarget("folder", parentId) : null
      if (parentRecord) {
        parent = h.serializeTarget("folder", parentRecord)
      }
    }

    return c.json(200, {
      folder: h.serializeTarget("folder", folder),
      permission: resolved.role,
      access: resolved,
      owner: h.serializeUser(h.findUser(String(folder.get("author") || ""))),
      parent,
      folders: folders.map((item) => h.serializeTarget("folder", item)),
      documents: documents.map((item) => h.serializeTarget("document", item)),
      boards: boards.map((item) => h.serializeTarget("board", item)),
    })
  } catch (err) {
    if (err instanceof NotFoundError) return c.json(404, { error: "Folder not found" })
    if (err instanceof UnauthorizedError) return c.json(401, { error: "Authentication required" })
    console.error("Failed to load shared folder:", err)
    return c.json(500, { error: "Failed to load shared folder" })
  }
}, $apis.requireAuth())
