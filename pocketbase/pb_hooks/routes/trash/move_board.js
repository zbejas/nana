/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/move-board", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const boardId = String(body.boardId || "").trim()
        if (!boardId) {
            throw new BadRequestError("boardId is required")
        }

        const board = h.moveBoardToTrashById(boardId, userId)
        return c.json(200, { boardId: board.id })
    } catch (err) {
        console.error("Failed to move board to trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
