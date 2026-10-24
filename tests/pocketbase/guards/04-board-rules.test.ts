import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
} from "../../helpers/setup";

describe("Board collection rules", () => {
    let superuserToken: string;
    let ownerToken: string;
    let ownerId: string;
    let otherToken: string;
    let otherId: string;
    let ownerBoardId: string;
    let otherBoardId: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        const stamp = Date.now();
        const owner = await createTestUser(superuserToken, {
            email: `boards-owner-${stamp}@test.local`,
            password: "testPassword123!",
            name: "Board Owner",
        });
        const other = await createTestUser(superuserToken, {
            email: `boards-other-${stamp}@test.local`,
            password: "testPassword123!",
            name: "Board Other",
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

    async function createTaskRecord(
        body: Record<string, unknown>,
        token = ownerToken,
    ): Promise<{ id: string }> {
        const res = await fetch(`${PB_API}/collections/tasks/records`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            throw new Error(`Failed to create task (${res.status}): ${await res.text()}`);
        }
        return res.json();
    }

    async function setArchived(id: string, archived: boolean, token = ownerToken) {
        return fetch(`${PB_API}/collections/boards/records/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify({ archived }),
        });
    }

    test("lists only the signed-in author's boards", async () => {
        const res = await fetch(`${PB_API}/collections/boards/records`, {
            headers: { Authorization: ownerToken },
        });
        expect(res.ok).toBe(true);
        const data = await res.json();
        const ids = data.items.map((board: { id: string }) => board.id);
        expect(ids).toContain(ownerBoardId);
        expect(ids).not.toContain(otherBoardId);
    });

    test("creates a board for its own author", async () => {
        const res = await createBoard({
            name: "Release board",
            description: "Ship the thing",
            author: ownerId,
        });
        expect(res.ok).toBe(true);
        const board = await res.json();
        expect(board.name).toBe("Release board");
        expect(board.description).toBe("Ship the thing");
        expect(board.archived).toBe(false);
        expect(board.author).toBe(ownerId);
    });

    test("rejects a board created under another author", async () => {
        const res = await createBoard({
            name: "Injected board",
            author: otherId,
        });
        expect(res.status).toBe(400);
    });

    test("owner can update a board", async () => {
        const res = await fetch(`${PB_API}/collections/boards/records/${ownerBoardId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: ownerToken },
            body: JSON.stringify({ name: "Renamed board", description: "Updated" }),
        });
        expect(res.ok).toBe(true);
        const board = await res.json();
        expect(board.name).toBe("Renamed board");
        expect(board.description).toBe("Updated");
    });

    test("owner can archive and restore a board", async () => {
        const created = await createBoardRecord(
            { name: "Seasonal board", author: ownerId },
            ownerToken,
        );

        const archiveRes = await setArchived(created.id, true);
        expect(archiveRes.ok).toBe(true);
        expect((await archiveRes.json()).archived).toBe(true);

        const restoreRes = await setArchived(created.id, false);
        expect(restoreRes.ok).toBe(true);
        expect((await restoreRes.json()).archived).toBe(false);
    });

    test("blocks another user from listing the owner's boards", async () => {
        const res = await fetch(`${PB_API}/collections/boards/records`, {
            headers: { Authorization: otherToken },
        });
        expect(res.ok).toBe(true);
        const data = await res.json();
        const ids = data.items.map((board: { id: string }) => board.id);
        expect(ids).toContain(otherBoardId);
        expect(ids).not.toContain(ownerBoardId);
    });

    test("blocks another user from viewing, updating, or deleting a board", async () => {
        const viewRes = await fetch(`${PB_API}/collections/boards/records/${ownerBoardId}`, {
            headers: { Authorization: otherToken },
        });
        expect(viewRes.status).toBe(404);

        const updateRes = await fetch(`${PB_API}/collections/boards/records/${ownerBoardId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: otherToken },
            body: JSON.stringify({ name: "Hijacked" }),
        });
        expect(updateRes.status).toBe(404);

        const deleteRes = await fetch(`${PB_API}/collections/boards/records/${ownerBoardId}`, {
            method: "DELETE",
            headers: { Authorization: otherToken },
        });
        expect(deleteRes.status).toBe(404);
    });

    test("rejects deleting a board that is not archived", async () => {
        const created = await createBoardRecord(
            { name: "Still active", author: ownerId },
            ownerToken,
        );

        const res = await fetch(`${PB_API}/collections/boards/records/${created.id}`, {
            method: "DELETE",
            headers: { Authorization: ownerToken },
        });
        expect(res.ok).toBe(false);
        expect([403, 404]).toContain(res.status);
    });

    test("deleting an archived board cascades its tasks and leaves others intact", async () => {
        const doomed = await createBoardRecord(
            { name: "Doomed board", author: ownerId },
            ownerToken,
        );
        const keep = await createBoardRecord(
            { name: "Keep board", author: ownerId },
            ownerToken,
        );

        const doomedTaskA = await createTaskRecord(
            {
                title: "Doomed A",
                status: "backlog",
                author: ownerId,
                board: doomed.id,
            },
            ownerToken,
        );
        const doomedTaskB = await createTaskRecord(
            {
                title: "Doomed B",
                status: "progress",
                author: ownerId,
                board: doomed.id,
            },
            ownerToken,
        );
        const keptTask = await createTaskRecord(
            {
                title: "Kept",
                status: "backlog",
                author: ownerId,
                board: keep.id,
            },
            ownerToken,
        );
        const otherTask = await createTaskRecord(
            {
                title: "Other user's task",
                status: "backlog",
                author: otherId,
                board: otherBoardId,
            },
            otherToken,
        );

        const archiveRes = await setArchived(doomed.id, true);
        expect(archiveRes.ok).toBe(true);

        const deleteRes = await fetch(`${PB_API}/collections/boards/records/${doomed.id}`, {
            method: "DELETE",
            headers: { Authorization: ownerToken },
        });
        expect(deleteRes.ok).toBe(true);

        for (const taskId of [doomedTaskA.id, doomedTaskB.id]) {
            const taskRes = await fetch(`${PB_API}/collections/tasks/records/${taskId}`, {
                headers: { Authorization: superuserToken },
            });
            expect(taskRes.status).toBe(404);
        }

        const keepBoardRes = await fetch(`${PB_API}/collections/boards/records/${keep.id}`, {
            headers: { Authorization: ownerToken },
        });
        expect(keepBoardRes.ok).toBe(true);

        const keptTaskRes = await fetch(`${PB_API}/collections/tasks/records/${keptTask.id}`, {
            headers: { Authorization: ownerToken },
        });
        expect(keptTaskRes.ok).toBe(true);

        const otherBoardRes = await fetch(`${PB_API}/collections/boards/records/${otherBoardId}`, {
            headers: { Authorization: otherToken },
        });
        expect(otherBoardRes.ok).toBe(true);

        const otherTaskRes = await fetch(`${PB_API}/collections/tasks/records/${otherTask.id}`, {
            headers: { Authorization: otherToken },
        });
        expect(otherTaskRes.ok).toBe(true);
    });
});
