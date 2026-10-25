import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectStatus,
    pbCreate,
    pbGetRecord,
    pbList,
    pbRequest,
    pbUpdate,
} from "../../helpers/client";
import {
    createBoard,
    createFolder,
    createTask,
    createUser,
    type TestRecord,
    type TestUser,
} from "../../helpers/factories";
import { uniqueSuffix } from "../../helpers/setup";

describe("Board folders", () => {
    let owner: TestUser;
    let other: TestUser;

    beforeAll(async () => {
        owner = await createUser("board-folder-owner");
        other = await createUser("board-folder-other");
    });

    function createBoardAs(user: TestUser, body: Record<string, unknown>) {
        return pbRequest("/collections/boards/records", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    function patchBoardAs(user: TestUser, id: string, body: Record<string, unknown>) {
        return pbRequest(`/collections/boards/records/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    describe("schema", () => {
        test("stores the folder relation and privacy flag and filters boards by folder", async () => {
            const folder = await createFolder(owner, { name: `Schema folder ${uniqueSuffix()}` });
            const board = await pbCreate<TestRecord>(owner.token, "boards", {
                name: "Filed board",
                author: owner.id,
                folder: folder.id,
                is_private: true,
            });

            expect(board.folder).toBe(folder.id);
            expect(board.is_private).toBe(true);

            const reread = await pbGetRecord<{ folder: string; is_private: boolean }>(
                owner.token,
                "boards",
                board.id,
            );
            expect(reread.folder).toBe(folder.id);
            expect(reread.is_private).toBe(true);

            const listed = await pbList<{ id: string }>(owner.token, "boards", {
                filter: `folder='${folder.id}'`,
                perPage: 50,
            });
            expect(listed.items.map((item) => item.id)).toEqual([board.id]);
        });
    });

    describe("owner filing", () => {
        test("files a board into an owned folder and clearing the folder moves it to root", async () => {
            const folder = await createFolder(owner, { name: `Owner folder ${uniqueSuffix()}` });
            const board = await createBoard(owner, {
                name: "Owned board",
                folder: folder.id,
                is_private: true,
            });

            expect(board.folder).toBe(folder.id);
            expect(board.is_private).toBe(true);

            const filed = await pbGetRecord<{ folder: string; is_private: boolean }>(
                owner.token,
                "boards",
                board.id,
            );
            expect(filed.folder).toBe(folder.id);
            expect(filed.is_private).toBe(true);

            const cleared = await pbUpdate<{ folder: string; is_private: boolean }>(
                owner.token,
                "boards",
                board.id,
                { folder: "" },
            );
            expect(cleared.folder).toBe("");
            expect(cleared.is_private).toBe(true);

            const atRoot = await pbGetRecord<{ folder: string; is_private: boolean }>(
                owner.token,
                "boards",
                board.id,
            );
            expect(atRoot.folder).toBe("");
            expect(atRoot.is_private).toBe(true);
        });
    });

    describe("folder ownership guard", () => {
        // The guard throws ForbiddenError, which PocketBase maps to a 403.
        test("rejects creating a board in another author's folder", async () => {
            const foreignFolder = await createFolder(other, { name: `Foreign folder ${uniqueSuffix()}` });
            const name = `Cross-author create ${uniqueSuffix()}`;

            const res = await createBoardAs(owner, {
                name,
                author: owner.id,
                folder: foreignFolder.id,
            });
            await expectStatus(res, 403, "cross-author board folder create");

            const leaked = await pbList<{ id: string }>(owner.token, "boards", {
                filter: `name='${name}'`,
            });
            expect(leaked.items).toEqual([]);
        });

        test("rejects moving an existing board into another author's folder", async () => {
            const foreignFolder = await createFolder(other, { name: `Foreign folder ${uniqueSuffix()}` });
            const board = await createBoard(owner, { name: `Move guard ${uniqueSuffix()}` });

            const res = await patchBoardAs(owner, board.id, { folder: foreignFolder.id });
            await expectStatus(res, 403, "cross-author board folder update");

            const reread = await pbGetRecord<{ folder: string }>(owner.token, "boards", board.id);
            expect(reread.folder).toBe("");
        });

        test("rejects a folder id that does not exist", async () => {
            const name = `Missing folder ${uniqueSuffix()}`;
            const res = await createBoardAs(owner, {
                name,
                author: owner.id,
                folder: "foldermissing01",
            });
            await expectStatus(res, 400, "missing folder board create");

            const leaked = await pbList<{ id: string }>(owner.token, "boards", {
                filter: `name='${name}'`,
            });
            expect(leaked.items).toEqual([]);
        });
    });

    describe("board visibility and delete rules", () => {
        test("keeps cross-author reads and updates at 404", async () => {
            const name = `Private scope ${uniqueSuffix()}`;
            const board = await createBoard(owner, { name });

            const viewRes = await pbRequest(`/collections/boards/records/${board.id}`, {
                headers: { Authorization: other.token },
            });
            await expectStatus(viewRes, 404, "cross-author board view");

            const updateRes = await patchBoardAs(other, board.id, { name: "Hijacked" });
            await expectStatus(updateRes, 404, "cross-author board update");

            const ownerView = await pbGetRecord<{ name: string }>(owner.token, "boards", board.id);
            expect(ownerView.name).toBe(name);
        });

        test("still requires archiving before delete and cascades tasks after archive", async () => {
            const folder = await createFolder(owner, { name: `Delete folder ${uniqueSuffix()}` });
            const board = await createBoard(owner, {
                name: `Delete lifecycle ${uniqueSuffix()}`,
                folder: folder.id,
            });
            const task = await createTask(owner, board.id, {
                title: `Cascade task ${uniqueSuffix()}`,
                status: "backlog",
            });

            const activeDelete = await pbRequest(`/collections/boards/records/${board.id}`, {
                method: "DELETE",
                headers: { Authorization: owner.token },
            });
            await expectStatus(activeDelete, 404, "delete active board");

            const stillFiled = await pbGetRecord<{ folder: string; archived: boolean }>(
                owner.token,
                "boards",
                board.id,
            );
            expect(stillFiled.folder).toBe(folder.id);
            expect(stillFiled.archived).toBe(false);

            const archived = await pbUpdate<{ archived: boolean; folder: string }>(
                owner.token,
                "boards",
                board.id,
                { archived: true },
            );
            expect(archived.archived).toBe(true);
            expect(archived.folder).toBe(folder.id);

            const foreignDelete = await pbRequest(`/collections/boards/records/${board.id}`, {
                method: "DELETE",
                headers: { Authorization: other.token },
            });
            await expectStatus(foreignDelete, 404, "cross-author delete archived board");

            const deleteRes = await pbRequest(`/collections/boards/records/${board.id}`, {
                method: "DELETE",
                headers: { Authorization: owner.token },
            });
            await expectStatus(deleteRes, 204, "delete archived board");

            await expectStatus(
                await pbRequest(`/collections/boards/records/${board.id}`, {
                    headers: { Authorization: owner.token },
                }),
                404,
                "deleted board",
            );
            await expectStatus(
                await pbRequest(`/collections/tasks/records/${task.id}`, {
                    headers: { Authorization: owner.token },
                }),
                404,
                "task cascaded with its board",
            );
        });
    });
});
