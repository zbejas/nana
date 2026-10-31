/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/permanent-delete-folder", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashFolderId = String(body.trashFolderId || "").trim()
        if (!trashFolderId) {
            throw new BadRequestError("trashFolderId is required")
        }

        h.permanentlyDeleteFolderTree(trashFolderId, userId)
        return c.json(200, { success: true })
    } catch (err) {
        console.error("Failed to permanently delete trash folder:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
