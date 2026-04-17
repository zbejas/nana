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

        const rootTrashFolder = $app.findRecordById("trash_folders", trashFolderId)
        h.assertOwned(rootTrashFolder, userId, "Trash folder")

        const collectTrashTree = (folderRecord) => {
            const items = [folderRecord]
            const children = $app.findRecordsByFilter("trash_folders", `parent = "${folderRecord.id}"`, "+created")
            for (const child of children) {
                const nested = collectTrashTree(child)
                for (const item of nested) {
                    items.push(item)
                }
            }
            return items
        }

        const tree = collectTrashTree(rootTrashFolder)
        const restoredFolderMap = {}
        const foldersCollection = $app.findCollectionByNameOrId("folders")

        for (const trashFolder of tree) {
            const trashParentId = String(trashFolder.get("parent") || "")
            const originalParentId = String(trashFolder.get("original_parent_folder_id") || "")

            let restoreParentId = ""
            if (trashParentId && restoredFolderMap[trashParentId]) {
                restoreParentId = restoredFolderMap[trashParentId]
            } else if (originalParentId) {
                try {
                    const existingParent = $app.findRecordById("folders", originalParentId)
                    if (existingParent) {
                        restoreParentId = existingParent.id
                    }
                } catch (_) {
                    restoreParentId = ""
                }
            }

            const restoredFolder = new Record(foldersCollection)
            h.copyFields(trashFolder, restoredFolder, {
                author: userId,
                parent: restoreParentId,
                published: false,
            })
            $app.save(restoredFolder)

            restoredFolderMap[trashFolder.id] = restoredFolder.id
        }

        const restoredDocumentIds = []
        const trashDocs = $app.findRecordsByFilter("trash_documents", `author = "${userId}"`, "")
        for (const trashDoc of trashDocs) {
            const trashDocFolderId = String(trashDoc.get("folder") || "")
            if (!trashDocFolderId || !restoredFolderMap[trashDocFolderId]) {
                continue
            }

            const targetFolderId = restoredFolderMap[trashDocFolderId]
            const originalDocumentId = String(trashDoc.get("original_document_id") || "").trim()
            let restoredDocument = null
            let originalDocument = null

            if (originalDocumentId) {
                try {
                    originalDocument = $app.findRecordById("documents", originalDocumentId)
                    h.assertOwned(originalDocument, userId, "Document")
                } catch (_) {
                    originalDocument = null
                }
            }

            if (originalDocument) {
                h.copyFields(trashDoc, originalDocument, {
                    attachments: [],
                    published: false,
                    folder: targetFolderId,
                })
                h.saveRecordWithClonedAttachments(trashDoc, originalDocument)
                restoredDocument = originalDocument
            }

            if (!restoredDocument) {
                const activeDocsCollection = $app.findCollectionByNameOrId("documents")
                restoredDocument = new Record(activeDocsCollection)
                h.copyFields(trashDoc, restoredDocument, {
                    attachments: [],
                    author: userId,
                    published: false,
                    folder: targetFolderId,
                })
                h.saveRecordWithClonedAttachments(trashDoc, restoredDocument)
            }

            restoredDocumentIds.push(restoredDocument.id)
            h.restoreDocumentVersions(trashDoc.id, restoredDocument.id)
            $app.delete(trashDoc)
        }

        for (let i = tree.length - 1; i >= 0; i -= 1) {
            $app.delete(tree[i])
        }

        return c.json(200, { success: true, restoredDocumentIds })
    } catch (err) {
        console.error("Failed to restore folder from trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
