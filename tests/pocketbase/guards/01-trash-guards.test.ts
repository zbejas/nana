import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbFindFirst, pbList, pbRequest, readJson } from "../../helpers/client";
import {
    createFolder,
    createNote,
    createUser,
    getSuperuserToken,
    publishNote,
    type TestUser,
} from "../../helpers/factories";

const TRASH_COLLECTIONS = ["trash_documents", "trash_folders", "trash_document_versions"] as const;

describe("Trash collection guards", () => {
    let user: TestUser;
    let superuserToken: string;
    let trashDocumentId: string;
    let trashFolderId: string;
    let trashVersionId: string;

    beforeAll(async () => {
        user = await createUser("trash-guards");
        superuserToken = await getSuperuserToken();

        const note = await createNote(user, { title: "Guarded note" });
        await publishNote(user, note.id);
        const moveDocRes = await pbRequest("/trash/move-document", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({ documentId: note.id }),
        });
        await expectStatus(moveDocRes, 200, "move note to trash");
        const moved = await readJson<{ trashDocumentId: string }>(moveDocRes);
        trashDocumentId = moved.trashDocumentId;

        const trashVersion = await pbFindFirst<{ id: string }>(
            superuserToken,
            "trash_document_versions",
            `trash_document='${trashDocumentId}'`,
        );
        if (!trashVersion) throw new Error("Expected a trash version fixture");
        trashVersionId = trashVersion.id;

        const folder = await createFolder(user, { name: "Guarded folder" });
        const moveFolderRes = await pbRequest("/trash/move-folder", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: folder.id }),
        });
        await expectStatus(moveFolderRes, 200, "move folder to trash");
        trashFolderId = (await readJson<{ trashFolderId: string }>(moveFolderRes)).trashFolderId;
    });

    describe("direct writes are blocked", () => {
        test("regular user cannot create trash records", async () => {
            for (const collection of TRASH_COLLECTIONS) {
                const res = await pbRequest(`/collections/${collection}/records`, {
                    method: "POST",
                    headers: { Authorization: user.token, "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                await expectStatus(res, 400, `create ${collection}`);
            }
        });

        test("regular user cannot update a trashed document", async () => {
            const res = await pbRequest(`/collections/trash_documents/records/${trashDocumentId}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Changed" }),
            });

            await expectStatus(res, 400, "update trashed note");
            expect(await readJson<{ message?: string }>(res)).toHaveProperty("message");
        });

        test("regular user cannot delete a trashed document", async () => {
            const res = await pbRequest(`/collections/trash_documents/records/${trashDocumentId}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            });

            await expectStatus(res, 400, "delete trashed note");
        });

        test("regular user cannot update or delete a trashed folder", async () => {
            const updateRes = await pbRequest(`/collections/trash_folders/records/${trashFolderId}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Changed" }),
            });
            await expectStatus(updateRes, 400, "update trashed folder");

            const deleteRes = await pbRequest(`/collections/trash_folders/records/${trashFolderId}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            });
            await expectStatus(deleteRes, 400, "delete trashed folder");
        });

        test("regular user cannot update or delete a trashed version", async () => {
            const updateRes = await pbRequest(
                `/collections/trash_document_versions/records/${trashVersionId}`,
                {
                    method: "PATCH",
                    headers: { Authorization: user.token, "Content-Type": "application/json" },
                    body: JSON.stringify({ content: "Changed" }),
                },
            );
            // The collection rule and the request guard both deny this path.
            expect([400, 404]).toContain(updateRes.status);

            const deleteRes = await pbRequest(
                `/collections/trash_document_versions/records/${trashVersionId}`,
                {
                    method: "DELETE",
                    headers: { Authorization: user.token },
                },
            );
            expect([400, 404]).toContain(deleteRes.status);
        });

        test("unauthenticated users cannot create trash records", async () => {
            for (const collection of TRASH_COLLECTIONS) {
                const res = await pbRequest(`/collections/${collection}/records`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                expect(res.ok).toBe(false);
                expect([400, 403]).toContain(res.status);
            }
        });
    });

    test("trash records remain visible only to their owner", async () => {
        const other = await createUser("trash-guards-other");
        const docs = await pbList<{ id: string }>(other.token, "trash_documents");
        const folders = await pbList<{ id: string }>(other.token, "trash_folders");

        expect(docs.items).toEqual([]);
        expect(folders.items).toEqual([]);
    });
});
