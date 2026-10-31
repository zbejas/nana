/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/permanent-delete-board", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashBoardId = String(body.trashBoardId || "").trim()
        if (!trashBoardId) {
            throw new BadRequestError("trashBoardId is required")
        }

        h.permanentlyDeleteBoardById(trashBoardId, userId)
        return c.json(200, { success: true })
    } catch (err) {
        console.error("Failed to permanently delete trash board:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
