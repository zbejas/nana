import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectJsonError,
    expectStatus,
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
    superuserUpdate,
    type TestUser,
} from "../../helpers/factories";
import { uniqueSuffix } from "../../helpers/setup";

const PUBLIC_API = "/public";

describe("Public share routes", () => {
    let user: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        user = await createUser("public-share");
        superuserToken = await getSuperuserToken();
    });

    function uniqueToken(): string {
        return `share-${uniqueSuffix()}`;
    }

    async function shareDocument(
        noteId: string,
        token: string,
        flags: Record<string, unknown> = {},
    ) {
        return superuserUpdate("documents", noteId, {
            is_public: true,
            public_share_token: token,
            ...flags,
        });
    }

    async function shareFolder(
        folderId: string,
        token: string,
        flags: Record<string, unknown> = {},
    ) {
        return superuserUpdate("folders", folderId, {
            is_public: true,
            public_share_token: token,
            ...flags,
        });
    }

    async function shareBoard(
        boardId: string,
        token: string,
        flags: Record<string, unknown> = {},
    ) {
        return superuserUpdate("boards", boardId, {
            is_public: true,
            public_share_token: token,
            ...flags,
        });
    }

    describe("documents", () => {
        test("returns 404 for an unknown token", async () => {
            await expectJsonError(
                await pbRequest(`${PUBLIC_API}/documents/does-not-exist-token`),
                404,
            );
        });

        test("returns 404 when is_public is false", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await superuserUpdate("documents", note.id, {
                is_public: false,
                public_share_token: token,
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("returns 404 when is_private overrides a public flag", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await superuserUpdate("documents", note.id, {
                is_public: true,
                is_private: true,
                public_share_token: token,
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("returns 404 for an expired share and disables it", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, {
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);

            const stored = await pbRequest(`/collections/documents/records/${note.id}`, {
                headers: { Authorization: user.token },
            });
            const record = await readJson<{ is_public: boolean; public_share_token: string }>(stored);
            expect(record.is_public).toBe(false);
            expect(record.public_share_token).toBe("");
        });

        test("trashing a shared document disables the link", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token);

            const moved = await pbRequest("/trash/move-document", {
                method: "POST",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: note.id }),
            });
            await expectStatus(moved, 200, "move shared document to trash");

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);

            const stored = await readJson<{
                is_public: boolean;
                public_share_token: string;
                deleted_at: string;
            }>(
                await pbRequest(`/collections/documents/records/${note.id}`, {
                    headers: { Authorization: superuserToken },
                }),
            );
            expect(stored.is_public).toBe(false);
            expect(stored.public_share_token).toBe("");
            expect(stored.deleted_at.length).toBeGreaterThan(0);
        });

        test("returns the document and author for a valid share", async () => {
            const token = uniqueToken();
            const note = await createNote(user, {
                title: "Public Doc",
                content: "public content here",
            });
            await shareDocument(note.id, token, { share_attachments: false });

            const res = await pbRequest(`${PUBLIC_API}/documents/${token}`);
            await expectStatus(res, 200);
            const data = await readJson<{
                type: string;
                shareToken: string;
                shareAttachments: boolean;
                author: { id: string; name: string };
                document: Record<string, unknown>;
                expiresAt: string | null;
            }>(res);

            expect(data.type).toBe("document");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author.id).toBe(user.id);
            expect(data.author.name).toBeTruthy();
            expect(data.document.id).toBe(note.id);
            expect(data.document.title).toBe("Public Doc");
            expect(data.document.content).toBe("public content here");
            expect(data.expiresAt).toBeNull();
        });

        test("exposes the documented document fields", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token);

            const data = await readJson<{ document: Record<string, unknown> }>(
                await pbRequest(`${PUBLIC_API}/documents/${token}`),
            );

            expect(Object.keys(data.document).sort()).toEqual(
                [
                    "id",
                    "title",
                    "slug",
                    "content",
                    "attachments",
                    "tags",
                    "author",
                    "folder",
                    "word_count",
                    "reading_time",
                    "created",
                    "updated",
                ].sort(),
            );
        });

        test("returns a future expiry", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, {
                public_expires_at: "2099-12-31 23:59:59.000Z",
            });

            const data = await readJson<{ expiresAt: string | null }>(
                await pbRequest(`${PUBLIC_API}/documents/${token}`),
            );
            expect(data.expiresAt).toBeTruthy();
        });
    });

    describe("document attachments", () => {
        test("serves an attachment when sharing is enabled", async () => {
            const token = uniqueToken();
            const body = new TextEncoder().encode("public attachment");
            const note = await createNoteWithAttachment(user, "public.txt", body);
            const storedName = (note.attachments as string[])[0]!;
            await shareDocument(note.id, token, { share_attachments: true });

            const res = await pbRequest(
                `${PUBLIC_API}/documents/${token}/files/${encodeURIComponent(storedName)}`,
            );
            await expectStatus(res, 200, "public attachment");
            expect(await res.text()).toBe("public attachment");
        });

        test("returns 404 when attachment sharing is disabled", async () => {
            const token = uniqueToken();
            const note = await createNoteWithAttachment(user, "private.txt", new Uint8Array([1]));
            const storedName = (note.attachments as string[])[0]!;
            await shareDocument(note.id, token, { share_attachments: false });

            await expectJsonError(
                await pbRequest(
                    `${PUBLIC_API}/documents/${token}/files/${encodeURIComponent(storedName)}`,
                ),
                404,
            );
        });

        test("returns 404 for an unknown filename or token", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, { share_attachments: true });

            await expectStatus(
                await pbRequest(`${PUBLIC_API}/documents/${token}/files/nonexistent.png`),
                404,
            );
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/documents/fake-token/files/test.png`),
                404,
            );
        });
    });

    describe("folders", () => {
        test("returns 404 for unknown, private, or expired folders", async () => {
            await expectJsonError(await pbRequest(`${PUBLIC_API}/folders/does-not-exist-token`), 404);

            const privateToken = uniqueToken();
            const privateFolder = await createFolder(user);
            await superuserUpdate("folders", privateFolder.id, {
                is_public: true,
                is_private: true,
                public_share_token: privateToken,
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${privateToken}`), 404);

            const expiredToken = uniqueToken();
            const expiredFolder = await createFolder(user);
            await shareFolder(expiredFolder.id, expiredToken, {
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${expiredToken}`), 404);

            const stored = await readJson<{ is_public: boolean; public_share_token: string }>(
                await pbRequest(`/collections/folders/records/${expiredFolder.id}`, {
                    headers: { Authorization: user.token },
                }),
            );
            expect(stored.is_public).toBe(false);
            expect(stored.public_share_token).toBe("");
        });

        test("returns the folder tree and its documents", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Public Folder" });
            const child = await createFolder(user, { name: "Public Child", parent: folder.id });
            const rootDoc = await createNote(user, { title: "Root doc", folder: folder.id });
            const childDoc = await createNote(user, { title: "Child doc", folder: child.id });
            await shareFolder(folder.id, token, { share_attachments: false });

            const res = await pbRequest(`${PUBLIC_API}/folders/${token}`);
            await expectStatus(res, 200);
            const data = await readJson<{
                type: string;
                shareToken: string;
                shareAttachments: boolean;
                author: { id: string };
                rootFolder: { id: string; name: string };
                folders: Array<{ id: string }>;
                documents: Array<{ id: string }>;
                entryDocumentId: string | null;
                expiresAt: string | null;
            }>(res);

            expect(data.type).toBe("folder");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author.id).toBe(user.id);
            expect(data.rootFolder.id).toBe(folder.id);
            expect(data.rootFolder.name).toBe("Public Folder");
            expect(data.folders.map((item) => item.id)).toEqual(
                expect.arrayContaining([folder.id, child.id]),
            );
            expect(data.documents.map((item) => item.id)).toEqual(
                expect.arrayContaining([rootDoc.id, childDoc.id]),
            );
            expect(data.entryDocumentId).toBeTruthy();
            expect(data.expiresAt).toBeNull();
        });

        test("returns boards in the shared folder tree with their tasks", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Board folder" });
            const child = await createFolder(user, { name: "Board child", parent: folder.id });
            const rootBoard = await createBoard(user, {
                name: "Root board",
                description: "The shared plan",
                folder: folder.id,
            });
            const childBoard = await createBoard(user, {
                name: "Child board",
                folder: child.id,
            });
            const linkedNote = await createNote(user, { title: "Linked note" });
            const firstTask = await createTask(user, rootBoard.id, {
                title: "First task",
                status: "done",
                board_order: 1,
                labels: ["release"],
            });
            const secondTask = await createTask(user, rootBoard.id, {
                title: "Second task",
                status: "next",
                priority: "high",
                board_order: 2,
                document: linkedNote.id,
            });
            await createTask(user, childBoard.id, { title: "Child task" });
            await shareFolder(folder.id, token);

            const data = await readJson<{
                boards: Array<{
                    id: string;
                    name: string;
                    description: string;
                    folder: string;
                    tasks: Array<Record<string, unknown>>;
                }>;
                documents: unknown[];
                entryDocumentId: string | null;
            }>(await pbRequest(`${PUBLIC_API}/folders/${token}`));

            expect(data.documents).toEqual([]);
            expect(data.entryDocumentId).toBeNull();
            expect(data.boards.map((board) => board.id)).toEqual(
                expect.arrayContaining([rootBoard.id, childBoard.id]),
            );

            const serializedRoot = data.boards.find((board) => board.id === rootBoard.id)!;
            expect(serializedRoot.name).toBe("Root board");
            expect(serializedRoot.description).toBe("The shared plan");
            expect(serializedRoot.folder).toBe(folder.id);
            expect(serializedRoot.tasks.map((task) => task.id)).toEqual([
                firstTask.id,
                secondTask.id,
            ]);
            expect(serializedRoot.tasks.map((task) => task.title)).toEqual([
                "First task",
                "Second task",
            ]);
            expect(serializedRoot.tasks[0]?.status).toBe("done");
            expect(serializedRoot.tasks[0]?.labels).toEqual(["release"]);
            expect(Object.keys(serializedRoot.tasks[0]!).sort()).toEqual(
                [
                    "id",
                    "title",
                    "description",
                    "status",
                    "priority",
                    "due_date",
                    "start_date",
                    "completed_at",
                    "task_number",
                    "board_order",
                    "labels",
                    "assignee",
                    "created",
                    "updated",
                ].sort(),
            );
            expect(serializedRoot.tasks[0]).not.toHaveProperty("document");
            expect(serializedRoot.tasks[0]).not.toHaveProperty("author");
            expect(serializedRoot.tasks[0]).not.toHaveProperty("board");
            expect(serializedRoot.tasks[1]).not.toHaveProperty("document");
        });

        test("excludes private, archived, and outside boards from a folder share", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Visible folder" });
            const privateChild = await createFolder(user, { name: "Private child", parent: folder.id });
            const outside = await createFolder(user, { name: "Outside folder" });
            const visible = await createBoard(user, { folder: folder.id });
            const privateBoard = await createBoard(user, { folder: folder.id });
            const archivedBoard = await createBoard(user, { folder: folder.id, archived: true });
            const privateSubtreeBoard = await createBoard(user, { folder: privateChild.id });
            const outsideBoard = await createBoard(user, { folder: outside.id });

            await superuserUpdate("boards", privateBoard.id, { is_private: true });
            await superuserUpdate("folders", privateChild.id, { is_private: true });
            await shareFolder(folder.id, token);

            const data = await readJson<{ boards: Array<{ id: string }> }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );
            const boardIds = data.boards.map((board) => board.id);

            expect(boardIds).toContain(visible.id);
            expect(boardIds).not.toContain(privateBoard.id);
            expect(boardIds).not.toContain(archivedBoard.id);
            expect(boardIds).not.toContain(privateSubtreeBoard.id);
            expect(boardIds).not.toContain(outsideBoard.id);
        });

        test("exposes the documented folder fields", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            await shareFolder(folder.id, token);

            const data = await readJson<{ rootFolder: Record<string, unknown>; folders: unknown[]; documents: unknown[]; boards: unknown[]; entryDocumentId: unknown }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );

            expect(Object.keys(data.rootFolder).sort()).toEqual(
                ["id", "name", "parent", "author", "color", "created", "updated"].sort(),
            );
            expect(Array.isArray(data.folders)).toBe(true);
            expect(Array.isArray(data.documents)).toBe(true);
            expect(Array.isArray(data.boards)).toBe(true);
            expect(data).toHaveProperty("entryDocumentId");
        });

        test("excludes private documents and private subfolders", async () => {
            const token = uniqueToken();
            const root = await createFolder(user, { name: "Root" });
            const publicChild = await createFolder(user, { name: "Public child", parent: root.id });
            const privateChild = await createFolder(user, { name: "Private child", parent: root.id });
            const publicDoc = await createNote(user, { folder: root.id });
            const privateDoc = await createNote(user, { folder: publicChild.id });

            await superuserUpdate("folders", privateChild.id, { is_private: true });
            await superuserUpdate("documents", privateDoc.id, { is_private: true });
            await shareFolder(root.id, token);

            const data = await readJson<{
                folders: Array<{ id: string }>;
                documents: Array<{ id: string }>;
            }>(await pbRequest(`${PUBLIC_API}/folders/${token}`));

            expect(data.folders.map((item) => item.id)).toContain(publicChild.id);
            expect(data.folders.map((item) => item.id)).not.toContain(privateChild.id);
            expect(data.documents.map((item) => item.id)).toContain(publicDoc.id);
            expect(data.documents.map((item) => item.id)).not.toContain(privateDoc.id);
        });

        test("excludes documents outside the shared subtree", async () => {
            const token = uniqueToken();
            const shared = await createFolder(user, { name: "Shared" });
            const outside = await createFolder(user, { name: "Outside" });
            const outsideDoc = await createNote(user, { folder: outside.id });
            await shareFolder(shared.id, token);

            const data = await readJson<{ documents: Array<{ id: string }> }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );
            expect(data.documents.map((item) => item.id)).not.toContain(outsideDoc.id);
        });

        test("entryDocumentId is null for an empty folder", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            await shareFolder(folder.id, token);

            const data = await readJson<{ entryDocumentId: string | null }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );
            expect(data.entryDocumentId).toBeNull();
        });
    });

    describe("boards", () => {
        test("returns 404 for unknown, private, archived, or expired boards", async () => {
            await expectJsonError(await pbRequest(`${PUBLIC_API}/boards/does-not-exist-token`), 404);

            const privateToken = uniqueToken();
            const privateBoard = await createBoard(user);
            await shareBoard(privateBoard.id, privateToken, { is_private: true });
            await expectStatus(await pbRequest(`${PUBLIC_API}/boards/${privateToken}`), 404);

            const archivedToken = uniqueToken();
            const archivedBoard = await createBoard(user, { archived: true });
            await shareBoard(archivedBoard.id, archivedToken);
            await expectStatus(await pbRequest(`${PUBLIC_API}/boards/${archivedToken}`), 404);

            const expiredToken = uniqueToken();
            const expiredBoard = await createBoard(user);
            await shareBoard(expiredBoard.id, expiredToken, {
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/boards/${expiredToken}`), 404);

            const stored = await readJson<{ is_public: boolean; public_share_token: string }>(
                await pbRequest(`/collections/boards/records/${expiredBoard.id}`, {
                    headers: { Authorization: user.token },
                }),
            );
            expect(stored.is_public).toBe(false);
            expect(stored.public_share_token).toBe("");
        });

        test("returns the board and its tasks in board order", async () => {
            const token = uniqueToken();
            const board = await createBoard(user, {
                name: "Public Board",
                description: "The shared plan",
            });
            const otherBoard = await createBoard(user, { name: "Other Board" });
            const linkedNote = await createNote(user, { title: "Private linked note" });
            const second = await createTask(user, board.id, {
                title: "Second task",
                status: "next",
                priority: "high",
                board_order: 2,
                labels: ["release"],
            });
            const first = await createTask(user, board.id, {
                title: "First task",
                status: "done",
                board_order: 1,
                document: linkedNote.id,
            });
            await createTask(user, otherBoard.id, { title: "Other board task" });
            await shareBoard(board.id, token);

            const res = await pbRequest(`${PUBLIC_API}/boards/${token}`);
            await expectStatus(res, 200);
            const data = await readJson<{
                type: string;
                shareToken: string;
                author: { id: string; name: string };
                board: Record<string, unknown>;
                tasks: Array<Record<string, unknown>>;
                expiresAt: string | null;
            }>(res);

            expect(data.type).toBe("board");
            expect(data.shareToken).toBe(token);
            expect(data.author.id).toBe(user.id);
            expect(data.expiresAt).toBeNull();
            expect(data.board.id).toBe(board.id);
            expect(data.board.name).toBe("Public Board");
            expect(data.board.description).toBe("The shared plan");
            expect(Object.keys(data.board).sort()).toEqual(
                ["id", "name", "description", "icon", "author", "folder", "columns", "created", "updated"].sort(),
            );
            expect(data.board.columns).toBeInstanceOf(Array);
            expect((data.board.columns as Array<{ slug: string; is_final: boolean }>).map((column) => column.slug))
                .toEqual(["backlog", "next", "progress", "done"]);
            expect((data.board.columns as Array<{ slug: string; is_final: boolean }>)
                .find((column) => column.slug === "done")?.is_final).toBe(true);
            expect(data.tasks.map((task) => task.id)).toEqual([first.id, second.id]);
            expect(data.tasks.map((task) => task.title)).toEqual(["First task", "Second task"]);
            expect(data.tasks[0]?.status).toBe("done");
            expect(data.tasks[1]?.labels).toEqual(["release"]);

            // Linked notes and ownership fields stay out of the public payload.
            expect(Object.keys(data.tasks[0]!).sort()).toEqual(
                [
                    "id",
                    "title",
                    "description",
                    "status",
                    "priority",
                    "due_date",
                    "start_date",
                    "completed_at",
                    "task_number",
                    "board_order",
                    "labels",
                    "assignee",
                    "created",
                    "updated",
                ].sort(),
            );
            expect(data.tasks[0]).not.toHaveProperty("document");
            expect(data.tasks[0]).not.toHaveProperty("author");
            expect(data.tasks[0]).not.toHaveProperty("board");
        });

        test("returns an empty task list for a board with no tasks", async () => {
            const token = uniqueToken();
            const board = await createBoard(user);
            await shareBoard(board.id, token);

            const data = await readJson<{ tasks: unknown[] }>(
                await pbRequest(`${PUBLIC_API}/boards/${token}`),
            );
            expect(data.tasks).toEqual([]);
        });
    });

    describe("private and trashed ancestor folders", () => {
        test("a public note inside a private folder subtree returns 404", async () => {
            const token = uniqueToken();
            const outer = await createFolder(user, { name: "Outer public" });
            const inner = await createFolder(user, { name: "Inner public", parent: outer.id });
            const note = await createNote(user, { folder: inner.id });
            await shareDocument(note.id, token);

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 200);
            await superuserUpdate("folders", outer.id, { is_private: true });
            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("a public board inside a private folder returns 404", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Board ancestor" });
            const board = await createBoard(user, { folder: folder.id });
            await shareBoard(board.id, token);

            await expectStatus(await pbRequest(`${PUBLIC_API}/boards/${token}`), 200);
            await superuserUpdate("folders", folder.id, { is_private: true });
            await expectStatus(await pbRequest(`${PUBLIC_API}/boards/${token}`), 404);
        });

        test("a public note under a trashed ancestor folder returns 404", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Trashed ancestor" });
            const note = await createNote(user, { folder: folder.id });
            await shareDocument(note.id, token);
            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 200);

            // Set the trash state directly so the note's token is not cleared
            // by the folder trash route; the ancestor walk alone must hide it.
            await superuserUpdate("folders", folder.id, {
                deleted_at: "2024-01-01 00:00:00.000Z",
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("a public folder under a private parent returns 404", async () => {
            const token = uniqueToken();
            const parent = await createFolder(user, { name: "Private parent" });
            const child = await createFolder(user, { name: "Public child", parent: parent.id });
            await shareFolder(child.id, token);

            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${token}`), 200);
            await superuserUpdate("folders", parent.id, { is_private: true });
            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${token}`), 404);
        });
    });

    describe("folder attachments", () => {
        test("serves a document attachment inside the shared tree", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Attachment folder" });
            const body = new TextEncoder().encode("folder attachment");
            const note = await createNoteWithAttachment(user, "inside.txt", body, "text/plain", {
                folder: folder.id,
            });
            const storedName = (note.attachments as string[])[0]!;
            await shareFolder(folder.id, token, { share_attachments: true });

            const res = await pbRequest(
                `${PUBLIC_API}/folders/${token}/files/${note.id}/${encodeURIComponent(storedName)}`,
            );
            await expectStatus(res, 200, "folder attachment");
            expect(await res.text()).toBe("folder attachment");
        });

        test("rejects disabled sharing, unknown files, private docs, and outside docs", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            const outside = await createFolder(user);
            const doc = await createNoteWithAttachment(user, "hidden.txt", new Uint8Array([1]), "text/plain", {
                folder: folder.id,
            });
            const outsideDoc = await createNote(user, { folder: outside.id });
            const storedName = (doc.attachments as string[])[0]!;

            await shareFolder(folder.id, token, { share_attachments: false });
            await expectStatus(
                await pbRequest(
                    `${PUBLIC_API}/folders/${token}/files/${doc.id}/${encodeURIComponent(storedName)}`,
                ),
                404,
            );

            await shareFolder(folder.id, token, { share_attachments: true });
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/${token}/files/${doc.id}/nonexistent.png`),
                404,
            );
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/fake-token/files/${doc.id}/test.png`),
                404,
            );

            await superuserUpdate("documents", doc.id, { is_private: true });
            await expectStatus(
                await pbRequest(
                    `${PUBLIC_API}/folders/${token}/files/${doc.id}/${encodeURIComponent(storedName)}`,
                ),
                404,
            );

            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/${token}/files/${outsideDoc.id}/test.png`),
                404,
            );
        });
    });
});
