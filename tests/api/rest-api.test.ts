import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    patchJson,
    pbGetRecord,
    pbRecordExists,
    postJson,
    readJson,
} from "../helpers/client";
import { createFolder, createUser, type TestUser } from "../helpers/factories";
import { authHeaders, uniqueSuffix } from "../helpers/setup";

/**
 * REST/OpenAPI surface: /api/v1, /docs, and /docs/json.
 *
 * This surface is the owning user's surface, so private notes and boards are
 * visible to their owner. The matching AI-surface lock lives in mcp.test.ts.
 */

const API = "/api/v1";
const suffix = uniqueSuffix();
const folderName = `REST Folder ${suffix}`;
const alphaTitle = `Alpha Note ${suffix}`;
const zetaTitle = `Zeta Note ${suffix}`;
const updatedAlphaTitle = `Updated Alpha ${suffix}`;

interface FolderDto {
    id: string;
    name: string;
    parentId: string | null;
    isPrivate: boolean;
    isPublic: boolean;
    created: string;
    updated: string;
}

interface NoteSummaryDto {
    id: string;
    title: string;
    tags: string[];
    folderId: string | null;
    isPrivate: boolean;
    isPublic: boolean;
    published: boolean;
    wordCount: number;
    readingTime: number;
    created: string;
    updated: string;
}

interface NoteDto extends NoteSummaryDto {
    slug: string;
    content: string;
}

interface BoardDto {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    folderId: string | null;
    isPrivate: boolean;
    created: string;
    updated: string;
}

interface TaskDto {
    id: string;
    title: string;
    description: string;
    status: "backlog" | "next" | "progress" | "done";
    priority: "" | "low" | "medium" | "high" | "urgent";
    dueDate: string | null;
    boardOrder: number;
    labels: string[];
    noteId: string | null;
    boardId: string;
    created: string;
    updated: string;
}

interface ListResult<T> {
    items: T[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
}

let owner: TestUser;
let other: TestUser;
let folder: FolderDto;
let otherFolder: { id: string };
let alpha: NoteDto;
let zeta: NoteDto;

function restGet(path: string, token: string): Promise<Response> {
    return bunRequest(`${API}${path}`, { headers: authHeaders(token) });
}

function restPost(path: string, body: unknown, token: string): Promise<Response> {
    return postJson(`${API}${path}`, body, authHeaders(token, true));
}

function restPatch(path: string, body: unknown, token: string): Promise<Response> {
    return patchJson(`${API}${path}`, body, authHeaders(token, true));
}

function restDelete(path: string, token: string): Promise<Response> {
    return bunRequest(`${API}${path}`, { method: "DELETE", headers: authHeaders(token) });
}

beforeAll(async () => {
    owner = await createUser("rest-owner");
    other = await createUser("rest-other");
    otherFolder = await createFolder(other, { name: `REST Other Folder ${suffix}` });

    const folderRes = await restPost("/folders", { name: folderName }, owner.token);
    await expectStatus(folderRes, 201, "create folder");
    folder = await readJson<FolderDto>(folderRes, "create folder");

    const alphaRes = await restPost("/notes", {
        title: alphaTitle,
        content: "# Alpha\n\nOriginal body",
        tags: ["rest", "alpha"],
        folderId: folder.id,
    }, owner.token);
    await expectStatus(alphaRes, 201, "create alpha note");
    alpha = await readJson<NoteDto>(alphaRes, "create alpha note");

    const zetaRes = await restPost("/notes", {
        title: zetaTitle,
        content: "# Zeta\n\nSecond body",
        tags: ["rest"],
        folderId: folder.id,
    }, owner.token);
    await expectStatus(zetaRes, 201, "create zeta note");
    zeta = await readJson<NoteDto>(zetaRes, "create zeta note");
});

describe("public OpenAPI docs", () => {
    test("GET /docs serves the Swagger UI page", async () => {
        const res = await bunRequest("/docs");
        await expectStatus(res, 200, "docs page");
        expect(res.headers.get("Content-Type")).toContain("text/html");

        const html = await res.text();
        expect(html).toContain("swagger-ui");
        expect(html).toContain("docs/json");
        expect(html).toContain("/docs/swagger-ui-bundle.js");
    });

    test("GET /docs/json publishes the REST paths", async () => {
        const res = await bunRequest("/docs/json");
        await expectStatus(res, 200, "openapi spec");
        expect(res.headers.get("Content-Type")).toContain("application/json");

        const spec = await readJson<{
            openapi: string;
            info: { title: string; version: string };
            paths: Record<string, unknown>;
        }>(res, "openapi spec");

        expect(spec.openapi).toMatch(/^3\./);
        expect(spec.info.title).toBe("Nana API");
        expect(Object.keys(spec.paths)).toEqual(
            expect.arrayContaining(["/api/v1/notes", "/api/v1/boards", "/api/v1/folders"]),
        );
    });

    test("GET /docs serves the self-hosted Swagger assets", async () => {
        const bundle = await bunRequest("/docs/swagger-ui-bundle.js");
        await expectStatus(bundle, 200, "swagger bundle");
        expect(bundle.headers.get("Content-Type")).toContain("application/javascript");
        expect((await bundle.text()).length).toBeGreaterThan(1_000);

        const css = await bunRequest("/docs/swagger-ui.css");
        await expectStatus(css, 200, "swagger styles");
        expect(css.headers.get("Content-Type")).toContain("text/css");
        expect(await css.text()).toContain("swagger-ui");
    });
});

describe("authentication", () => {
    test("rejects a missing token with the error envelope", async () => {
        const res = await bunRequest(`${API}/notes`);
        const body = await expectJsonError(res, 401, "Authorization");
        expect(typeof body.error).toBe("string");
    });

    test("accepts a raw PocketBase token and a Bearer token", async () => {
        const raw = await bunRequest(`${API}/notes`, {
            headers: { Authorization: owner.token },
        });
        await expectStatus(raw, 200, "raw token");
        expect(await readJson<ListResult<NoteSummaryDto>>(raw, "raw token")).toHaveProperty("items");

        const bearer = await bunRequest(`${API}/notes`, {
            headers: { Authorization: `Bearer ${owner.token}` },
        });
        await expectStatus(bearer, 200, "bearer token");
        expect(await readJson<ListResult<NoteSummaryDto>>(bearer, "bearer token")).toHaveProperty("items");
    });

    test("rejects an invalid token", async () => {
        const res = await bunRequest(`${API}/notes`, {
            headers: { Authorization: "definitely-not-a-pocketbase-token" },
        });
        await expectJsonError(res, 401, "token");
    });
});

describe("folders and notes", () => {
    test("lists the caller's folders", async () => {
        const res = await restGet("/folders", owner.token);
        await expectStatus(res, 200, "list folders");
        const folders = await readJson<FolderDto[]>(res, "list folders");
        expect(folders.map((item) => item.id)).toContain(folder.id);
    });

    test("creates a private folder but refuses another user's parent", async () => {
        const privateRes = await restPost("/folders", {
            name: `REST Private Folder ${suffix}`,
            isPrivate: true,
        }, owner.token);
        await expectStatus(privateRes, 201, "create private folder");
        const privateFolder = await readJson<FolderDto>(privateRes, "create private folder");
        expect(privateFolder.isPrivate).toBe(true);

        // The owner surface still lists the owner's private folder.
        const listRes = await restGet("/folders", owner.token);
        await expectStatus(listRes, 200, "list private folders");
        const folders = await readJson<FolderDto[]>(listRes, "list private folders");
        expect(folders.map((item) => item.id)).toContain(privateFolder.id);

        const foreignRes = await restPost("/folders", {
            name: `REST Foreign Child ${suffix}`,
            parentId: otherFolder.id,
        }, owner.token);
        await expectJsonError(foreignRes, 404, "not found");
    });

    test("lists notes by folder and title without leaking bodies", async () => {
        const res = await restGet(`/notes?folderId=${folder.id}&sort=title`, owner.token);
        await expectStatus(res, 200, "list notes");
        const page = await readJson<ListResult<NoteSummaryDto>>(res, "list notes");

        expect(page.items.map((note) => note.id)).toEqual([alpha.id, zeta.id]);
        expect(page.items.map((note) => note.title)).toEqual([alphaTitle, zetaTitle]);
        for (const note of page.items) {
            expect(note).not.toHaveProperty("content");
        }
    });

    test("reads a note with content", async () => {
        const res = await restGet(`/notes/${alpha.id}`, owner.token);
        await expectStatus(res, 200, "read note");
        const note = await readJson<NoteDto>(res, "read note");

        expect(note).toMatchObject({
            id: alpha.id,
            title: alphaTitle,
            folderId: folder.id,
            tags: ["rest", "alpha"],
            isPrivate: false,
        });
        expect(note.content).toContain("Original body");
    });

    test("updates title, content, and tags", async () => {
        const res = await restPatch(`/notes/${alpha.id}`, {
            title: updatedAlphaTitle,
            content: "# Updated\n\nNew body",
            tags: ["rest", "updated"],
        }, owner.token);
        await expectStatus(res, 200, "update note");
        const note = await readJson<NoteDto>(res, "update note");

        expect(note.title).toBe(updatedAlphaTitle);
        expect(note.slug).toBe(`updated-alpha-${suffix.toLowerCase()}`);
        expect(note.content).toContain("New body");
        expect(note.tags).toEqual(["rest", "updated"]);
    });

    test("moves a note to the root with an empty string or null", async () => {
        const emptyRes = await restPatch(`/notes/${alpha.id}`, { folderId: "" }, owner.token);
        await expectStatus(emptyRes, 200, "move note to root with empty string");
        expect((await readJson<NoteDto>(emptyRes, "move note")).folderId).toBeNull();

        const nullRes = await restPatch(`/notes/${alpha.id}`, { folderId: null }, owner.token);
        await expectStatus(nullRes, 200, "move note to root with null");
        expect((await readJson<NoteDto>(nullRes, "move note")).folderId).toBeNull();
    });

    test("keeps a private note visible to its owner", async () => {
        const patchRes = await restPatch(`/notes/${alpha.id}`, { isPrivate: true }, owner.token);
        await expectStatus(patchRes, 200, "make note private");
        expect((await readJson<NoteDto>(patchRes, "make note private")).isPrivate).toBe(true);

        const getRes = await restGet(`/notes/${alpha.id}`, owner.token);
        await expectStatus(getRes, 200, "owner reads private note");
        expect((await readJson<NoteDto>(getRes, "owner reads private note")).isPrivate).toBe(true);

        const listRes = await restGet(`/notes?query=${encodeURIComponent(updatedAlphaTitle)}`, owner.token);
        await expectStatus(listRes, 200, "owner lists private note");
        const page = await readJson<ListResult<NoteSummaryDto>>(listRes, "owner lists private note");
        expect(page.items.map((note) => note.id)).toContain(alpha.id);
    });

    test("does not leak another user's note by id or list", async () => {
        const getRes = await restGet(`/notes/${alpha.id}`, other.token);
        await expectJsonError(getRes, 404, "not found");

        const listRes = await restGet(
            `/notes?query=${encodeURIComponent(updatedAlphaTitle)}`,
            other.token,
        );
        await expectStatus(listRes, 200, "other lists notes");
        const page = await readJson<ListResult<NoteSummaryDto>>(listRes, "other lists notes");
        expect(page.items).toHaveLength(0);
    });

    test("sanitizes script payloads on create and update", async () => {
        const createRes = await restPost("/notes", {
            title: `XSS Note ${suffix}`,
            content: "<script>alert(1)</script><p>Safe body</p>",
            tags: ["security"],
        }, owner.token);
        await expectStatus(createRes, 201, "create xss note");
        const created = await readJson<NoteDto>(createRes, "create xss note");
        expect(created.content).not.toContain("<script");
        expect(created.content).toContain("Safe body");

        const storedCreate = await pbGetRecord<{ content: string }>(
            owner.token,
            "documents",
            created.id,
        );
        expect(storedCreate.content).not.toContain("<script");

        const updateRes = await restPatch(`/notes/${created.id}`, {
            content: "<script>alert(2)</script>\n\nSafe update",
        }, owner.token);
        await expectStatus(updateRes, 200, "update xss note");
        const updated = await readJson<NoteDto>(updateRes, "update xss note");
        expect(updated.content).not.toContain("<script");
        expect(updated.content).toContain("Safe update");

        const storedUpdate = await pbGetRecord<{ content: string }>(
            owner.token,
            "documents",
            created.id,
        );
        expect(storedUpdate.content).not.toContain("<script");
    });

    test("validates body types and record ids", async () => {
        const badBody = await restPost("/notes", { title: 42 }, owner.token);
        await expectJsonError(badBody, 422, "Invalid request");

        const malformedJson = await bunRequest(`${API}/notes`, {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: "{\"title\":",
        });
        await expectJsonError(malformedJson, 400, "Invalid request body");

        const malformedId = await restGet("/notes/not-a-valid-id", owner.token);
        await expectJsonError(malformedId, 422, "Invalid request");

        const missingId = await restGet("/notes/aaaaaaaaaaaaaaaa", owner.token);
        await expectJsonError(missingId, 404, "not found");
    });

    test("moves a deleted note to trash and reports the trash id", async () => {
        const createRes = await restPost("/notes", {
            title: `Trash Note ${suffix}`,
            content: "Delete me",
        }, owner.token);
        await expectStatus(createRes, 201, "create deletable note");
        const note = await readJson<NoteDto>(createRes, "create deletable note");

        const deleteRes = await restDelete(`/notes/${note.id}`, owner.token);
        await expectStatus(deleteRes, 200, "delete note");
        const result = await readJson<{ trashDocumentId: string }>(deleteRes, "delete note");
        expect(typeof result.trashDocumentId).toBe("string");
        expect(result.trashDocumentId.length).toBeGreaterThan(0);

        expect(await pbRecordExists(owner.token, "documents", note.id)).toBe(false);

        const trash = await pbGetRecord<{ original_document_id: string }>(
            owner.token,
            "trash_documents",
            result.trashDocumentId,
        );
        expect(trash.original_document_id).toBe(note.id);

        const getRes = await restGet(`/notes/${note.id}`, owner.token);
        await expectJsonError(getRes, 404, "not found");
    });
});

describe("boards and tasks", () => {
    test("runs the board and task lifecycle", async () => {
        const boardName = `REST Board ${suffix}`;
        const boardRes = await restPost("/boards", {
            name: boardName,
            description: "Initial description",
            folderId: folder.id,
            isPrivate: true,
        }, owner.token);
        await expectStatus(boardRes, 201, "create board");
        const board = await readJson<BoardDto>(boardRes, "create board");
        expect(board).toMatchObject({
            name: boardName,
            description: "Initial description",
            archived: false,
            folderId: folder.id,
            isPrivate: true,
        });

        const listRes = await restGet(
            `/boards?includeArchived=true&folderId=${folder.id}`,
            owner.token,
        );
        await expectStatus(listRes, 200, "list boards");
        const boardPage = await readJson<ListResult<BoardDto>>(listRes, "list boards");
        expect(boardPage.items.map((item) => item.id)).toContain(board.id);
        expect(boardPage.items.find((item) => item.id === board.id)?.isPrivate).toBe(true);

        const getRes = await restGet(`/boards/${board.id}`, owner.token);
        await expectStatus(getRes, 200, "read board");
        expect((await readJson<BoardDto>(getRes, "read board")).name).toBe(boardName);

        const patchBoardRes = await restPatch(`/boards/${board.id}`, {
            description: "Updated description",
            isPrivate: false,
        }, owner.token);
        await expectStatus(patchBoardRes, 200, "update board");
        const patchedBoard = await readJson<BoardDto>(patchBoardRes, "update board");
        expect(patchedBoard.description).toBe("Updated description");
        expect(patchedBoard.isPrivate).toBe(false);

        const taskTitle = `REST Task ${suffix}`;
        const taskRes = await restPost(`/boards/${board.id}/tasks`, {
            title: taskTitle,
            description: "Task body",
            status: "next",
            priority: "high",
            labels: ["rest", "task"],
            dueDate: "2026-12-01 12:00:00.000Z",
            boardOrder: 2,
        }, owner.token);
        await expectStatus(taskRes, 201, "create task");
        const task = await readJson<TaskDto>(taskRes, "create task");
        expect(task).toMatchObject({
            title: taskTitle,
            description: "Task body",
            status: "next",
            priority: "high",
            boardOrder: 2,
            labels: ["rest", "task"],
            boardId: board.id,
            noteId: null,
        });
        expect(task.dueDate).toContain("2026-12-01");

        const nextTasksRes = await restGet(`/boards/${board.id}/tasks?status=next`, owner.token);
        await expectStatus(nextTasksRes, 200, "list next tasks");
        const nextTasks = await readJson<ListResult<TaskDto>>(nextTasksRes, "list next tasks");
        expect(nextTasks.items.map((item) => item.id)).toContain(task.id);

        const doneTasksRes = await restGet(`/boards/${board.id}/tasks?status=done`, owner.token);
        await expectStatus(doneTasksRes, 200, "list done tasks");
        const doneTasks = await readJson<ListResult<TaskDto>>(doneTasksRes, "list done tasks");
        expect(doneTasks.items.map((item) => item.id)).not.toContain(task.id);

        const moveColumnRes = await restPatch(`/tasks/${task.id}`, {
            status: "progress",
            boardOrder: 5,
        }, owner.token);
        await expectStatus(moveColumnRes, 200, "move task column");
        const movedColumn = await readJson<TaskDto>(moveColumnRes, "move task column");
        expect(movedColumn.status).toBe("progress");
        expect(movedColumn.boardOrder).toBe(5);

        const secondBoardRes = await restPost("/boards", {
            name: `REST Board Two ${suffix}`,
        }, owner.token);
        await expectStatus(secondBoardRes, 201, "create second board");
        const secondBoard = await readJson<BoardDto>(secondBoardRes, "create second board");

        const moveBoardRes = await restPatch(`/tasks/${task.id}`, {
            boardId: secondBoard.id,
        }, owner.token);
        await expectStatus(moveBoardRes, 200, "move task to second board");
        const movedTask = await readJson<TaskDto>(moveBoardRes, "move task to second board");
        expect(movedTask.boardId).toBe(secondBoard.id);

        const linkedNoteRes = await restPost("/notes", {
            title: `Linked Note ${suffix}`,
            content: "# Linked\n\n**Plain** excerpt",
            tags: ["one", "two", "three", "four", "five", "six", "seven"],
        }, owner.token);
        await expectStatus(linkedNoteRes, 201, "create linked note");
        const linkedNote = await readJson<NoteDto>(linkedNoteRes, "create linked note");

        const addNoteRes = await restPost(`/boards/${secondBoard.id}/notes`, {
            noteId: linkedNote.id,
            status: "done",
        }, owner.token);
        await expectStatus(addNoteRes, 201, "add note to board");
        const linkedTask = await readJson<TaskDto>(addNoteRes, "add note to board");
        expect(linkedTask.noteId).toBe(linkedNote.id);
        expect(linkedTask.title).toBe(linkedNote.title);
        expect(linkedTask.status).toBe("done");
        expect(linkedTask.boardId).toBe(secondBoard.id);
        expect(linkedTask.description).toContain("Plain excerpt");
        expect(linkedTask.labels).toEqual(["one", "two", "three", "four", "five", "six"]);

        const deleteTaskRes = await restDelete(`/tasks/${linkedTask.id}`, owner.token);
        await expectStatus(deleteTaskRes, 204, "delete task");
        expect(await pbRecordExists(owner.token, "tasks", linkedTask.id)).toBe(false);

        const activeDeleteRes = await restDelete(`/boards/${board.id}`, owner.token);
        await expectJsonError(activeDeleteRes, 409, "Archive the board");

        const archiveRes = await restPatch(`/boards/${board.id}`, { archived: true }, owner.token);
        await expectStatus(archiveRes, 200, "archive board");
        expect((await readJson<BoardDto>(archiveRes, "archive board")).archived).toBe(true);

        const archivedTaskRes = await restPost(`/boards/${board.id}/tasks`, {
            title: `Archived Task ${suffix}`,
        }, owner.token);
        await expectJsonError(archivedTaskRes, 409, "archived");

        const archivedDeleteRes = await restDelete(`/boards/${board.id}`, owner.token);
        await expectStatus(archivedDeleteRes, 204, "delete archived board");
        expect(await pbRecordExists(owner.token, "boards", board.id)).toBe(false);

        const missingBoardRes = await restGet(`/boards/${board.id}`, owner.token);
        await expectJsonError(missingBoardRes, 404, "not found");

        // Deleting the second board cascades the task that was moved onto it.
        const archiveSecondRes = await restPatch(
            `/boards/${secondBoard.id}`,
            { archived: true },
            owner.token,
        );
        await expectStatus(archiveSecondRes, 200, "archive second board");

        const deleteSecondRes = await restDelete(`/boards/${secondBoard.id}`, owner.token);
        await expectStatus(deleteSecondRes, 204, "delete second board");
        expect(await pbRecordExists(owner.token, "tasks", task.id)).toBe(false);
    });
});

/**
 * Optional task fields are filters/partial-update inputs: omitting `status`
 * must list every column, and a PATCH must leave unspecified fields untouched.
 * Request-schema defaults must not leak into either path.
 */
describe("task filters and partial updates", () => {
    async function newBoard(name: string): Promise<BoardDto> {
        const res = await restPost("/boards", { name }, owner.token);
        await expectStatus(res, 201, `create ${name}`);
        return readJson<BoardDto>(res, `create ${name}`);
    }

    async function newTask(
        boardId: string,
        title: string,
        status: TaskDto["status"],
        priority: TaskDto["priority"],
    ): Promise<TaskDto> {
        const res = await restPost(`/boards/${boardId}/tasks`, {
            title,
            status,
            priority,
        }, owner.token);
        await expectStatus(res, 201, `create ${title}`);
        return readJson<TaskDto>(res, `create ${title}`);
    }

    test("lists every column when status is omitted", async () => {
        const board = await newBoard(`REST Filter Board ${suffix}`);
        const nextTask = await newTask(board.id, `Filter Next ${suffix}`, "next", "low");
        const doneTask = await newTask(board.id, `Filter Done ${suffix}`, "done", "medium");

        const res = await restGet(`/boards/${board.id}/tasks`, owner.token);
        await expectStatus(res, 200, "list all task columns");
        const page = await readJson<ListResult<TaskDto>>(res, "list all task columns");

        expect(page.items.map((item) => item.id)).toEqual(
            expect.arrayContaining([nextTask.id, doneTask.id]),
        );
    });

    test("preserves status and priority when only the title changes", async () => {
        const board = await newBoard(`REST Patch Board ${suffix}`);
        const task = await newTask(board.id, `Patch Task ${suffix}`, "next", "high");

        const res = await restPatch(`/tasks/${task.id}`, {
            title: `Patch Task Renamed ${suffix}`,
        }, owner.token);
        await expectStatus(res, 200, "patch task title");
        const patched = await readJson<TaskDto>(res, "patch task title");

        expect(patched.title).toBe(`Patch Task Renamed ${suffix}`);
        expect(patched.status).toBe("next");
        expect(patched.priority).toBe("high");
    });

    test("preserves status and priority when the task moves to another board", async () => {
        const source = await newBoard(`REST Source Board ${suffix}`);
        const target = await newBoard(`REST Target Board ${suffix}`);
        const task = await newTask(source.id, `Move Task ${suffix}`, "progress", "urgent");

        const res = await restPatch(`/tasks/${task.id}`, {
            boardId: target.id,
        }, owner.token);
        await expectStatus(res, 200, "move task between boards");
        const moved = await readJson<TaskDto>(res, "move task between boards");

        expect(moved.boardId).toBe(target.id);
        expect(moved.status).toBe("progress");
        expect(moved.priority).toBe("urgent");
    });
});
