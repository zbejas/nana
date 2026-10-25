import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectJsonError,
    expectStatus,
    pbFindFirst,
    pbList,
    pbRecordExists,
    pbRequest,
    readJson,
} from "../../helpers/client";
import {
    createFolder,
    createNote,
    createNoteWithAttachment,
    createUser,
    getSuperuserToken,
    publishNote,
    type TestUser,
} from "../../helpers/factories";

const TRASH_API = "/trash";

describe("Trash routes", () => {
    let user: TestUser;
    let other: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        user = await createUser("trash-routes");
        other = await createUser("trash-routes-other");
        superuserToken = await getSuperuserToken();
    });

    function post(path: string, body: unknown, token = user.token) {
        return pbRequest(`${TRASH_API}${path}`, {
            method: "POST",
            headers: { Authorization: token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    async function moveDocument(documentId: string, token = user.token): Promise<string> {
        const res = await post("/move-document", { documentId }, token);
        await expectStatus(res, 200, "move document to trash");
        return (await readJson<{ trashDocumentId: string }>(res)).trashDocumentId;
    }

    async function moveFolder(folderId: string, token = user.token): Promise<string> {
        const res = await post("/move-folder", { folderId }, token);
        await expectStatus(res, 200, "move folder to trash");
        return (await readJson<{ trashFolderId: string }>(res)).trashFolderId;
    }

    async function trashDocumentByOriginalId(originalId: string) {
        return pbFindFirst<{ id: string; folder?: string }>(
            superuserToken,
            "trash_documents",
            `original_document_id='${originalId}'`,
        );
    }

    async function versionsOf(documentId: string, collection = "document_versions", field = "document") {
        const page = await pbList<{ id: string; content: string }>(superuserToken, collection, {
            filter: `${field}='${documentId}'`,
        });
        return page.items;
    }

    describe("document lifecycle", () => {
        test("move removes the original and creates a trash record", async () => {
            const note = await createNote(user, { title: "Trash me", content: "Some content" });
            const trashId = await moveDocument(note.id);

            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(true);
        });

        test("restore recreates the document and removes the trash record", async () => {
            const note = await createNote(user, { title: "Restore me", content: "Content" });
            const trashId = await moveDocument(note.id);

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            await expectStatus(restoreRes, 200, "restore document");
            const restored = await readJson<{ documentId: string; folderId: string | null }>(restoreRes);

            expect(await pbRecordExists(superuserToken, "documents", restored.documentId)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(false);
            expect(restored.folderId).toBeNull();
        });

        test("permanent delete removes both copies", async () => {
            const note = await createNote(user, { title: "Delete forever", content: "Gone" });
            const trashId = await moveDocument(note.id);

            const deleteRes = await post("/permanent-delete-document", {
                trashDocumentId: trashId,
            });
            await expectStatus(deleteRes, 200, "permanently delete document");
            expect((await readJson<{ success: boolean }>(deleteRes)).success).toBe(true);

            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(false);
        });

        test("restoring a document with a deleted folder restores it at the root", async () => {
            const folder = await createFolder(user, { name: "Temporary folder" });
            const note = await createNote(user, { title: "Orphan", folder: folder.id });
            const trashId = await moveDocument(note.id);

            // Move the (already emptied) folder to trash, then permanently delete it.
            const trashFolderId = await moveFolder(folder.id);
            await expectStatus(
                await post("/permanent-delete-folder", { trashFolderId }),
                200,
                "delete folder",
            );

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            await expectStatus(restoreRes, 200, "restore orphan");
            const restored = await readJson<{ folderId: string | null }>(restoreRes);
            expect(restored.folderId).toBeNull();
        });
    });

    describe("version preservation", () => {
        test("versions move to trash and come back with the document", async () => {
            const note = await createNote(user, { title: "Versioned", content: "Version 1" });
            await publishNote(user, note.id, "Version 2");

            expect(await versionsOf(note.id)).toHaveLength(1);

            const trashId = await moveDocument(note.id);
            expect(await versionsOf(note.id)).toEqual([]);
            expect(await versionsOf(trashId, "trash_document_versions", "trash_document")).toHaveLength(1);

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            const { documentId } = await readJson<{ documentId: string }>(restoreRes);

            expect(await versionsOf(documentId)).toHaveLength(1);
            expect(await versionsOf(trashId, "trash_document_versions", "trash_document")).toEqual([]);
        });

        test("permanent delete removes trash versions", async () => {
            const note = await createNote(user, { title: "Version delete", content: "v1" });
            await publishNote(user, note.id, "v2");
            const trashId = await moveDocument(note.id);

            expect(await versionsOf(trashId, "trash_document_versions", "trash_document")).toHaveLength(1);
            await expectStatus(
                await post("/permanent-delete-document", { trashDocumentId: trashId }),
                200,
                "delete versioned note",
            );
            expect(await versionsOf(trashId, "trash_document_versions", "trash_document")).toEqual([]);
        });
    });

    describe("attachments", () => {
        test("attachment bytes survive a trash round trip", async () => {
            const body = new TextEncoder().encode("attachment survives");
            const note = await createNoteWithAttachment(user, "survivor.txt", body);
            const storedName = (note.attachments as string[])[0]!;

            const fileTokenRes = await pbRequest("/files/token", {
                method: "POST",
                headers: { Authorization: user.token },
            });
            await expectStatus(fileTokenRes, 200, "file token");
            const { token: fileToken } = await readJson<{ token: string }>(fileTokenRes);

            const originalRes = await pbRequest(
                `/files/documents/${note.id}/${encodeURIComponent(storedName)}?token=${encodeURIComponent(fileToken)}`,
            );
            await expectStatus(originalRes, 200, "read original attachment");

            const trashId = await moveDocument(note.id);
            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            const { documentId } = await readJson<{ documentId: string }>(restoreRes);

            const restoredRecord = await readJson<{ attachments: string[] }>(
                await pbRequest(`/collections/documents/records/${documentId}`, {
                    headers: { Authorization: user.token },
                }),
            );
            expect(restoredRecord.attachments).toHaveLength(1);

            const restoredRes = await pbRequest(
                `/files/documents/${documentId}/${encodeURIComponent(restoredRecord.attachments[0]!)}?token=${encodeURIComponent(fileToken)}`,
            );
            await expectStatus(restoredRes, 200, "read restored attachment");
            expect(await restoredRes.text()).toBe("attachment survives");
        });
    });

    describe("folder lifecycle", () => {
        test("moving a folder trashes its documents", async () => {
            const folder = await createFolder(user, { name: "Trash folder" });
            const first = await createNote(user, { folder: folder.id });
            const second = await createNote(user, { folder: folder.id });

            const res = await post("/move-folder", { folderId: folder.id });
            await expectStatus(res, 200, "move folder");
            const data = await readJson<{ trashFolderId: string; movedDocumentIds: string[] }>(res);

            expect(data.movedDocumentIds).toHaveLength(2);
            expect(data.movedDocumentIds).toEqual(expect.arrayContaining([first.id, second.id]));
            expect(await pbRecordExists(superuserToken, "folders", folder.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "documents", first.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "documents", second.id)).toBe(false);
            expect(await trashDocumentByOriginalId(first.id)).not.toBeNull();
            expect(await trashDocumentByOriginalId(second.id)).not.toBeNull();
        });

        test("restoring a folder recreates the folder and its documents", async () => {
            const folder = await createFolder(user, { name: "Restore folder" });
            const note = await createNote(user, { folder: folder.id });
            const trashFolderId = await moveFolder(folder.id);

            const restoreRes = await post("/restore-folder", { trashFolderId });
            await expectStatus(restoreRes, 200, "restore folder");
            const data = await readJson<{ success: boolean; restoredDocumentIds: string[] }>(restoreRes);

            expect(data.success).toBe(true);
            expect(data.restoredDocumentIds).toHaveLength(1);
            expect(await pbRecordExists(superuserToken, "documents", data.restoredDocumentIds[0]!)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_folders", trashFolderId)).toBe(false);

            const folders = await pbList<{ id: string; name: string }>(user.token, "folders");
            expect(folders.items.some((item) => item.name === "Restore folder")).toBe(true);

            // The restored document is inside the restored folder.
            const restoredDoc = await pbRequest(
                `/collections/documents/records/${data.restoredDocumentIds[0]!}`,
                { headers: { Authorization: user.token } },
            );
            const doc = await readJson<{ folder: string }>(restoredDoc);
            expect(folders.items.map((item) => item.id)).toContain(doc.folder);
            expect(await trashDocumentByOriginalId(note.id)).toBeNull();
        });

        test("moving a parent trashes the whole nested tree", async () => {
            const parent = await createFolder(user, { name: "Nested parent" });
            const child = await createFolder(user, { name: "Nested child", parent: parent.id });
            const note = await createNote(user, { folder: child.id });

            const res = await post("/move-folder", { folderId: parent.id });
            const data = await readJson<{ movedDocumentIds: string[] }>(res);

            expect(data.movedDocumentIds).toContain(note.id);
            expect(await pbRecordExists(superuserToken, "folders", parent.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "folders", child.id)).toBe(false);
            expect(
                await pbFindFirst(superuserToken, "trash_folders", `original_folder_id='${child.id}'`),
            ).not.toBeNull();
        });

        test("permanent delete removes the tree and its documents", async () => {
            const folder = await createFolder(user, { name: "Delete folder" });
            const child = await createFolder(user, { name: "Delete child", parent: folder.id });
            const note = await createNote(user, { folder: child.id });
            const trashFolderId = await moveFolder(folder.id);

            const deleteRes = await post("/permanent-delete-folder", { trashFolderId });
            await expectStatus(deleteRes, 200, "permanent delete folder");
            expect((await readJson<{ success: boolean }>(deleteRes)).success).toBe(true);

            expect(await pbRecordExists(superuserToken, "trash_folders", trashFolderId)).toBe(false);
            expect(await trashDocumentByOriginalId(note.id)).toBeNull();
            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "folders", folder.id)).toBe(false);
        });

        test("moving an empty folder succeeds", async () => {
            const folder = await createFolder(user, { name: "Empty folder" });
            const trashFolderId = await moveFolder(folder.id);
            expect(await pbRecordExists(superuserToken, "trash_folders", trashFolderId)).toBe(true);
        });
    });

    describe("auth and ownership", () => {
        test("cannot trash another user's document", async () => {
            const note = await createNote(user, { title: "User A note" });
            const res = await post("/move-document", { documentId: note.id }, other.token);

            await expectJsonError(res, 400);
            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(true);
        });

        test("cannot restore or permanently delete another user's trash", async () => {
            const note = await createNote(user, { title: "Owner only" });
            const trashId = await moveDocument(note.id);

            await expectJsonError(
                await post("/restore-document", { trashDocumentId: trashId }, other.token),
                400,
            );
            await expectJsonError(
                await post("/permanent-delete-document", { trashDocumentId: trashId }, other.token),
                400,
            );
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(true);
        });

        test("cannot move another user's folder", async () => {
            const folder = await createFolder(user, { name: "Private folder" });
            const res = await post("/move-folder", { folderId: folder.id }, other.token);

            await expectJsonError(res, 400);
            expect(await pbRecordExists(superuserToken, "folders", folder.id)).toBe(true);
        });

        test("unauthenticated requests are rejected", async () => {
            const res = await pbRequest(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: "anything" }),
            });
            await expectStatus(res, 401, "unauthenticated trash request");
        });

        test("missing ids and invalid JSON are rejected", async () => {
            await expectJsonError(await post("/move-document", {}), 400);
            await expectJsonError(await post("/restore-document", {}), 400);
            await expectJsonError(await post("/move-folder", {}), 400);
            await expectJsonError(await post("/restore-folder", {}), 400);
            await expectJsonError(await post("/permanent-delete-document", {}), 400);
            await expectJsonError(await post("/permanent-delete-folder", {}), 400);

            const invalidJson = await pbRequest(`${TRASH_API}/move-document`, {
                method: "POST",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: "{not-json",
            });
            await expectJsonError(invalidJson, 400);
        });

        test("unknown ids are rejected without leaking records", async () => {
            await expectJsonError(
                await post("/restore-document", { trashDocumentId: "nonexistent123456" }),
                400,
            );
            await expectJsonError(
                await post("/permanent-delete-folder", { trashFolderId: "nonexistent123456" }),
                400,
            );
        });
    });
});
