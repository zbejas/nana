import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectStatus,
    pbCreate,
    pbList,
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
    superuserUpdate,
    type TestRecord,
    type TestUser,
} from "../../helpers/factories";
import { authHeaders, uniqueSuffix } from "../../helpers/setup";

/**
 * User-to-user sharing: route registration, owner-only management, the
 * view/comment/edit permission matrix, folder inheritance, private/archived
 * target rejection, grant rebuilds, comments, and the user directory.
 */

interface ShareRow {
    id: string;
    targetType: string;
    targetId: string;
    permission: string;
    level: number;
    user: { id: string; name: string; avatar: string; email?: string };
    sharedBy: { id: string; name: string; avatar: string; email?: string };
}

interface SharedItem {
    id: string;
    shareId: string;
    grantId: string;
    type: string;
    permission: string;
    level: number;
    inherited: boolean;
    sharedBy: { id: string; name: string; avatar: string; email?: string } | null;
    target: { id: string; title?: string; name?: string };
}

interface SharedList {
    items: SharedItem[];
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
}

interface CommentRow {
    id: string;
    targetType: string;
    targetId: string;
    body: string;
    author: { id: string; name: string };
    canEdit: boolean;
    canDelete: boolean;
}

interface CommentList {
    items: CommentRow[];
    permission: string;
    canComment: boolean;
}

interface DirectoryItem {
    id: string;
    name: string;
    avatar: string;
    email?: string;
    admin?: boolean;
    verified?: boolean;
}

function sharing(path: string, options: {
    method?: string;
    token?: string;
    body?: unknown;
} = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = options.token;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return pbRequest(`/sharing${path}`, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
}

async function createShare(
    token: string,
    targetType: string,
    targetId: string,
    userId: string,
    permission = "view",
): Promise<ShareRow> {
    const res = await sharing("/links", {
        token,
        body: { targetType, targetId, userId, permission },
    });
    await expectStatus(res, 200, `share ${targetType}`);
    return readJson<ShareRow>(res, `share ${targetType}`);
}

async function deleteShare(token: string, shareId: string): Promise<void> {
    const res = await sharing(`/links/${encodeURIComponent(shareId)}`, {
        method: "DELETE",
        token,
    });
    await expectStatus(res, 200, "delete share");
}

async function sharedWithMe(token: string): Promise<SharedList> {
    const res = await sharing("/shared", { token });
    await expectStatus(res, 200, "shared list");
    return readJson<SharedList>(res, "shared list");
}

function recordExists(token: string, collection: string, id: string): Promise<boolean> {
    return pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        headers: authHeaders(token),
    }).then((res) => res.ok);
}

function patch(token: string, collection: string, id: string, body: Record<string, unknown>): Promise<Response> {
    return pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: authHeaders(token, true),
        body: JSON.stringify(body),
    });
}

function remove(token: string, collection: string, id: string): Promise<Response> {
    return pbRequest(`/collections/${collection}/records/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(token),
    });
}

describe("user sharing routes and directory", () => {
    let owner: TestUser;
    let searcher: TestUser;
    let searcherName: string;

    beforeAll(async () => {
        owner = await createUser("share-directory-owner", { name: `Owner ${uniqueSuffix()}` });
        searcherName = `Directory ${uniqueSuffix()}`;
        searcher = await createUser("share-directory-user", { name: searcherName });
    });

    test("registers the sharing routes", async () => {
        const users = await sharing("/users", { token: owner.token });
        await expectStatus(users, 200, "sharing users route");

        const shared = await sharing("/shared", { token: owner.token });
        await expectStatus(shared, 200, "sharing shared route");
        const list = await readJson<SharedList>(shared, "sharing shared route");
        expect(Array.isArray(list.items)).toBe(true);

        const unauthorized = await sharing("/shared");
        await expectStatus(unauthorized, 401, "sharing requires auth");
    });

    test("exposes only name/avatar for name search and email for an exact address", async () => {
        const byName = await sharing(`/users?q=${encodeURIComponent(searcherName.split(" ")[0]!)}`, {
            token: owner.token,
        });
        await expectStatus(byName, 200, "name search");
        const nameItems = (await readJson<{ items: DirectoryItem[] }>(byName)).items;
        const found = nameItems.find((item) => item.id === searcher.id);
        expect(found).toBeTruthy();
        expect(found!.name).toBe(searcherName);
        expect(found!.avatar).toBeDefined();
        expect(found!.email).toBeUndefined();
        expect(found!.admin).toBeUndefined();
        expect(found!.verified).toBeUndefined();

        const byEmail = await sharing(`/users?q=${encodeURIComponent(searcher.email)}`, {
            token: owner.token,
        });
        await expectStatus(byEmail, 200, "email search");
        const emailItems = (await readJson<{ items: DirectoryItem[] }>(byEmail)).items;
        expect(emailItems).toHaveLength(1);
        expect(emailItems[0]!.id).toBe(searcher.id);
        expect(emailItems[0]!.email).toBe(searcher.email);
        expect(emailItems[0]!.admin).toBeUndefined();
        expect(emailItems[0]!.verified).toBeUndefined();

        const fuzzyEmail = await sharing(`/users?q=${encodeURIComponent(`no-such-${uniqueSuffix()}@test.local`)}`, {
            token: owner.token,
        });
        await expectStatus(fuzzyEmail, 200, "unknown email search");
        expect((await readJson<{ items: DirectoryItem[] }>(fuzzyEmail)).items).toHaveLength(0);
    });
});

describe("share management and permission matrix", () => {
    let owner: TestUser;
    let viewer: TestUser;
    let commenter: TestUser;
    let editor: TestUser;
    let outsider: TestUser;

    let note: TestRecord;
    let board: TestRecord;
    let otherBoard: TestRecord;
    let task: TestRecord;
    let editorFolder: TestRecord;

    let documentViewShare: ShareRow;
    let boardViewShare: ShareRow;

    beforeAll(async () => {
        owner = await createUser("matrix-owner");
        viewer = await createUser("matrix-viewer");
        commenter = await createUser("matrix-commenter");
        editor = await createUser("matrix-editor");
        outsider = await createUser("matrix-outsider");

        note = await createNote(owner);
        board = await createBoard(owner);
        otherBoard = await createBoard(owner);
        task = await createTask(owner, board.id);
        editorFolder = await createFolder(editor);

        await createShare(owner.token, "document", note.id, commenter.id, "comment");
        await createShare(owner.token, "document", note.id, editor.id, "edit");
        documentViewShare = await createShare(owner.token, "document", note.id, viewer.id, "view");

        await createShare(owner.token, "board", board.id, commenter.id, "comment");
        await createShare(owner.token, "board", board.id, editor.id, "edit");
        boardViewShare = await createShare(owner.token, "board", board.id, viewer.id, "view");
        await createShare(owner.token, "board", otherBoard.id, editor.id, "edit");
    });

    test("only the owner can list, create, or remove shares", async () => {
        const ownerList = await sharing(`/links?targetType=document&targetId=${note.id}`, {
            token: owner.token,
        });
        await expectStatus(ownerList, 200, "owner lists shares");
        const items = (await readJson<{ items: ShareRow[] }>(ownerList)).items;
        expect(items.some((item) => item.id === documentViewShare.id)).toBe(true);
        expect(items[0]!.user.email).toBeUndefined();
        expect(items[0]!.user.admin).toBeUndefined();
        expect(items[0]!.user.verified).toBeUndefined();

        const foreignList = await sharing(`/links?targetType=document&targetId=${note.id}`, {
            token: outsider.token,
        });
        await expectStatus(foreignList, 403, "non-owner lists shares");

        const foreignCreate = await sharing("/links", {
            token: outsider.token,
            body: {
                targetType: "document",
                targetId: note.id,
                userId: viewer.id,
                permission: "view",
            },
        });
        await expectStatus(foreignCreate, 403, "non-owner creates share");

        const foreignDelete = await sharing(`/links/${boardViewShare.id}`, {
            method: "DELETE",
            token: outsider.token,
        });
        await expectStatus(foreignDelete, 403, "non-owner deletes share");
    });

    test("a view grantee can read but never write, publish, move, archive, or delete a task", async () => {
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(true);
        expect(await recordExists(viewer.token, "boards", board.id)).toBe(true);
        expect(await recordExists(viewer.token, "tasks", task.id)).toBe(true);

        await expectStatus(await patch(viewer.token, "documents", note.id, { title: "Hijacked" }), [403, 404]);
        await expectStatus(
            await patch(viewer.token, "documents", note.id, {
                is_public: true,
                public_share_token: `public-${uniqueSuffix()}`,
            }),
            [403, 404],
            "view cannot publish",
        );
        await expectStatus(
            await patch(viewer.token, "documents", note.id, { folder: editorFolder.id }),
            [403, 404],
            "view cannot move a note",
        );
        await expectStatus(await patch(viewer.token, "boards", board.id, { archived: true }), [403, 404]);
        await expectStatus(await patch(viewer.token, "boards", board.id, { name: "Hijacked board" }), [403, 404]);
        await expectStatus(await remove(viewer.token, "tasks", task.id), [403, 404]);
        await expectStatus(
            await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: authHeaders(viewer.token, true),
                body: JSON.stringify({ title: "Viewer task", status: "backlog", board: board.id }),
            }),
            [400, 403],
            "view cannot create a task",
        );
    });

    test("a comment grantee cannot edit the target or write tasks", async () => {
        await expectStatus(await patch(commenter.token, "documents", note.id, { content: "Hijacked" }), [403, 404]);
        await expectStatus(await remove(commenter.token, "tasks", task.id), [403, 404]);
        await expectStatus(
            await patch(commenter.token, "tasks", task.id, { title: "Hijacked task" }),
            [403, 404],
            "comment cannot update a task",
        );
        await expectStatus(
            await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: authHeaders(commenter.token, true),
                body: JSON.stringify({ title: "Commenter task", status: "backlog", board: board.id }),
            }),
            [400, 403],
            "comment cannot create a task",
        );
    });

    test("an edit grantee can update note content and tasks but not owner-only fields", async () => {
        const updatedNote = await patch(editor.token, "documents", note.id, {
            title: `Edited by grantee ${uniqueSuffix()}`,
            content: "Grantee body",
            tags: ["shared"],
        });
        await expectStatus(updatedNote, 200, "edit grantee updates note");
        const noteBody = await readJson<{ title: string; content: string; tags: string[] }>(updatedNote);
        expect(noteBody.content).toBe("Grantee body");
        expect(noteBody.tags).toContain("shared");

        await expectStatus(await patch(editor.token, "documents", note.id, { is_private: true }), 403);
        await expectStatus(
            await patch(editor.token, "documents", note.id, {
                is_public: true,
                public_share_token: `public-${uniqueSuffix()}`,
            }),
            403,
            "edit cannot publish",
        );
        await expectStatus(
            await patch(editor.token, "documents", note.id, { folder: editorFolder.id }),
            403,
            "edit cannot move a note",
        );
        await expectStatus(await patch(editor.token, "boards", board.id, { name: "Hijacked" }), [403, 404]);
        await expectStatus(await patch(editor.token, "boards", board.id, { archived: true }), [403, 404]);

        const created = await pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: authHeaders(editor.token, true),
            body: JSON.stringify({
                title: `Grantee task ${uniqueSuffix()}`,
                status: "backlog",
                board: board.id,
            }),
        });
        await expectStatus(created, 200, "edit grantee creates task");
        const createdTask = await readJson<TestRecord>(created, "edit grantee creates task");

        const updatedTask = await patch(editor.token, "tasks", createdTask.id, {
            title: "Grantee updated task",
            status: "progress",
            priority: "high",
        });
        await expectStatus(updatedTask, 200, "edit grantee updates task");

        await expectStatus(
            await patch(editor.token, "tasks", createdTask.id, { board: otherBoard.id }),
            [400, 403],
            "task cannot move between boards",
        );
        await expectStatus(
            await patch(editor.token, "tasks", createdTask.id, { task_number: 9999 }),
            [400, 403],
            "grantee cannot set a task number",
        );
        await expectStatus(
            await pbRequest("/collections/tasks/records", {
                method: "POST",
                headers: authHeaders(editor.token, true),
                body: JSON.stringify({
                    title: "Numbered task",
                    status: "backlog",
                    board: board.id,
                    task_number: 9999,
                }),
            }),
            400,
            "create cannot set a task number",
        );

        await expectStatus(await remove(editor.token, "tasks", createdTask.id), 204);
    });
});

describe("folder inheritance and grant lifecycle", () => {
    let owner: TestUser;
    let viewer: TestUser;

    let sharedFolder: TestRecord;
    let childFolder: TestRecord;
    let note: TestRecord;
    let board: TestRecord;
    let task: TestRecord;
    let folderShare: ShareRow;

    beforeAll(async () => {
        owner = await createUser("inherit-owner");
        viewer = await createUser("inherit-viewer");

        sharedFolder = await createFolder(owner, { name: `Shared ${uniqueSuffix()}` });
        childFolder = await createFolder(owner, { name: `Child ${uniqueSuffix()}`, parent: sharedFolder.id });
        note = await createNote(owner, { folder: childFolder.id });
        board = await createBoard(owner, { folder: childFolder.id });
        task = await createTask(owner, board.id);

        folderShare = await createShare(owner.token, "folder", sharedFolder.id, viewer.id, "view");
    });

    test("inherits folder access to descendant folders, notes, boards, and tasks", async () => {
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(true);
        expect(await recordExists(viewer.token, "folders", childFolder.id)).toBe(true);
        expect(await recordExists(viewer.token, "boards", board.id)).toBe(true);
        expect(await recordExists(viewer.token, "tasks", task.id)).toBe(true);

        const shared = await sharedWithMe(viewer.token);
        const folderItem = shared.items.find((item) => item.type === "folder" && item.id === folderShare.id);
        expect(folderItem).toBeTruthy();
        expect(folderItem!.permission).toBe("view");
        expect(folderItem!.sharedBy?.id).toBe(owner.id);
        expect(folderItem!.target.id).toBe(sharedFolder.id);
        expect(folderItem!.sharedBy?.email).toBeUndefined();

        const noteItem = shared.items.find((item) => item.type === "document" && item.target.id === note.id);
        expect(noteItem).toBeTruthy();
        expect(noteItem!.inherited).toBe(true);
        expect(noteItem!.permission).toBe("view");
        expect(noteItem!.sharedBy?.id).toBe(owner.id);

        const boardItem = shared.items.find((item) => item.type === "board" && item.target.id === board.id);
        expect(boardItem).toBeTruthy();
        expect(boardItem!.inherited).toBe(true);

        // A nested folder is represented by its inherited root, not repeated.
        expect(shared.items.some((item) => item.type === "folder" && item.target.id === childFolder.id)).toBe(false);
    });

    test("new records in a shared folder inherit access", async () => {
        const fresh = await createNote(owner, { folder: childFolder.id });
        expect(await recordExists(viewer.token, "documents", fresh.id)).toBe(true);
    });

    test("moving a record out of a shared folder removes inherited access", async () => {
        await expectStatus(await patch(owner.token, "documents", note.id, { folder: "" }), 200);
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(false);

        await expectStatus(await patch(owner.token, "documents", note.id, { folder: childFolder.id }), 200);
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(true);
    });

    test("moving a folder subtree into a shared folder grants access and moving it out revokes it", async () => {
        const loose = await createFolder(owner, { name: `Loose ${uniqueSuffix()}` });
        const looseNote = await createNote(owner, { folder: loose.id });

        expect(await recordExists(viewer.token, "documents", looseNote.id)).toBe(false);

        await expectStatus(await patch(owner.token, "folders", loose.id, { parent: sharedFolder.id }), 200);
        expect(await recordExists(viewer.token, "documents", looseNote.id)).toBe(true);

        await expectStatus(await patch(owner.token, "folders", loose.id, { parent: "" }), 200);
        expect(await recordExists(viewer.token, "documents", looseNote.id)).toBe(false);
    });

    test("a privacy flip stops inheritance and removes direct shares in the subtree", async () => {
        await expectStatus(await patch(owner.token, "folders", sharedFolder.id, { is_private: true }), 200);

        expect(await recordExists(viewer.token, "documents", note.id)).toBe(false);
        expect(await recordExists(viewer.token, "boards", board.id)).toBe(false);
        expect(await recordExists(viewer.token, "tasks", task.id)).toBe(false);

        const shared = await sharedWithMe(viewer.token);
        expect(shared.items.some((item) => item.target.id === note.id || item.target.id === board.id)).toBe(false);

        const superuserToken = await getSuperuserToken();
        const folderShares = await pbList(superuserToken, "shares", {
            filter: `folder = "${sharedFolder.id}"`,
        });
        expect(folderShares.items).toHaveLength(0);

        // The owner still sees the private folder and its descendants.
        expect(await recordExists(owner.token, "documents", note.id)).toBe(true);
    });

    test("a direct share on a private record never grants access", async () => {
        const privateNote = await createNote(owner, { is_private: true });
        const superuserToken = await getSuperuserToken();

        await pbCreate(superuserToken, "shares", {
            document: privateNote.id,
            user: viewer.id,
            shared_by: owner.id,
            permission: "view",
            level: 1,
        });

        expect(await recordExists(viewer.token, "documents", privateNote.id)).toBe(false);
        const shared = await sharedWithMe(viewer.token);
        expect(shared.items.some((item) => item.target.id === privateNote.id)).toBe(false);
    });

    test("a stale share on a descendant of a private folder never grants access", async () => {
        const privateFolder = await createFolder(owner, {
            name: `Private ${uniqueSuffix()}`,
            is_private: true,
        });
        const hiddenNote = await createNote(owner, { folder: privateFolder.id });
        const superuserToken = await getSuperuserToken();

        await pbCreate(superuserToken, "shares", {
            document: hiddenNote.id,
            user: viewer.id,
            shared_by: owner.id,
            permission: "view",
            level: 1,
        });

        expect(await recordExists(viewer.token, "documents", hiddenNote.id)).toBe(false);
    });
});

describe("private, archived, and invalid share targets", () => {
    let owner: TestUser;
    let other: TestUser;
    let privateFolder: TestRecord;
    let privateNote: TestRecord;
    let privateBoard: TestRecord;
    let archivedBoard: TestRecord;
    let folderNote: TestRecord;
    let folderBoard: TestRecord;
    let trashedNote: TestRecord;
    let trashedFolder: TestRecord;

    beforeAll(async () => {
        owner = await createUser("target-owner");
        other = await createUser("target-other");

        privateFolder = await createFolder(owner, { name: `Private ${uniqueSuffix()}`, is_private: true });
        privateNote = await createNote(owner, { is_private: true });
        privateBoard = await createBoard(owner, { is_private: true });
        archivedBoard = await createBoard(owner, { archived: true });
        folderNote = await createNote(owner, { folder: privateFolder.id });
        folderBoard = await createBoard(owner, { folder: privateFolder.id });
        trashedNote = await createNote(owner);
        trashedFolder = await createFolder(owner, { name: `Trashed ${uniqueSuffix()}` });

        await expectStatus(
            await pbRequest("/trash/move-document", {
                method: "POST",
                headers: authHeaders(owner.token, true),
                body: JSON.stringify({ documentId: trashedNote.id }),
            }),
            200,
            "trash note fixture",
        );
        await expectStatus(
            await pbRequest("/trash/move-folder", {
                method: "POST",
                headers: authHeaders(owner.token, true),
                body: JSON.stringify({ folderId: trashedFolder.id }),
            }),
            200,
            "trash folder fixture",
        );
    });

    async function expectRejected(
        targetType: string,
        targetId: string,
        userId: string,
        permission = "view",
    ) {
        const res = await sharing("/links", {
            token: owner.token,
            body: { targetType, targetId, userId, permission },
        });
        await expectStatus(res, 400, `reject ${targetType} ${targetId}`);
    }

    test("rejects private records and descendants of private folders", async () => {
        await expectRejected("document", privateNote.id, other.id);
        await expectRejected("folder", privateFolder.id, other.id);
        await expectRejected("board", privateBoard.id, other.id);
        await expectRejected("document", folderNote.id, other.id);
        await expectRejected("board", folderBoard.id, other.id);
    });

    test("rejects archived and trashed targets", async () => {
        await expectRejected("board", archivedBoard.id, other.id);
        await expectRejected("document", trashedNote.id, other.id);
        await expectRejected("folder", trashedFolder.id, other.id);
    });

    test("rejects self, missing users, and invalid permissions", async () => {
        const note = await createNote(owner);
        await expectRejected("document", note.id, owner.id);
        await expectRejected("document", note.id, "missinguser123");

        const invalid = await sharing("/links", {
            token: owner.token,
            body: { targetType: "document", targetId: note.id, userId: other.id, permission: "owner" },
        });
        await expectStatus(invalid, 400, "invalid permission");

        const invalidTarget = await sharing("/links", {
            token: owner.token,
            body: { targetType: "task", targetId: note.id, userId: other.id, permission: "view" },
        });
        await expectStatus(invalidTarget, 400, "invalid target type");
    });
});

describe("comments", () => {
    let owner: TestUser;
    let viewer: TestUser;
    let commenter: TestUser;
    let note: TestRecord;
    let board: TestRecord;
    let task: TestRecord;

    beforeAll(async () => {
        owner = await createUser("comments-owner");
        viewer = await createUser("comments-viewer");
        commenter = await createUser("comments-commenter");

        note = await createNote(owner);
        board = await createBoard(owner);
        task = await createTask(owner, board.id);

        await createShare(owner.token, "document", note.id, viewer.id, "view");
        await createShare(owner.token, "document", note.id, commenter.id, "comment");
        await createShare(owner.token, "board", board.id, viewer.id, "view");
        await createShare(owner.token, "board", board.id, commenter.id, "comment");
    });

    async function postComment(token: string, targetType: string, targetId: string, body: string) {
        return sharing("/comments", {
            token,
            body: { targetType, targetId, body },
        });
    }

    test("a comment grantee posts normalized plain text and edits/deletes their own comment", async () => {
        const created = await postComment(commenter.token, "document", note.id, "  <b>Hello</b>\n\n  ");
        await expectStatus(created, 200, "post comment");
        const comment = await readJson<CommentRow>(created, "post comment");
        expect(comment.body).toBe("<b>Hello</b>");
        expect(comment.targetType).toBe("document");
        expect(comment.targetId).toBe(note.id);
        expect(comment.author.id).toBe(commenter.id);
        expect(comment.canEdit).toBe(true);
        expect(comment.canDelete).toBe(true);

        const list = await sharing(`/comments?targetType=document&targetId=${note.id}`, {
            token: commenter.token,
        });
        await expectStatus(list, 200, "list comments");
        const listed = await readJson<CommentList>(list, "list comments");
        expect(listed.permission).toBe("comment");
        expect(listed.canComment).toBe(true);
        expect(listed.items).toHaveLength(1);
        expect(listed.items[0]!.body).toBe("<b>Hello</b>");

        const edited = await sharing(`/comments/${comment.id}`, {
            method: "PATCH",
            token: commenter.token,
            body: { body: "  Edited comment  " },
        });
        await expectStatus(edited, 200, "edit comment");
        expect((await readJson<CommentRow>(edited)).body).toBe("Edited comment");

        await expectStatus(
            await postComment(commenter.token, "document", note.id, "   "),
            400,
            "empty comment",
        );
        await expectStatus(
            await postComment(commenter.token, "document", note.id, "x".repeat(10001)),
            400,
            "too-long comment",
        );

        const deleted = await sharing(`/comments/${comment.id}`, {
            method: "DELETE",
            token: commenter.token,
        });
        await expectStatus(deleted, 200, "delete comment");
    });

    test("a view grantee can read comments but cannot post one", async () => {
        const list = await sharing(`/comments?targetType=document&targetId=${note.id}`, {
            token: viewer.token,
        });
        await expectStatus(list, 200, "view grantee lists comments");
        const listed = await readJson<CommentList>(list);
        expect(listed.permission).toBe("view");
        expect(listed.canComment).toBe(false);

        await expectStatus(
            await postComment(viewer.token, "document", note.id, "Viewer comment"),
            403,
        );
    });

    test("task comments resolve access through the board", async () => {
        const created = await postComment(commenter.token, "task", task.id, "Task comment");
        await expectStatus(created, 200, "post task comment");
        const comment = await readJson<CommentRow>(created);
        expect(comment.targetType).toBe("task");
        expect(comment.targetId).toBe(task.id);

        const list = await sharing(`/comments?targetType=task&targetId=${task.id}`, {
            token: viewer.token,
        });
        await expectStatus(list, 200, "list task comments");
        const listed = await readJson<CommentList>(list);
        expect(listed.permission).toBe("view");
        expect(listed.items).toHaveLength(1);
        expect(listed.items[0]!.body).toBe("Task comment");

        await expectStatus(
            await postComment(viewer.token, "task", task.id, "Viewer task comment"),
            403,
        );
    });

    test("an edit grantee can delete another user's comment; a commenter cannot", async () => {
        const ownerComment = await postComment(owner.token, "document", note.id, "Owner comment");
        await expectStatus(ownerComment, 200, "owner comment");
        const comment = await readJson<CommentRow>(ownerComment);

        const forbidden = await sharing(`/comments/${comment.id}`, {
            method: "DELETE",
            token: commenter.token,
        });
        await expectStatus(forbidden, 403, "commenter cannot delete owner comment");

        const editor = await createUser("comments-editor");
        await createShare(owner.token, "document", note.id, editor.id, "edit");
        const allowed = await sharing(`/comments/${comment.id}`, {
            method: "DELETE",
            token: editor.token,
        });
        await expectStatus(allowed, 200, "edit grantee deletes comment");
    });
});

describe("kanban collection privacy and relation access", () => {
    let owner: TestUser;
    let viewer: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        owner = await createUser("kanban-privacy-owner");
        viewer = await createUser("kanban-privacy-viewer");
        superuserToken = await getSuperuserToken();
    });

    test("a stale direct share and stale grant on a private board expose no columns, activity, or relations", async () => {
        const board = await createBoard(owner);
        const otherTask = await createTask(owner, board.id, { status: "next" });
        const task = await createTask(owner, board.id, { status: "backlog" });
        const columns = await pbList<TestRecord>(owner.token, "board_columns", {
            filter: `board = "${board.id}"`,
        });
        const column = columns.items[0]!;
        const activity = await pbList<TestRecord>(owner.token, "task_activity", {
            filter: `task = "${task.id}"`,
        });
        const activityRow = activity.items[0]!;
        const relation = await pbCreate<TestRecord>(owner.token, "task_relations", {
            source: task.id,
            target: otherTask.id,
            type: "related",
        });

        await superuserUpdate("boards", board.id, { is_private: true });

        await pbCreate(superuserToken, "shares", {
            board: board.id,
            user: viewer.id,
            shared_by: owner.id,
            permission: "view",
            level: 1,
        });
        await pbCreate(superuserToken, "access_grants", {
            board: board.id,
            user: viewer.id,
            permission: "view",
            level: 1,
        });

        for (const [collection, id] of [
            ["boards", board.id],
            ["tasks", task.id],
            ["board_columns", column.id],
            ["task_activity", activityRow.id],
            ["task_relations", relation.id],
        ] as const) {
            const res = await pbRequest(`/collections/${collection}/records/${id}`, {
                headers: authHeaders(viewer.token),
            });
            await expectStatus(res, 404, `private board ${collection}`);
        }

        // The owner is unaffected by the stale grant.
        const ownerColumn = await pbRequest(`/collections/board_columns/records/${column.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(ownerColumn, 200, "owner column");
    });

    test("a direct share without a materialized grant grants nothing by rule", async () => {
        const board = await createBoard(owner);
        const task = await createTask(owner, board.id);
        const columns = await pbList<TestRecord>(owner.token, "board_columns", {
            filter: `board = "${board.id}"`,
        });
        const column = columns.items[0]!;
        const activity = await pbList<TestRecord>(owner.token, "task_activity", {
            filter: `task = "${task.id}"`,
        });
        const activityRow = activity.items[0]!;

        await pbCreate(superuserToken, "shares", {
            board: board.id,
            user: viewer.id,
            shared_by: owner.id,
            permission: "view",
            level: 1,
        });

        for (const [collection, id] of [
            ["boards", board.id],
            ["tasks", task.id],
            ["board_columns", column.id],
            ["task_activity", activityRow.id],
        ] as const) {
            const res = await pbRequest(`/collections/${collection}/records/${id}`, {
                headers: authHeaders(viewer.token),
            });
            await expectStatus(res, 404, `direct share only ${collection}`);
        }

        const createTaskAttempt = await pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: authHeaders(viewer.token, true),
            body: JSON.stringify({ title: "Direct share task", status: "backlog", board: board.id }),
        });
        await expectStatus(createTaskAttempt, 400, "direct share cannot write");

        // Materializing the same user into access_grants is what the rules read.
        await pbCreate(superuserToken, "access_grants", {
            board: board.id,
            user: viewer.id,
            permission: "view",
            level: 1,
        });
        const readable = await pbRequest(`/collections/tasks/records/${task.id}`, {
            headers: authHeaders(viewer.token),
        });
        await expectStatus(readable, 200, "grant-backed read");
    });

    test("a stale grant on a private board cannot be used as an assignee", async () => {
        const board = await createBoard(owner, { is_private: true });
        await pbCreate(superuserToken, "access_grants", {
            board: board.id,
            user: viewer.id,
            permission: "edit",
            level: 3,
        });

        const created = await pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({
                title: "Private assignee",
                status: "backlog",
                board: board.id,
                assignee: viewer.id,
            }),
        });
        await expectStatus(created, 400, "private board stale assignee");

        const task = await createTask(owner, board.id);
        const updated = await patch(owner.token, "tasks", task.id, {
            assignee: viewer.id,
        });
        await expectStatus(updated, 400, "private board stale reassignment");
    });

    test("relation reads are symmetric for the target board owner", async () => {
        const ownerBoard = await createBoard(owner);
        const ownerTask = await createTask(owner, ownerBoard.id);
        await createShare(owner.token, "board", ownerBoard.id, viewer.id, "view");

        const viewerBoard = await createBoard(viewer);
        const viewerTask = await createTask(viewer, viewerBoard.id);
        const relation = await pbCreate<TestRecord>(viewer.token, "task_relations", {
            source: viewerTask.id,
            target: ownerTask.id,
            type: "blocks",
        });

        const asTargetOwner = await pbRequest(
            `/collections/task_relations/records/${relation.id}`,
            { headers: authHeaders(owner.token) },
        );
        await expectStatus(asTargetOwner, 200, "target owner relation read");

        const asSourceOwner = await pbRequest(
            `/collections/task_relations/records/${relation.id}`,
            { headers: authHeaders(viewer.token) },
        );
        await expectStatus(asSourceOwner, 200, "source owner relation read");

        // The target owner has edit access, so they may remove an inbound edge.
        const removed = await pbRequest(`/collections/task_relations/records/${relation.id}`, {
            method: "DELETE",
            headers: authHeaders(owner.token),
        });
        await expectStatus(removed, 204, "target owner removes relation");
    });

    test("new-collection rules are grant-based and source direct shares are gone", async () => {
        const res = await pbRequest("/collections", {
            headers: authHeaders(superuserToken),
        });
        await expectStatus(res, 200, "collections metadata");
        const data = await readJson<{ items: Array<{ name: string; listRule: string; updateRule: string; createRule: string }> }>(res);
        const byName = new Map(data.items.map((item) => [item.name, item]));

        for (const name of ["board_columns", "task_activity", "task_relations"]) {
            const collection = byName.get(name)!;
            expect(collection).toBeTruthy();
            const rules = [collection.listRule, collection.updateRule, collection.createRule]
                .filter(Boolean)
                .join(" ");
            expect(rules).not.toContain("shares_via");
        }

        expect(byName.get("board_columns")!.listRule).toContain("access_grants_via_board");
        expect(byName.get("task_activity")!.listRule).toContain("access_grants_via_board");
        expect(byName.get("task_relations")!.listRule).toContain("target.board");
        expect(byName.get("tasks")!.createRule).toContain("permission ?= 'edit'");
        expect(byName.get("boards")!.updateRule).toContain("author = @request.auth.id");
        expect(byName.get("boards")!.updateRule).not.toContain("access_grants_via_board");
    });
});

describe("revocation and trash transitions", () => {
    let owner: TestUser;
    let viewer: TestUser;

    beforeAll(async () => {
        owner = await createUser("lifecycle-owner");
        viewer = await createUser("lifecycle-viewer");
    });

    test("revoking a direct share removes access immediately", async () => {
        const note = await createNote(owner);
        const share = await createShare(owner.token, "document", note.id, viewer.id, "view");
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(true);

        await deleteShare(owner.token, share.id);
        expect(await recordExists(viewer.token, "documents", note.id)).toBe(false);

        const list = await sharedWithMe(viewer.token);
        expect(list.items.some((item) => item.target.id === note.id)).toBe(false);
    });

    test("trashing a shared folder removes inherited access and rehomed board access", async () => {
        const folder = await createFolder(owner, { name: `Trash ${uniqueSuffix()}` });
        const note = await createNote(owner, { folder: folder.id });
        const board = await createBoard(owner, { folder: folder.id });
        const task = await createTask(owner, board.id);
        await createShare(owner.token, "folder", folder.id, viewer.id, "view");

        expect(await recordExists(viewer.token, "documents", note.id)).toBe(true);
        expect(await recordExists(viewer.token, "boards", board.id)).toBe(true);
        expect(await recordExists(viewer.token, "tasks", task.id)).toBe(true);

        const moved = await pbRequest("/trash/move-folder", {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({ folderId: folder.id }),
        });
        await expectStatus(moved, 200, "trash shared folder");

        expect(await recordExists(viewer.token, "documents", note.id)).toBe(false);
        expect(await recordExists(viewer.token, "boards", board.id)).toBe(false);
        expect(await recordExists(viewer.token, "tasks", task.id)).toBe(false);

        const list = await sharedWithMe(viewer.token);
        expect(list.items.some((item) => item.target.id === note.id || item.target.id === board.id)).toBe(false);
    });
});
