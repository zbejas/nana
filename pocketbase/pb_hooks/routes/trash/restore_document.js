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

        const trashDocument = $app.findRecordById("trash_documents", trashDocumentId)
        h.assertOwned(trashDocument, userId, "Trash document")

        const originalFolderId = String(trashDocument.get("original_folder_id") || "").trim()
        let restoreFolderId = ""
        if (originalFolderId) {
            try {
                const originalFolder = $app.findRecordById("folders", originalFolderId)
                if (originalFolder) {
                    restoreFolderId = originalFolderId
                }
            } catch (_) {
                restoreFolderId = ""
            }
        }

        const originalDocumentId = String(trashDocument.get("original_document_id") || "").trim()
        let restoredDocument = null

        if (originalDocumentId) {
            try {
                const originalDocument = $app.findRecordById("documents", originalDocumentId)
                h.assertOwned(originalDocument, userId, "Document")
                h.copyFields(trashDocument, originalDocument, {
                    published: false,
                    folder: restoreFolderId,
                })
                $app.save(originalDocument)
                restoredDocument = originalDocument
            } catch (_) {
                restoredDocument = null
            }
        }

        if (!restoredDocument) {
            const documentsCollection = $app.findCollectionByNameOrId("documents")
            restoredDocument = new Record(documentsCollection)
            h.copyFields(trashDocument, restoredDocument, {
                attachments: [],
                author: userId,
                published: false,
                folder: restoreFolderId,
            })
            $app.save(restoredDocument)
        }

        h.restoreDocumentVersions(trashDocument.id, restoredDocument.id)
        $app.delete(trashDocument)

        return c.json(200, { documentId: restoredDocument.id, folderId: restoreFolderId || null })
    } catch (err) {
        console.error("Failed to restore document from trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
