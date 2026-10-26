import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectStatus,
    pbCreate,
    pbList,
    pbRequest,
} from "../../helpers/client";
import {
    createBoard,
    createConversation,
    createFolder,
    createNote,
    createTask,
    createUser,
    getSuperuserToken,
    type TestRecord,
    type TestUser,
} from "../../helpers/factories";
import { uniqueSuffix } from "../../helpers/setup";

function patch(token: string, path: string, body: Record<string, unknown>) {
    return pbRequest(path, {
        method: "PATCH",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("Relation integrity", () => {
    let owner: TestUser;
    let other: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        owner = await createUser("relation-owner");
        other = await createUser("relation-other");
        superuserToken = await getSuperuserToken();
    });

    describe("create ownership", () => {
        test("documents, folders, boards, and conversations cannot be created for another author", async () => {
            const attempts: Array<[string, Record<string, unknown>]> = [
                ["documents", { title: "Injected", slug: "injected", author: other.id }],
                ["folders", { name: "Injected folder", author: other.id }],
                ["boards", { name: "Injected board", author: other.id }],
                ["conversations", { title: "Injected chat", author: other.id }],
            ];

            for (const [collection, body] of attempts) {
                const res = await pbRequest(`/collections/${collection}/records`, {
                    method: "POST",
                    headers: { Authorization: owner.token, "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                expect(res.ok).toBe(false);
                expect([400, 403]).toContain(res.status);
            }
        });
    });

    describe("ownership is immutable", () => {
        test("documents, folders, boards, and conversations reject author changes", async () => {
            const note = await createNote(owner);
            const folder = await createFolder(owner);
            const board = await createBoard(owner);
            const conversation = await createConversation(owner);

            const attempts: Array<[string, string]> = [
                ["documents", note.id],
                ["folders", folder.id],
                ["boards", board.id],
                ["conversations", conversation.id],
            ];

            for (const [collection, id] of attempts) {
                const res = await patch(
                    owner.token,
                    `/collections/${collection}/records/${id}`,
                    { author: other.id },
                );
                expect(res.ok).toBe(false);
                expect([400, 403]).toContain(res.status);
            }
        });
    });

    describe("folder relation", () => {
        test("a note cannot be filed into another user's folder", async () => {
            const foreignFolder = await createFolder(other);

            const res = await pbRequest("/collections/documents/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Foreign folder note",
                    slug: `foreign-${uniqueSuffix()}`,
                    author: owner.id,
                    folder: foreignFolder.id,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("a folder cannot be filed under a foreign parent", async () => {
            const foreignFolder = await createFolder(other);

            const res = await pbRequest("/collections/folders/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Foreign parent",
                    author: owner.id,
                    parent: foreignFolder.id,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("folder cycles and self-parenting are rejected", async () => {
            const parent = await createFolder(owner, { name: "Cycle parent" });
            const child = await createFolder(owner, { name: "Cycle child", parent: parent.id });

            const self = await patch(
                owner.token,
                `/collections/folders/records/${parent.id}`,
                { parent: parent.id },
            );
            expect(self.ok).toBe(false);
            expect([400, 403]).toContain(self.status);

            const cycle = await patch(
                owner.token,
                `/collections/folders/records/${parent.id}`,
                { parent: child.id },
            );
            expect(cycle.ok).toBe(false);
            expect([400, 403]).toContain(cycle.status);
        });
    });

    describe("task note relation", () => {
        test("a task cannot link another user's note", async () => {
            const board = await createBoard(owner);
            const foreignNote = await createNote(other);

            const res = await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Foreign note task",
                    status: "backlog",
                    board: board.id,
                    document: foreignNote.id,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("an existing task can still be updated after its note is trashed", async () => {
            const board = await createBoard(owner);
            const note = await createNote(owner);
            const task = await createTask(owner, board.id, { document: note.id });

            const moved = await pbRequest("/trash/move-document", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: note.id }),
            });
            await expectStatus(moved, 200, "move linked note to trash");

            const res = await patch(
                owner.token,
                `/collections/tasks/records/${task.id}`,
                { title: "Renamed while linked" },
            );
            await expectStatus(res, 200, "update task with trashed note link");
        });

        test("a task cannot link a trashed note", async () => {
            const board = await createBoard(owner);
            const note = await createNote(owner);

            const moved = await pbRequest("/trash/move-document", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: note.id }),
            });
            await expectStatus(moved, 200, "move note to trash");

            const res = await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Trashed note task",
                    status: "backlog",
                    board: board.id,
                    document: note.id,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });

    describe("messages", () => {
        test("messages cannot be created under another user's conversation", async () => {
            const foreignConversation = await createConversation(other);

            const res = await pbRequest("/collections/messages/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversation: foreignConversation.id,
                    role: "user",
                    content: "Injected message",
                    position: 100,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403, 404]).toContain(res.status);

            const ownList = await pbList<{ id: string }>(other.token, "messages", {
                filter: `conversation='${foreignConversation.id}'`,
            });
            expect(ownList.items).toHaveLength(1);
        });
    });

    describe("unique share tokens", () => {
        test("a duplicate public share token is rejected", async () => {
            const token = `share-${uniqueSuffix()}`;
            const first = await pbCreate<TestRecord>(owner.token, "documents", {
                title: "Shared first",
                slug: `shared-first-${uniqueSuffix()}`,
                author: owner.id,
                is_public: true,
                public_share_token: token,
            });

            expect(first.public_share_token).toBe(token);

            const duplicate = await pbRequest("/collections/documents/records", {
                method: "POST",
                headers: { Authorization: owner.token, "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Shared second",
                    slug: `shared-second-${uniqueSuffix()}`,
                    author: owner.id,
                    is_public: true,
                    public_share_token: token,
                }),
            });

            expect(duplicate.ok).toBe(false);
            expect([400, 403]).toContain(duplicate.status);
        });
    });

    describe("user deletion", () => {
        test("a user with workspace content cannot be deleted", async () => {
            const unverified = await createUser("relation-deletable", { verified: false });
            await createNote(unverified, { title: "Owned content" });

            const res = await pbRequest(`/collections/users/records/${unverified.id}`, {
                method: "DELETE",
                headers: { Authorization: superuserToken },
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });
});
