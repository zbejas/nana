/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/move-document", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const documentId = String(body.documentId || "").trim()
        if (!documentId) {
            throw new BadRequestError("documentId is required")
        }

        const trashDocument = h.moveDocumentToTrashById(documentId, userId)
        return c.json(200, { trashDocumentId: trashDocument.id })
    } catch (err) {
        console.error("Failed to move document to trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
