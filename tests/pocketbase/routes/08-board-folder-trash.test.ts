import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectStatus,
    pbFindFirst,
    pbGetRecord,
    pbRecordExists,
    pbRequest,
    readJson,
} from "../../helpers/client";
import {
    createBoard,
    createFolder,
    createNote,
    createTask,
    createUser,
    getSuperuserToken,
    type TestUser,
} from "../../helpers/factories";
import { uniqueSuffix } from "../../helpers/setup";

const TRASH_API = "/trash";

describe("Board folder trash routes", () => {
    let user: TestUser;
    let superuserToken: string;
    let rootBoardId: string;

    let restoreParentName: string;
    let restoreChildName: string;
    let restoreTrashFolderId: string;
    let restoreBoardId: string;
    let restoreTaskId: string;

    beforeAll(async () => {
        user = await createUser("board-folder-trash");
        superuserToken = await getSuperuserToken();

        // A root board created before any folder trash must never be touched.
        const rootBoard = await createBoard(user, { name: `Untouched root board ${uniqueSuffix()}` });
        rootBoardId = rootBoard.id;
    });

    function post(path: string, body: unknown) {
        return pbRequest(`${TRASH_API}${path}`, {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    test("moves a folder tree to trash and rehomes its board to root", async () => {
        restoreParentName = `Trash parent ${uniqueSuffix()}`;
        restoreChildName = `Trash child ${uniqueSuffix()}`;

        const parent = await createFolder(user, { name: restoreParentName });
        const child = await createFolder(user, { name: restoreChildName, parent: parent.id });
        const board = await createBoard(user, {
            name: `Nested board ${uniqueSuffix()}`,
            folder: child.id,
            is_private: true,
        });
        const task = await createTask(user, board.id, {
            title: `Nested task ${uniqueSuffix()}`,
            status: "backlog",
        });
        const note = await createNote(user, {
            title: `Nested note ${uniqueSuffix()}`,
            folder: child.id,
        });

        restoreBoardId = board.id;
        restoreTaskId = task.id;

        const res = await post("/move-folder", { folderId: parent.id });
        await expectStatus(res, 200, "move folder containing a board");
        const data = await readJson<{
            trashFolderId: string;
            movedBoardIds: string[];
            movedDocumentIds: string[];
        }>(res);

        expect(data.trashFolderId).toBeTruthy();
        restoreTrashFolderId = data.trashFolderId;
        expect(data.movedBoardIds).toContain(board.id);
        expect(data.movedBoardIds).not.toContain(rootBoardId);
        expect(data.movedDocumentIds).toContain(note.id);

        expect(await pbRecordExists(superuserToken, "folders", parent.id)).toBe(true);
        expect(await pbRecordExists(superuserToken, "folders", child.id)).toBe(true);
        expect(await pbRecordExists(superuserToken, "trash_folders", parent.id)).toBe(true);
        expect(await pbRecordExists(superuserToken, "trash_folders", child.id)).toBe(true);

        const rehomedBoard = await pbGetRecord<{ folder: string; is_private: boolean }>(
            user.token,
            "boards",
            board.id,
        );
        expect(rehomedBoard.folder).toBe("");
        expect(rehomedBoard.is_private).toBe(true);

        const keptTask = await pbGetRecord<{ board: string }>(user.token, "tasks", task.id);
        expect(keptTask.board).toBe(board.id);

        expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(true);
        expect(await pbRecordExists(superuserToken, "trash_documents", note.id)).toBe(true);

        const untouchedRoot = await pbGetRecord<{ folder: string }>(user.token, "boards", rootBoardId);
        expect(untouchedRoot.folder).toBe("");
    });

    test("restores the folder and note while the board stays at root", async () => {
        const res = await post("/restore-folder", { trashFolderId: restoreTrashFolderId });
        await expectStatus(res, 200, "restore folder after board rehome");
        const data = await readJson<{ success: boolean; restoredDocumentIds: string[] }>(res);

        expect(data.success).toBe(true);
        expect(data.restoredDocumentIds).toHaveLength(1);

        const restoredDoc = await pbGetRecord<{ folder: string }>(
            user.token,
            "documents",
            data.restoredDocumentIds[0]!,
        );
        const restoredParent = await pbFindFirst<{ id: string }>(
            user.token,
            "folders",
            `name='${restoreParentName}'`,
        );
        const restoredChild = await pbFindFirst<{ id: string; parent: string }>(
            user.token,
            "folders",
            `name='${restoreChildName}'`,
        );

        expect(restoredParent).not.toBeNull();
        expect(restoredChild).not.toBeNull();
        expect(restoredChild!.parent).toBe(restoredParent!.id);
        expect(restoredDoc.folder).toBe(restoredChild!.id);

        // Boards are rehomed, not trashed, so restoring the folder does not re-file them.
        const board = await pbGetRecord<{ folder: string }>(user.token, "boards", restoreBoardId);
        expect(board.folder).toBe("");

        const task = await pbGetRecord<{ board: string }>(user.token, "tasks", restoreTaskId);
        expect(task.board).toBe(restoreBoardId);

        expect(await pbRecordExists(superuserToken, "trash_folders", restoreTrashFolderId)).toBe(false);
        expect(await pbRecordExists(superuserToken, "folders", restoredParent!.id)).toBe(true);
        expect(await pbRecordExists(superuserToken, "folders", restoredChild!.id)).toBe(true);

        const untouchedRoot = await pbGetRecord<{ folder: string }>(user.token, "boards", rootBoardId);
        expect(untouchedRoot.folder).toBe("");
    });

    // restore-folder consumes the trash record, so the permanent-delete path
    // needs its own trashed tree rather than reusing the restored fixture.
    test("permanently deleting a trashed folder keeps its rehomed board and task", async () => {
        const parent = await createFolder(user, { name: `Delete parent ${uniqueSuffix()}` });
        const child = await createFolder(user, {
            name: `Delete child ${uniqueSuffix()}`,
            parent: parent.id,
        });
        const board = await createBoard(user, {
            name: `Deleted folder board ${uniqueSuffix()}`,
            folder: child.id,
        });
        const task = await createTask(user, board.id, {
            title: `Deleted folder task ${uniqueSuffix()}`,
            status: "backlog",
        });
        const note = await createNote(user, {
            title: `Deleted folder note ${uniqueSuffix()}`,
            folder: child.id,
        });

        const moveRes = await post("/move-folder", { folderId: parent.id });
        await expectStatus(moveRes, 200, "move folder before permanent delete");
        const moved = await readJson<{ trashFolderId: string; movedBoardIds: string[] }>(moveRes);

        expect(moved.movedBoardIds).toContain(board.id);
        expect(moved.movedBoardIds).not.toContain(rootBoardId);

        const rehomed = await pbGetRecord<{ folder: string }>(user.token, "boards", board.id);
        expect(rehomed.folder).toBe("");

        const deleteRes = await post("/permanent-delete-folder", {
            trashFolderId: moved.trashFolderId,
        });
        await expectStatus(deleteRes, 200, "permanently delete trashed folder");
        expect((await readJson<{ success: boolean }>(deleteRes)).success).toBe(true);

        expect(await pbRecordExists(superuserToken, "trash_folders", moved.trashFolderId)).toBe(false);
        expect(await pbRecordExists(superuserToken, "folders", parent.id)).toBe(false);
        expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
        expect(await pbRecordExists(superuserToken, "trash_documents", note.id)).toBe(false);

        const keptBoard = await pbGetRecord<{ folder: string }>(user.token, "boards", board.id);
        expect(keptBoard.folder).toBe("");
        const keptTask = await pbGetRecord<{ board: string }>(user.token, "tasks", task.id);
        expect(keptTask.board).toBe(board.id);

        const untouchedRoot = await pbGetRecord<{ folder: string }>(user.token, "boards", rootBoardId);
        expect(untouchedRoot.folder).toBe("");
    });
});
