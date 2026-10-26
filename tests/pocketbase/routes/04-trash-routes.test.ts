import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectJsonError,
    expectStatus,
    pbGetRecord,
    pbList,
    pbRecordExists,
    pbRequest,
    readJson,
} from "../../helpers/client";
import {
    createBoard,
    createFolder,
    createNote,
    createNoteWithAttachment,
    createTask,
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

    async function versionsOf(documentId: string) {
        const page = await pbList<{ id: string; content: string }>(
            superuserToken,
            "document_versions",
            { filter: `document='${documentId}'` },
        );
        return page.items;
    }

    describe("document lifecycle", () => {
        test("move keeps the document id, sets deleted_at, and exposes the trash view", async () => {
            const note = await createNote(user, { title: "Trash me", content: "Some content" });
            const trashId = await moveDocument(note.id);
            expect(trashId).toBe(note.id);

            const stored = await pbGetRecord<{ id: string; deleted_at: string }>(
                superuserToken,
                "documents",
                note.id,
            );
            expect(stored.id).toBe(note.id);
            expect(stored.deleted_at.length).toBeGreaterThan(0);

            const trashed = await pbGetRecord<{ id: string; title: string }>(
                user.token,
                "trash_documents",
                trashId,
            );
            expect(trashed.title).toBe("Trash me");

            const active = await pbList<{ id: string }>(user.token, "documents", {
                filter: `id='${note.id}'`,
            });
            expect(active.items).toEqual([]);
        });

        test("restore clears the flag and keeps the id", async () => {
            const note = await createNote(user, { title: "Restore me", content: "Content" });
            const trashId = await moveDocument(note.id);

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            await expectStatus(restoreRes, 200, "restore document");
            const restored = await readJson<{ documentId: string; folderId: string | null }>(restoreRes);

            expect(restored.documentId).toBe(note.id);
            expect(restored.folderId).toBeNull();
            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(false);

            const active = await pbList<{ id: string }>(user.token, "documents", {
                filter: `id='${note.id}'`,
            });
            expect(active.items.map((item) => item.id)).toContain(note.id);
        });

        test("permanent delete removes the document, versions, and task links", async () => {
            const note = await createNote(user, { title: "Delete forever", content: "Gone" });
            await publishNote(user, note.id);
            const board = await createBoard(user);
            const task = await createTask(user, board.id, { document: note.id });
            const trashId = await moveDocument(note.id);

            const deleteRes = await post("/permanent-delete-document", {
                trashDocumentId: trashId,
            });
            await expectStatus(deleteRes, 200, "permanently delete document");
            expect((await readJson<{ success: boolean }>(deleteRes)).success).toBe(true);

            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "trash_documents", trashId)).toBe(false);
            expect(await versionsOf(note.id)).toEqual([]);

            const keptTask = await pbGetRecord<{ document: string }>(
                superuserToken,
                "tasks",
                task.id,
            );
            expect(keptTask.document).toBe("");
        });

        test("restoring a document whose folder is still trashed re-roots it", async () => {
            const folder = await createFolder(user, { name: "Trashed folder" });
            const note = await createNote(user, { title: "Orphan", folder: folder.id });
            const trashId = await moveDocument(note.id);
            const trashFolderId = await moveFolder(folder.id);

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            await expectStatus(restoreRes, 200, "restore orphan");
            const restored = await readJson<{ folderId: string | null }>(restoreRes);
            expect(restored.folderId).toBeNull();

            const stored = await pbGetRecord<{ folder: string }>(
                superuserToken,
                "documents",
                note.id,
            );
            expect(stored.folder).toBe("");

            // Restoring the folder later does not move the note back.
            await expectStatus(
                await post("/restore-folder", { trashFolderId }),
                200,
                "restore folder",
            );
            const stillRoot = await pbGetRecord<{ folder: string }>(
                superuserToken,
                "documents",
                note.id,
            );
            expect(stillRoot.folder).toBe("");
        });
    });

    describe("version preservation", () => {
        test("versions stay with the soft-deleted document and are hidden from the owner", async () => {
            const note = await createNote(user, { title: "Versioned", content: "Version 1" });
            await publishNote(user, note.id, "Version 2");

            expect(await versionsOf(note.id)).toHaveLength(1);

            const trashId = await moveDocument(note.id);
            expect(await versionsOf(note.id)).toHaveLength(1);

            const asUser = await pbList<{ id: string }>(user.token, "document_versions", {
                filter: `document='${note.id}'`,
            });
            expect(asUser.items).toEqual([]);

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            const { documentId } = await readJson<{ documentId: string }>(restoreRes);
            expect(documentId).toBe(note.id);
            expect(await versionsOf(documentId)).toHaveLength(1);
        });

        test("permanent delete removes versions", async () => {
            const note = await createNote(user, { title: "Version delete", content: "v1" });
            await publishNote(user, note.id, "v2");
            const trashId = await moveDocument(note.id);

            await expectStatus(
                await post("/permanent-delete-document", { trashDocumentId: trashId }),
                200,
                "delete versioned note",
            );
            expect(await versionsOf(note.id)).toEqual([]);
        });
    });

    describe("attachments", () => {
        test("attachment bytes survive while trashed and after restore", async () => {
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

            const trashedRes = await pbRequest(
                `/files/trash_documents/${trashId}/${encodeURIComponent(storedName)}?token=${encodeURIComponent(fileToken)}`,
            );
            await expectStatus(trashedRes, 200, "read trashed attachment");

            const restoreRes = await post("/restore-document", { trashDocumentId: trashId });
            const { documentId } = await readJson<{ documentId: string }>(restoreRes);

            const restoredRes = await pbRequest(
                `/files/documents/${documentId}/${encodeURIComponent(storedName)}?token=${encodeURIComponent(fileToken)}`,
            );
            await expectStatus(restoredRes, 200, "read restored attachment");
            expect(await restoredRes.text()).toBe("attachment survives");
        });
    });

    describe("folder lifecycle", () => {
        test("moving a folder marks the tree and its documents, keeping ids", async () => {
            const folder = await createFolder(user, { name: "Trash folder" });
            const first = await createNote(user, { folder: folder.id });
            const second = await createNote(user, { folder: folder.id });

            const res = await post("/move-folder", { folderId: folder.id });
            await expectStatus(res, 200, "move folder");
            const data = await readJson<{ trashFolderId: string; movedDocumentIds: string[] }>(res);

            expect(data.trashFolderId).toBe(folder.id);
            expect(data.movedDocumentIds).toHaveLength(2);
            expect(data.movedDocumentIds).toEqual(expect.arrayContaining([first.id, second.id]));

            expect(await pbRecordExists(superuserToken, "folders", folder.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_folders", folder.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "documents", first.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_documents", first.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_documents", second.id)).toBe(true);
        });

        test("restoring a folder clears the tree and its documents", async () => {
            const folder = await createFolder(user, { name: "Restore folder" });
            const note = await createNote(user, { folder: folder.id });
            const trashFolderId = await moveFolder(folder.id);

            const restoreRes = await post("/restore-folder", { trashFolderId });
            await expectStatus(restoreRes, 200, "restore folder");
            const data = await readJson<{
                success: boolean;
                folderId: string;
                restoredDocumentIds: string[];
            }>(restoreRes);

            expect(data.success).toBe(true);
            expect(data.folderId).toBe(folder.id);
            expect(data.restoredDocumentIds).toEqual([note.id]);
            expect(await pbRecordExists(superuserToken, "trash_folders", trashFolderId)).toBe(false);
            expect(await pbRecordExists(superuserToken, "trash_documents", note.id)).toBe(false);

            const restoredDoc = await pbGetRecord<{ folder: string }>(
                user.token,
                "documents",
                note.id,
            );
            expect(restoredDoc.folder).toBe(folder.id);
        });

        test("moving a parent trashes the whole nested tree", async () => {
            const parent = await createFolder(user, { name: "Nested parent" });
            const child = await createFolder(user, { name: "Nested child", parent: parent.id });
            const note = await createNote(user, { folder: child.id });

            const res = await post("/move-folder", { folderId: parent.id });
            const data = await readJson<{ movedDocumentIds: string[] }>(res);

            expect(data.movedDocumentIds).toContain(note.id);
            expect(await pbRecordExists(superuserToken, "trash_folders", parent.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_folders", child.id)).toBe(true);
            expect(await pbRecordExists(superuserToken, "trash_documents", note.id)).toBe(true);
        });

        test("permanent delete removes the tree, its documents, and versions", async () => {
            const folder = await createFolder(user, { name: "Delete folder" });
            const child = await createFolder(user, { name: "Delete child", parent: folder.id });
            const note = await createNote(user, { folder: child.id });
            await publishNote(user, note.id);
            const trashFolderId = await moveFolder(folder.id);

            const deleteRes = await post("/permanent-delete-folder", { trashFolderId });
            await expectStatus(deleteRes, 200, "permanent delete folder");
            expect((await readJson<{ success: boolean }>(deleteRes)).success).toBe(true);

            expect(await pbRecordExists(superuserToken, "folders", folder.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "folders", child.id)).toBe(false);
            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
            expect(await versionsOf(note.id)).toEqual([]);
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
            expect(await pbRecordExists(superuserToken, "trash_documents", note.id)).toBe(false);
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
            expect(await pbRecordExists(superuserToken, "trash_folders", folder.id)).toBe(false);
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
