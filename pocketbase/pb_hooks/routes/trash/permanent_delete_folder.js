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

        const root = $app.findRecordById("trash_folders", trashFolderId)
        h.assertOwned(root, userId, "Trash folder")

        const collectTrashTree = (folderRecord) => {
            const items = [folderRecord]
            const children = $app.findRecordsByFilter("trash_folders", `parent = "${folderRecord.id}"`, "")
            for (const child of children) {
                const nested = collectTrashTree(child)
                for (const item of nested) {
                    items.push(item)
                }
            }
            return items
        }

        const tree = collectTrashTree(root)
        const folderIds = tree.map((item) => item.id)
        const trashDocs = $app.findRecordsByFilter("trash_documents", `author = "${userId}"`, "")

        for (const trashDoc of trashDocs) {
            if (!folderIds.includes(String(trashDoc.get("folder") || ""))) {
                continue
            }

            const originalDocumentId = String(trashDoc.get("original_document_id") || "").trim()
            if (originalDocumentId) {
                try {
                    const originalDocument = $app.findRecordById("documents", originalDocumentId)
                    h.assertOwned(originalDocument, userId, "Document")
                    $app.delete(originalDocument)
                } catch (_) {
                    // Original already removed, continue cleanup.
                }
            }

            h.permanentlyDeleteTrashVersions(trashDoc.id)
            $app.delete(trashDoc)
        }

        for (let i = tree.length - 1; i >= 0; i -= 1) {
            $app.delete(tree[i])
        }

        return c.json(200, { success: true })
    } catch (err) {
        console.error("Failed to permanently delete trash folder:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
