import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbList, pbRequest, readJson } from "../../helpers/client";
import {
    createBoard,
    createTask,
    createUser,
    type TestUser,
} from "../../helpers/factories";

describe("Board collection rules", () => {
    let owner: TestUser;
    let other: TestUser;
    let ownerBoardId: string;
    let otherBoardId: string;

    beforeAll(async () => {
        owner = await createUser("board-owner");
        other = await createUser("board-other");

        ownerBoardId = (await createBoard(owner, { name: "Owner board" })).id;
        otherBoardId = (await createBoard(other, { name: "Other board" })).id;
    });

    function createBoardAs(user: TestUser, body: Record<string, unknown>) {
        return pbRequest("/collections/boards/records", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    function patchBoard(id: string, body: Record<string, unknown>, token = owner.token) {
        return pbRequest(`/collections/boards/records/${id}`, {
            method: "PATCH",
            headers: { Authorization: token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    describe("creation and listing", () => {
        test("lists only the signed-in author's boards", async () => {
            const res = await pbList<{ id: string }>(owner.token, "boards");
            const ids = res.items.map((board) => board.id);

            expect(ids).toContain(ownerBoardId);
            expect(ids).not.toContain(otherBoardId);
        });

        test("creates a board for its own author", async () => {
            const res = await createBoardAs(owner, {
                name: "Release board",
                description: "Ship the thing",
                author: owner.id,
            });

            await expectStatus(res, 200, "create board");
            const board = await readJson<Record<string, unknown>>(res);
            expect(board.name).toBe("Release board");
            expect(board.description).toBe("Ship the thing");
            expect(board.archived).toBe(false);
            expect(board.author).toBe(owner.id);
        });

        test("rejects a board created under another author", async () => {
            const res = await createBoardAs(owner, {
                name: "Injected board",
                author: other.id,
            });
            await expectStatus(res, 400, "cross-author board create");
        });

        test("rejects a board without a name", async () => {
            const res = await createBoardAs(owner, { author: owner.id });
            await expectStatus(res, 400, "nameless board create");
        });

        test("blocks another user from listing the owner's boards", async () => {
            const res = await pbList<{ id: string }>(other.token, "boards");
            const ids = res.items.map((board) => board.id);

            expect(ids).toContain(otherBoardId);
            expect(ids).not.toContain(ownerBoardId);
        });
    });

    describe("updates and archiving", () => {
        test("owner can update a board", async () => {
            const res = await patchBoard(ownerBoardId, {
                name: "Renamed board",
                description: "Updated",
            });

            await expectStatus(res, 200, "update board");
            const board = await readJson<{ name: string; description: string }>(res);
            expect(board.name).toBe("Renamed board");
            expect(board.description).toBe("Updated");
        });

        test("owner can archive and restore a board", async () => {
            const created = await createBoard(owner, { name: "Seasonal board" });

            const archiveRes = await patchBoard(created.id, { archived: true });
            await expectStatus(archiveRes, 200, "archive board");
            expect((await readJson<{ archived: boolean }>(archiveRes)).archived).toBe(true);

            const restoreRes = await patchBoard(created.id, { archived: false });
            await expectStatus(restoreRes, 200, "restore board");
            expect((await readJson<{ archived: boolean }>(restoreRes)).archived).toBe(false);
        });

        test("blocks another user from viewing, updating, or deleting a board", async () => {
            const viewRes = await pbRequest(`/collections/boards/records/${ownerBoardId}`, {
                headers: { Authorization: other.token },
            });
            await expectStatus(viewRes, 404, "cross-author board view");

            const updateRes = await patchBoard(ownerBoardId, { name: "Hijacked" }, other.token);
            await expectStatus(updateRes, 404, "cross-author board update");

            const deleteRes = await pbRequest(`/collections/boards/records/${ownerBoardId}`, {
                method: "DELETE",
                headers: { Authorization: other.token },
            });
            await expectStatus(deleteRes, 404, "cross-author board delete");
        });
    });

    describe("permanent delete", () => {
        test("rejects deleting a board that is not archived", async () => {
            const created = await createBoard(owner, { name: "Still active" });

            const res = await pbRequest(`/collections/boards/records/${created.id}`, {
                method: "DELETE",
                headers: { Authorization: owner.token },
            });
            expect([400, 403, 404]).toContain(res.status);
        });

        test("deleting an archived board cascades its tasks and leaves neighbours intact", async () => {
            const doomed = await createBoard(owner, { name: "Doomed board" });
            const keep = await createBoard(owner, { name: "Keep board" });

            const doomedA = await createTask(owner, doomed.id, {
                title: "Doomed A",
                status: "backlog",
            });
            const doomedB = await createTask(owner, doomed.id, {
                title: "Doomed B",
                status: "progress",
            });
            const kept = await createTask(owner, keep.id, {
                title: "Kept",
                status: "backlog",
            });
            const otherTask = await createTask(other, otherBoardId, {
                title: "Other user's task",
                status: "backlog",
            });

            const archiveRes = await patchBoard(doomed.id, { archived: true });
            await expectStatus(archiveRes, 200, "archive doomed board");

            const deleteRes = await pbRequest(`/collections/boards/records/${doomed.id}`, {
                method: "DELETE",
                headers: { Authorization: owner.token },
            });
            await expectStatus(deleteRes, 204, "delete archived board");

            for (const taskId of [doomedA.id, doomedB.id]) {
                const res = await pbRequest(`/collections/tasks/records/${taskId}`, {
                    headers: { Authorization: owner.token },
                });
                await expectStatus(res, 404, "cascaded task");
            }

            await expectStatus(
                await pbRequest(`/collections/boards/records/${keep.id}`, {
                    headers: { Authorization: owner.token },
                }),
                200,
                "kept board",
            );
            await expectStatus(
                await pbRequest(`/collections/tasks/records/${kept.id}`, {
                    headers: { Authorization: owner.token },
                }),
                200,
                "kept task",
            );
            await expectStatus(
                await pbRequest(`/collections/boards/records/${otherBoardId}`, {
                    headers: { Authorization: other.token },
                }),
                200,
                "other board",
            );
            await expectStatus(
                await pbRequest(`/collections/tasks/records/${otherTask.id}`, {
                    headers: { Authorization: other.token },
                }),
                200,
                "other task",
            );
        });
    });
});
