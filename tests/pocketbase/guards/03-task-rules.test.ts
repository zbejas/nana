import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
} from "../../helpers/setup";

describe("Task collection rules", () => {
    let ownerToken: string;
    let ownerId: string;
    let otherToken: string;
    let otherId: string;
    let ownerBoardId: string;
    let otherBoardId: string;
    let archivedBoardId: string;
    let archivedBoardTaskId: string;
    let archivedBoardDeletableTaskId: string;

    beforeAll(async () => {
        const superuserToken = await authenticateSuperuser();

        const stamp = Date.now();
        const owner = await createTestUser(superuserToken, {
            email: `tasks-owner-${stamp}@test.local`,
            password: "testPassword123!",
            name: "Task Owner",
        });
        const other = await createTestUser(superuserToken, {
            email: `tasks-other-${stamp}@test.local`,
            password: "testPassword123!",
            name: "Task Other",
        });

        const ownerAuth = await authenticateUser(owner.email, "testPassword123!");
        ownerToken = ownerAuth.token;
        ownerId = ownerAuth.record.id;
        const otherAuth = await authenticateUser(other.email, "testPassword123!");
        otherToken = otherAuth.token;
        otherId = otherAuth.record.id;

        const ownerBoard = await createBoardRecord(
            { name: "Owner board", author: ownerId },
            ownerToken,
        );
        ownerBoardId = ownerBoard.id;

        const otherBoard = await createBoardRecord(
            { name: "Other board", author: otherId },
            otherToken,
        );
        otherBoardId = otherBoard.id;

        // Seed tasks while the board is still active, then archive it. Creating
        // new tasks on it later must be rejected.
        const archivedBoard = await createBoardRecord(
            { name: "Archived board", author: ownerId },
            ownerToken,
        );
        archivedBoardId = archivedBoard.id;

        const archivedTask = await createTaskRecord(
            {
                title: "Frozen task",
                status: "backlog",
                board_order: 0,
                author: ownerId,
                board: archivedBoardId,
            },
            ownerToken,
        );
        archivedBoardTaskId = archivedTask.id;

        const deletableTask = await createTaskRecord(
            {
                title: "Cleanup task",
                status: "backlog",
                board_order: 1,
                author: ownerId,
                board: archivedBoardId,
            },
            ownerToken,
        );
        archivedBoardDeletableTaskId = deletableTask.id;

        const archiveRes = await fetch(`${PB_API}/collections/boards/records/${archivedBoardId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: ownerToken },
            body: JSON.stringify({ archived: true }),
        });
        if (!archiveRes.ok) {
            throw new Error(`Failed to archive board (${archiveRes.status}): ${await archiveRes.text()}`);
        }
    });

    async function createBoard(body: Record<string, unknown>, token = ownerToken) {
        return fetch(`${PB_API}/collections/boards/records`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(body),
        });
    }

    async function createBoardRecord(
        body: Record<string, unknown>,
        token = ownerToken,
    ): Promise<{ id: string }> {
        const res = await createBoard(body, token);
        if (!res.ok) {
            throw new Error(`Failed to create board (${res.status}): ${await res.text()}`);
        }
        return res.json();
    }

    async function createTask(body: Record<string, unknown>, token = ownerToken) {
        return fetch(`${PB_API}/collections/tasks/records`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(body),
        });
    }

    async function createTaskRecord(
        body: Record<string, unknown>,
        token = ownerToken,
    ): Promise<{ id: string }> {
        const res = await createTask(body, token);
        if (!res.ok) {
            throw new Error(`Failed to create task (${res.status}): ${await res.text()}`);
        }
        return res.json();
    }

    test("rejects unauthenticated creation", async () => {
        const res = await fetch(`${PB_API}/collections/tasks/records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "Nope",
                status: "backlog",
                author: ownerId,
                board: ownerBoardId,
            }),
        });
        expect(res.status).toBe(400);
    });

    test("creates a task for its own author", async () => {
        const res = await createTask({
            title: "Write release notes",
            description: "Cover the board",
            status: "next",
            priority: "high",
            board_order: 2,
            labels: ["release"],
            author: ownerId,
            board: ownerBoardId,
        });

        expect(res.ok).toBe(true);
        const task = await res.json();
        expect(task.title).toBe("Write release notes");
        expect(task.status).toBe("next");
        expect(task.author).toBe(ownerId);
        expect(task.board).toBe(ownerBoardId);
        expect(task.labels).toEqual(["release"]);
    });

    test("rejects a task created under another author", async () => {
        const res = await createTask({
            title: "Injected",
            status: "backlog",
            author: "someone-else",
            board: ownerBoardId,
        });
        expect(res.status).toBe(400);
    });

    test("rejects a task without a board", async () => {
        const res = await createTask({
            title: "No board",
            status: "backlog",
            author: ownerId,
        });
        expect(res.status).toBe(400);
    });

    test("rejects a task created on another user's board", async () => {
        const res = await createTask({
            title: "Borrowed board",
            status: "backlog",
            author: ownerId,
            board: otherBoardId,
        });
        expect(res.status).toBe(400);
    });

    test("rejects a task created on an archived board", async () => {
        const res = await createTask({
            title: "Into the archive",
            status: "backlog",
            author: ownerId,
            board: archivedBoardId,
        });
        expect(res.status).toBe(400);
    });

    test("rejects an unknown status", async () => {
        const res = await createTask({
            title: "Bad status",
            status: "archived",
            author: ownerId,
            board: ownerBoardId,
        });
        expect(res.status).toBe(400);
    });

    test("lists only the signed-in author's tasks", async () => {
        const otherCreate = await createTask(
            {
                title: "Someone else's task",
                status: "backlog",
                author: otherId,
                board: otherBoardId,
            },
            otherToken,
        );
        expect(otherCreate.ok).toBe(true);
        const otherTask = await otherCreate.json();

        const res = await fetch(`${PB_API}/collections/tasks/records`, {
            headers: { Authorization: ownerToken },
        });
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data.items.every((task: { id: string }) => task.id !== otherTask.id)).toBe(true);
    });

    test("blocks another author from reading a task", async () => {
        const createRes = await createTask({
            title: "Owner only",
            status: "backlog",
            author: ownerId,
            board: ownerBoardId,
        });
        const task = await createRes.json();

        const res = await fetch(`${PB_API}/collections/tasks/records/${task.id}`, {
            headers: { Authorization: otherToken },
        });
        expect(res.status).toBe(404);
    });

    test("blocks another author from updating or deleting a task", async () => {
        const createRes = await createTask({
            title: "Immutable for others",
            status: "backlog",
            author: ownerId,
            board: ownerBoardId,
        });
        const task = await createRes.json();

        const updateRes = await fetch(`${PB_API}/collections/tasks/records/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: otherToken },
            body: JSON.stringify({ title: "Hijacked" }),
        });
        expect(updateRes.status).toBe(404);

        const deleteRes = await fetch(`${PB_API}/collections/tasks/records/${task.id}`, {
            method: "DELETE",
            headers: { Authorization: otherToken },
        });
        expect(deleteRes.status).toBe(404);
    });

    test("owner can move a task between columns and reorder it", async () => {
        const createRes = await createTask({
            title: "Move me",
            status: "backlog",
            board_order: 0,
            author: ownerId,
            board: ownerBoardId,
        });
        const task = await createRes.json();

        const res = await fetch(`${PB_API}/collections/tasks/records/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: ownerToken },
            body: JSON.stringify({ status: "progress", board_order: 3 }),
        });
        expect(res.ok).toBe(true);
        const updated = await res.json();
        expect(updated.status).toBe("progress");
        expect(updated.board_order).toBe(3);
    });

    test("rejects updating a task whose board is archived", async () => {
        const res = await fetch(`${PB_API}/collections/tasks/records/${archivedBoardTaskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: ownerToken },
            body: JSON.stringify({ title: "Thawed", status: "done" }),
        });
        expect(res.ok).toBe(false);
        expect([400, 403, 404]).toContain(res.status);
    });

    test("still allows deleting a task whose board is archived", async () => {
        const res = await fetch(`${PB_API}/collections/tasks/records/${archivedBoardDeletableTaskId}`, {
            method: "DELETE",
            headers: { Authorization: ownerToken },
        });
        expect(res.ok).toBe(true);
    });
});
