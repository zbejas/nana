/// <reference path="../../../pb_data/types.d.ts" />

routerAdd("POST", "/api/trash/permanent-delete-document", (c) => {
    const h = require(`${__hooks}/routes/trash_helpers.js`)

    try {
        const userId = h.getAuthUserId(c)
        const body = h.parseBody(c)
        const trashDocumentId = String(body.trashDocumentId || "").trim()
        if (!trashDocumentId) {
            throw new BadRequestError("trashDocumentId is required")
        }

        const trashDocument = $app.findRecordById("trash_documents", trashDocumentId)
        h.assertOwned(trashDocument, userId, "Trash document")

        const originalDocumentId = String(trashDocument.get("original_document_id") || "").trim()
        if (originalDocumentId) {
            try {
                const originalDocument = $app.findRecordById("documents", originalDocumentId)
                h.assertOwned(originalDocument, userId, "Document")
                $app.delete(originalDocument)
            } catch (_) {
                // Original already removed, continue cleanup.
            }
        }

        h.permanentlyDeleteTrashVersions(trashDocument.id)
        $app.delete(trashDocument)

        return c.json(200, { success: true })
    } catch (err) {
        console.error("Failed to permanently delete trash document:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
