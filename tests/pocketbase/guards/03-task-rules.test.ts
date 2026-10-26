import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbList, pbRequest, readJson } from "../../helpers/client";
import {
    createBoard,
    createTask,
    createUser,
    type TestUser,
} from "../../helpers/factories";

describe("Task collection rules", () => {
    let owner: TestUser;
    let other: TestUser;
    let ownerBoardId: string;
    let otherBoardId: string;
    let archivedBoardId: string;
    let archivedTaskId: string;
    let deletableArchivedTaskId: string;

    beforeAll(async () => {
        owner = await createUser("task-owner");
        other = await createUser("task-other");

        const ownerBoard = await createBoard(owner, { name: "Owner board" });
        ownerBoardId = ownerBoard.id;

        const otherBoard = await createBoard(other, { name: "Other board" });
        otherBoardId = otherBoard.id;

        // Seed tasks while the board is active, then archive it. New writes are
        // rejected afterwards, but the existing tasks stay for delete/update checks.
        const archivedBoard = await createBoard(owner, { name: "Archived board" });
        archivedBoardId = archivedBoard.id;

        const frozen = await createTask(owner, archivedBoardId, {
            title: "Frozen task",
            status: "backlog",
            board_order: 0,
        });
        archivedTaskId = frozen.id;

        const deletable = await createTask(owner, archivedBoardId, {
            title: "Cleanup task",
            status: "backlog",
            board_order: 1,
        });
        deletableArchivedTaskId = deletable.id;

        const archiveRes = await pbRequest(`/collections/boards/records/${archivedBoardId}`, {
            method: "PATCH",
            headers: { Authorization: owner.token, "Content-Type": "application/json" },
            body: JSON.stringify({ archived: true }),
        });
        await expectStatus(archiveRes, 200, "archive board");
    });

    function createTaskAs(user: TestUser, body: Record<string, unknown>) {
        return pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    }

    describe("creation", () => {
        test("rejects unauthenticated creation", async () => {
            const res = await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Nope",
                    status: "backlog",
                    board: ownerBoardId,
                }),
            });
            await expectStatus(res, 400, "unauthenticated task create");
        });

        test("creates a task on its own board", async () => {
            const res = await createTaskAs(owner, {
                title: "Write release notes",
                description: "Cover the board",
                status: "next",
                priority: "high",
                board_order: 2,
                labels: ["release"],
                board: ownerBoardId,
            });

            await expectStatus(res, 200, "create task");
            const task = await readJson<Record<string, unknown>>(res);
            expect(task.title).toBe("Write release notes");
            expect(task.status).toBe("next");
            expect(task.board).toBe(ownerBoardId);
            expect(task.labels).toEqual(["release"]);
        });

        test("rejects a task without a board", async () => {
            const res = await createTaskAs(owner, {
                title: "No board",
                status: "backlog",
            });
            await expectStatus(res, 400, "boardless task create");
        });

        test("rejects a task created on another user's board", async () => {
            const res = await createTaskAs(owner, {
                title: "Borrowed board",
                status: "backlog",
                board: otherBoardId,
            });
            await expectStatus(res, 400, "cross-author board task create");
        });

        test("rejects a task created on an archived board", async () => {
            const res = await createTaskAs(owner, {
                title: "Into the archive",
                status: "backlog",
                board: archivedBoardId,
            });
            await expectStatus(res, 400, "archived board task create");
        });

        test("rejects an unknown status", async () => {
            const res = await createTaskAs(owner, {
                title: "Bad status",
                status: "archived",
                board: ownerBoardId,
            });
            await expectStatus(res, 400, "unknown status");
        });
    });

    describe("ownership", () => {
        test("lists only the signed-in author's tasks", async () => {
            const otherTask = await createTask(other, otherBoardId, {
                title: "Someone else's task",
                status: "backlog",
            });

            const res = await pbList<{ id: string }>(owner.token, "tasks");
            const ids = res.items.map((task) => task.id);

            expect(ids).not.toContain(otherTask.id);
            expect(ids.length).toBeGreaterThan(0);
        });

        test("blocks another author from reading a task", async () => {
            const task = await createTask(owner, ownerBoardId, {
                title: "Owner only",
                status: "backlog",
            });

            const res = await pbRequest(`/collections/tasks/records/${task.id}`, {
                headers: { Authorization: other.token },
            });
            await expectStatus(res, 404, "cross-author task read");
        });

        test("blocks another author from updating or deleting a task", async () => {
            const task = await createTask(owner, ownerBoardId, {
                title: "Immutable for others",
                status: "backlog",
            });

            const updateRes = await pbRequest(`/collections/tasks/records/${task.id}`, {
                method: "PATCH",
                headers: { Authorization: other.token, "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Hijacked" }),
            });
            await expectStatus(updateRes, 404, "cross-author task update");

            const deleteRes = await pbRequest(`/collections/tasks/records/${task.id}`, {
                method: "DELETE",
                headers: { Authorization: other.token },
            });
            await expectStatus(deleteRes, 404, "cross-author task delete");
        });
    });

    describe("updates and ordering", () => {
        test("owner can move a task between columns and reorder it", async () => {
            const task = await createTask(owner, ownerBoardId, {
                title: "Move me",
                status: "backlog",
                board_order: 0,
            });

            const res = await pbRequest(`/collections/tasks/records/${task.id}`, {
                method: "PATCH",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ status: "progress", board_order: 3 }),
            });

            await expectStatus(res, 200, "move task");
            const updated = await readJson<{ status: string; board_order: number }>(res);
            expect(updated.status).toBe("progress");
            expect(updated.board_order).toBe(3);
        });

        test("owner cannot move a task to another user's board", async () => {
            const task = await createTask(owner, ownerBoardId, {
                title: "Stay here",
                status: "backlog",
            });

            const res = await pbRequest(`/collections/tasks/records/${task.id}`, {
                method: "PATCH",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ board: otherBoardId }),
            });
            expect([400, 403, 404]).toContain(res.status);
        });

        test("owner cannot move a task to an archived board", async () => {
            const task = await createTask(owner, ownerBoardId, {
                title: "Do not archive me",
                status: "backlog",
            });

            const res = await pbRequest(`/collections/tasks/records/${task.id}`, {
                method: "PATCH",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ board: archivedBoardId }),
            });
            expect([400, 404]).toContain(res.status);
        });

        test("rejects updating a task whose board is archived", async () => {
            const res = await pbRequest(`/collections/tasks/records/${archivedTaskId}`, {
                method: "PATCH",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Thawed", status: "done" }),
            });
            expect([400, 403, 404]).toContain(res.status);
        });

        test("still allows deleting a task whose board is archived", async () => {
            const res = await pbRequest(`/collections/tasks/records/${deletableArchivedTaskId}`, {
                method: "DELETE",
                headers: { Authorization: owner.token },
            });
            await expectStatus(res, 204, "delete archived-board task");
        });
    });
});
