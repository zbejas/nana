import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    BASE_URL,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
    signupUser,
} from "../../helpers/setup";

const TRASH_API = `${PB_API}/trash`;

describe("Trash Routes", () => {
    let superuserToken: string;
    let userToken: string;
    let userId: string;

    let userBToken: string;
    let userBId: string;

    let docCounter = 0;
    let folderCounter = 0;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Create primary test user
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='trash-route-test@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = await listRes.json();
        if (listData.items.length === 0) {
            const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
                headers: { Authorization: superuserToken },
            });
            const checkData = await checkRes.json();
            if (checkData.items.length === 0) {
                await signupUser({ email: "first@test.local", password: "testPassword123!" });
            }
            await createTestUser(superuserToken, {
                email: "trash-route-test@test.local",
                password: "testPassword123!",
                name: "Trash Route Test User",
            });
        }

        const authA = await authenticateUser("trash-route-test@test.local", "testPassword123!");
        userToken = authA.token;
        userId = authA.record.id;

        // Create secondary test user for ownership tests
        const listResB = await fetch(
            `${PB_API}/collections/users/records?filter=(email='trash-route-other@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listDataB = await listResB.json();
        if (listDataB.items.length === 0) {
            await createTestUser(superuserToken, {
                email: "trash-route-other@test.local",
                password: "testPassword123!",
                name: "Trash Route Other User",
            });
        }

        const authB = await authenticateUser("trash-route-other@test.local", "testPassword123!");
        userBToken = authB.token;
        userBId = authB.record.id;
    });

    // --- Helpers ---

    async function createDocument(
        title: string,
        content: string,
        opts?: { folder?: string; token?: string; authorId?: string },
    ): Promise<any> {
        docCounter++;
        const slug = `trash-test-doc-${Date.now()}-${docCounter}`;
        const body: any = {
            title,
            slug,
            content,
            author: opts?.authorId ?? userId,
        };
        if (opts?.folder) body.folder = opts.folder;

        const res = await fetch(`${PB_API}/collections/documents/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: opts?.token ?? userToken,
            },
            body: JSON.stringify(body),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function publishDocument(docId: string): Promise<any> {
        const res = await fetch(`${PB_API}/collections/documents/records/${docId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify({ published: true }),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function createFolder(name: string, parentId?: string): Promise<any> {
        folderCounter++;
        const body: any = { name, author: userId };
        if (parentId) body.parent = parentId;

        const res = await fetch(`${PB_API}/collections/folders/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify(body),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function recordExists(collection: string, id: string): Promise<boolean> {
        const res = await fetch(`${PB_API}/collections/${collection}/records/${id}`, {
            headers: { Authorization: superuserToken },
        });
        return res.ok;
    }

    async function getTrashDocByOriginalId(originalDocId: string): Promise<any | null> {
        const res = await fetch(
            `${PB_API}/collections/trash_documents/records?filter=(original_document_id='${originalDocId}')`,
            { headers: { Authorization: superuserToken } },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.items.length > 0 ? data.items[0] : null;
    }

    async function getTrashFolderByOriginalId(originalFolderId: string): Promise<any | null> {
        const res = await fetch(
            `${PB_API}/collections/trash_folders/records?filter=(original_folder_id='${originalFolderId}')`,
            { headers: { Authorization: superuserToken } },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.items.length > 0 ? data.items[0] : null;
    }

    async function getVersions(docId: string, collection = "document_versions"): Promise<any[]> {
        const filterField = collection === "trash_document_versions" ? "trash_document" : "document";
        const res = await fetch(
            `${PB_API}/collections/${collection}/records?filter=(${filterField}='${docId}')`,
            { headers: { Authorization: superuserToken } },
        );
        if (!res.ok) return [];
        const data = await res.json();
        return data.items;
    }

    // --- Document Trash Lifecycle ---

    describe("Document trash lifecycle", () => {
        test("move document to trash — original deleted, trash record created", async () => {
            const doc = await createDocument("Trash Me", "Some content to trash");

            const res = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ documentId: doc.id }),
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.trashDocumentId).toBeTruthy();

            // Original should be gone
            expect(await recordExists("documents", doc.id)).toBe(false);

            // Trash record should exist
            expect(await recordExists("trash_documents", data.trashDocumentId)).toBe(true);
        });

        test("restore document from trash — document restored, trash record deleted", async () => {
            const doc = await createDocument("Restore Me", "Content to restore");

            // Move to trash
            const moveRes = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ documentId: doc.id }),
            });
            const moveData = await moveRes.json();

            // Restore
            const restoreRes = await fetch(`${TRASH_API}/restore-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ trashDocumentId: moveData.trashDocumentId }),
            });

            expect(restoreRes.status).toBe(200);
            const restoreData = await restoreRes.json();
            expect(restoreData.documentId).toBeTruthy();

            // Document should exist again
            expect(await recordExists("documents", restoreData.documentId)).toBe(true);

            // Trash record should be gone
            expect(await recordExists("trash_documents", moveData.trashDocumentId)).toBe(false);
        });

        test("permanent delete — both trash and original are gone", async () => {
            const doc = await createDocument("Delete Forever", "Permanent delete content");

            // Move to trash
            const moveRes = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ documentId: doc.id }),
            });
            const moveData = await moveRes.json();

            // Permanent delete
            const deleteRes = await fetch(`${TRASH_API}/permanent-delete-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ trashDocumentId: moveData.trashDocumentId }),
            });

            expect(deleteRes.status).toBe(200);
            const deleteData = await deleteRes.json();
            expect(deleteData.success).toBe(true);

            // Both should be gone
            expect(await recordExists("documents", doc.id)).toBe(false);
            expect(await recordExists("trash_documents", moveData.trashDocumentId)).toBe(false);
        });
    });

    // --- Document Version Preservation ---

    describe("Document version preservation", () => {
        test("versions move to trash and restore back with document", async () => {
            const doc = await createDocument("Versioned Doc", "Version 1 content");

            // Publish to create a version
            await publishDocument(doc.id);

            // Verify version exists
            const versionsBeforeTrash = await getVersions(doc.id, "document_versions");
            expect(versionsBeforeTrash.length).toBeGreaterThanOrEqual(1);

            // Move to trash
            const moveRes = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ documentId: doc.id }),
            });
            expect(moveRes.status).toBe(200);
            const moveData = await moveRes.json();

            // Original versions should be gone
            const versionsAfterTrash = await getVersions(doc.id, "document_versions");
            expect(versionsAfterTrash.length).toBe(0);

            // Trash versions should exist
            const trashVersions = await getVersions(moveData.trashDocumentId, "trash_document_versions");
            expect(trashVersions.length).toBeGreaterThanOrEqual(1);

            // Restore
            const restoreRes = await fetch(`${TRASH_API}/restore-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ trashDocumentId: moveData.trashDocumentId }),
            });
            expect(restoreRes.status).toBe(200);
            const restoreData = await restoreRes.json();

            // Restored document should have versions again
            const restoredVersions = await getVersions(restoreData.documentId, "document_versions");
            expect(restoredVersions.length).toBeGreaterThanOrEqual(1);

            // Trash versions should be gone
            const trashVersionsAfter = await getVersions(moveData.trashDocumentId, "trash_document_versions");
            expect(trashVersionsAfter.length).toBe(0);
        });
    });

    // --- Folder Trash Lifecycle ---

    describe("Folder trash lifecycle", () => {
        test("move folder with documents to trash — folder and docs removed from originals", async () => {
            const folder = await createFolder(`TrashFolder-${Date.now()}`);
            const doc1 = await createDocument("Folder Doc 1", "Content 1", { folder: folder.id });
            const doc2 = await createDocument("Folder Doc 2", "Content 2", { folder: folder.id });

            const res = await fetch(`${TRASH_API}/move-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ folderId: folder.id }),
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.trashFolderId).toBeTruthy();
            expect(data.movedDocumentIds).toBeArray();
            expect(data.movedDocumentIds.length).toBe(2);

            // Originals should be gone
            expect(await recordExists("folders", folder.id)).toBe(false);
            expect(await recordExists("documents", doc1.id)).toBe(false);
            expect(await recordExists("documents", doc2.id)).toBe(false);

            // Trash records should exist
            expect(await recordExists("trash_folders", data.trashFolderId)).toBe(true);
            const trashDoc1 = await getTrashDocByOriginalId(doc1.id);
            expect(trashDoc1).not.toBeNull();
            const trashDoc2 = await getTrashDocByOriginalId(doc2.id);
            expect(trashDoc2).not.toBeNull();
        });

        test("restore folder — folder and documents restored", async () => {
            const folder = await createFolder(`RestoreFolder-${Date.now()}`);
            const doc = await createDocument("Restore Folder Doc", "Folder content", {
                folder: folder.id,
            });

            // Move to trash
            const moveRes = await fetch(`${TRASH_API}/move-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ folderId: folder.id }),
            });
            const moveData = await moveRes.json();

            // Restore
            const restoreRes = await fetch(`${TRASH_API}/restore-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ trashFolderId: moveData.trashFolderId }),
            });

            expect(restoreRes.status).toBe(200);
            const restoreData = await restoreRes.json();
            expect(restoreData.success).toBe(true);
            expect(restoreData.restoredDocumentIds).toBeArray();
            expect(restoreData.restoredDocumentIds.length).toBe(1);

            // Trash records should be gone
            expect(await recordExists("trash_folders", moveData.trashFolderId)).toBe(false);

            // A document should be restored (may have a new ID)
            const restoredDocId = restoreData.restoredDocumentIds[0];
            expect(await recordExists("documents", restoredDocId)).toBe(true);
        });

        test("permanent delete folder — everything is gone", async () => {
            const folder = await createFolder(`PermDeleteFolder-${Date.now()}`);
            const doc = await createDocument("PermDelete Folder Doc", "Gone forever", {
                folder: folder.id,
            });

            // Move to trash
            const moveRes = await fetch(`${TRASH_API}/move-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ folderId: folder.id }),
            });
            const moveData = await moveRes.json();

            // Permanent delete
            const deleteRes = await fetch(`${TRASH_API}/permanent-delete-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ trashFolderId: moveData.trashFolderId }),
            });

            expect(deleteRes.status).toBe(200);
            const deleteData = await deleteRes.json();
            expect(deleteData.success).toBe(true);

            // All trash records should be gone
            expect(await recordExists("trash_folders", moveData.trashFolderId)).toBe(false);
            const trashDoc = await getTrashDocByOriginalId(doc.id);
            expect(trashDoc).toBeNull();

            // Originals should also be gone
            expect(await recordExists("documents", doc.id)).toBe(false);
            expect(await recordExists("folders", folder.id)).toBe(false);
        });
    });

    // --- Nested Folder Handling ---

    describe("Nested folder handling", () => {
        test("move parent folder trashes entire tree including nested docs", async () => {
            const parent = await createFolder(`NestedParent-${Date.now()}`);
            const child = await createFolder(`NestedChild-${Date.now()}`, parent.id);
            const docInChild = await createDocument("Nested Doc", "Deep content", {
                folder: child.id,
            });

            const res = await fetch(`${TRASH_API}/move-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({ folderId: parent.id }),
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.trashFolderId).toBeTruthy();
            expect(data.movedDocumentIds).toContain(docInChild.id);

            // All originals should be gone
            expect(await recordExists("folders", parent.id)).toBe(false);
            expect(await recordExists("folders", child.id)).toBe(false);
            expect(await recordExists("documents", docInChild.id)).toBe(false);

            // Trash records should exist
            expect(await recordExists("trash_folders", data.trashFolderId)).toBe(true);
            const trashChild = await getTrashFolderByOriginalId(child.id);
            expect(trashChild).not.toBeNull();
            const trashDoc = await getTrashDocByOriginalId(docInChild.id);
            expect(trashDoc).not.toBeNull();
        });
    });

    // --- Auth / Ownership Enforcement ---

    describe("Auth and ownership enforcement", () => {
        test("cannot trash another user's document", async () => {
            // Create document as user A
            const doc = await createDocument("User A Doc", "Owned by A");

            // Try to trash it as user B
            const res = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userBToken,
                },
                body: JSON.stringify({ documentId: doc.id }),
            });

            // Should fail (assertOwned check)
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBeTruthy();

            // Document should still exist
            expect(await recordExists("documents", doc.id)).toBe(true);
        });

        test("unauthenticated request returns 401", async () => {
            const res = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: "fake-id" }),
            });

            expect(res.status).toBe(401);
        });

        test("missing documentId returns error", async () => {
            const res = await fetch(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBeTruthy();
        });

        test("missing trashDocumentId on restore returns error", async () => {
            const res = await fetch(`${TRASH_API}/restore-document`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBeTruthy();
        });

        test("missing folderId on move-folder returns error", async () => {
            const res = await fetch(`${TRASH_API}/move-folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: userToken,
                },
                body: JSON.stringify({}),
            });

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBeTruthy();
        });
    });
});
