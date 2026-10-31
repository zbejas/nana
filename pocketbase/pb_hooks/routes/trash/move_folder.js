/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/move-folder", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const folderId = String(body.folderId || "").trim()
        if (!folderId) {
            throw new BadRequestError("folderId is required")
        }

        const moved = h.moveFolderToTrash(folderId, userId)
        return c.json(200, {
            trashFolderId: moved.folderId,
            movedDocumentIds: moved.documentIds,
            movedBoardIds: moved.movedBoardIds,
        })
    } catch (err) {
        console.error("Failed to move folder to trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
