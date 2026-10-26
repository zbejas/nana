/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/restore-folder", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashFolderId = String(body.trashFolderId || "").trim()
        if (!trashFolderId) {
            throw new BadRequestError("trashFolderId is required")
        }

        const restored = h.restoreFolderTree(trashFolderId, userId)
        return c.json(200, {
            success: true,
            folderId: restored.folderId,
            restoredDocumentIds: restored.restoredDocumentIds,
        })
    } catch (err) {
        console.error("Failed to restore folder from trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
