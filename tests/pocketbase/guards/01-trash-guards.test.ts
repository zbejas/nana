import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbList, pbRequest } from "../../helpers/client";
import {
    createFolder,
    createNote,
    createUser,
    getSuperuserToken,
    publishNote,
    type TestUser,
} from "../../helpers/factories";

describe("Trash collection guards", () => {
    let user: TestUser;
    let other: TestUser;
    let superuserToken: string;
    let noteId: string;
    let folderId: string;

    beforeAll(async () => {
        user = await createUser("trash-guards");
        other = await createUser("trash-guards-other");
        superuserToken = await getSuperuserToken();

        const note = await createNote(user, { title: "Guarded note" });
        noteId = note.id;
        await publishNote(user, note.id);
        const moveDocRes = await pbRequest("/trash/move-document", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({ documentId: note.id }),
        });
        await expectStatus(moveDocRes, 200, "move note to trash");

        const folder = await createFolder(user, { name: "Guarded folder" });
        folderId = folder.id;
        const moveFolderRes = await pbRequest("/trash/move-folder", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: folder.id }),
        });
        await expectStatus(moveFolderRes, 200, "move folder to trash");
    });

    describe("trash is a read-only view over the live collections", () => {
        test("regular users cannot create trash records", async () => {
            for (const collection of ["trash_documents", "trash_folders"]) {
                const res = await pbRequest(`/collections/${collection}/records`, {
                    method: "POST",
                    headers: { Authorization: user.token, "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                expect(res.ok).toBe(false);
                expect([400, 403, 404, 405]).toContain(res.status);
            }
        });

        test("regular users cannot update or delete a trashed document", async () => {
            const updateRes = await pbRequest(`/collections/trash_documents/records/${noteId}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Changed" }),
            });
            expect(updateRes.ok).toBe(false);
            expect([400, 403, 404, 405]).toContain(updateRes.status);

            const deleteRes = await pbRequest(`/collections/trash_documents/records/${noteId}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            });
            expect(deleteRes.ok).toBe(false);
            expect([400, 403, 404, 405]).toContain(deleteRes.status);
        });

        test("regular users cannot update or delete a trashed folder", async () => {
            for (const init of [
                {
                    method: "PATCH",
                    headers: { Authorization: user.token, "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "Changed" }),
                },
                { method: "DELETE", headers: { Authorization: user.token } },
            ]) {
                const res = await pbRequest(
                    `/collections/trash_folders/records/${folderId}`,
                    init,
                );
                expect(res.ok).toBe(false);
                expect([400, 403, 404, 405]).toContain(res.status);
            }
        });

        test("the live record cannot be edited while it is trashed", async () => {
            const res = await pbRequest(`/collections/documents/records/${noteId}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Bypass attempt" }),
            });
            expect(res.ok).toBe(false);
            expect([400, 403, 404]).toContain(res.status);
        });

        test("unauthenticated users cannot write trash records", async () => {
            for (const collection of ["trash_documents", "trash_folders"]) {
                const res = await pbRequest(`/collections/${collection}/records`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                expect(res.ok).toBe(false);
                expect([400, 401, 403, 404, 405]).toContain(res.status);
            }
        });
    });

    test("trash records remain visible only to their owner", async () => {
        const docs = await pbList<{ id: string }>(other.token, "trash_documents");
        const folders = await pbList<{ id: string }>(other.token, "trash_folders");
        const ownDocs = await pbList<{ id: string }>(user.token, "trash_documents");
        const ownFolders = await pbList<{ id: string }>(user.token, "trash_folders");

        expect(docs.items).toEqual([]);
        expect(folders.items).toEqual([]);
        expect(ownDocs.items.map((item) => item.id)).toContain(noteId);
        expect(ownFolders.items.map((item) => item.id)).toContain(folderId);
    });

    test("trashed versions stay in document_versions but are hidden from the owner", async () => {
        const asUser = await pbList<{ id: string }>(user.token, "document_versions", {
            filter: `document='${noteId}'`,
        });
        expect(asUser.items).toEqual([]);

        const asSuperuser = await pbList<{ id: string }>(superuserToken, "document_versions", {
            filter: `document='${noteId}'`,
        });
        expect(asSuperuser.items).toHaveLength(1);
    });
});
