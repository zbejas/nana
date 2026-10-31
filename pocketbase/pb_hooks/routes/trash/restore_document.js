/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/restore-document", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashDocumentId = String(body.trashDocumentId || "").trim()
        if (!trashDocumentId) {
            throw new BadRequestError("trashDocumentId is required")
        }

        const restored = h.restoreDocumentById(trashDocumentId, userId)
        return c.json(200, restored)
    } catch (err) {
        console.error("Failed to restore document from trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
