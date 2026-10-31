/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/restore-board", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashBoardId = String(body.trashBoardId || "").trim()
        if (!trashBoardId) {
            throw new BadRequestError("trashBoardId is required")
        }

        const restored = h.restoreBoardById(trashBoardId, userId)
        return c.json(200, restored)
    } catch (err) {
        console.error("Failed to restore board from trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
