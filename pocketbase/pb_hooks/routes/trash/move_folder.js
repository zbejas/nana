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

        const folder = $app.findRecordById("folders", folderId)
        h.assertOwned(folder, userId, "Folder")

        const deletedAt = new Date().toISOString()
        const nodes = h.collectFolderTree(folder)
        const trashCollection = $app.findCollectionByNameOrId("trash_folders")
        const folderMap = {}

        for (const node of nodes) {
            const parentId = String(node.get("parent") || "")
            const mappedParent = parentId && folderMap[parentId] ? folderMap[parentId] : ""
            const trashFolder = new Record(trashCollection)
            h.copyFields(node, trashFolder, {
                author: userId,
                original_folder_id: node.id,
                original_parent_folder_id: parentId,
                parent: mappedParent,
                deleted_by: userId,
                deleted: true,
                deleted_at: deletedAt,
            })
            $app.save(trashFolder)
            folderMap[node.id] = trashFolder.id
        }

        const movedDocumentIds = []
        for (const node of nodes) {
            const docs = $app.findRecordsByFilter("documents", `folder = "${node.id}"`, "")
            for (const doc of docs) {
                movedDocumentIds.push(doc.id)
                h.moveDocumentToTrashById(doc.id, userId, {
                    deletedAt,
                    targetTrashFolderId: folderMap[node.id] || "",
                })
            }
        }

        for (let i = nodes.length - 1; i >= 0; i -= 1) {
            $app.delete(nodes[i])
        }

        return c.json(200, { trashFolderId: folderMap[folder.id] || null, movedDocumentIds })
    } catch (err) {
        console.error("Failed to move folder to trash:", err)
        return c.json(400, { error: String(err) })
    }
}, $apis.requireAuth())
