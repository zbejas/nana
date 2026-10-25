import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    pbGetRecord,
    pbRecordExists,
    readJson,
} from "../helpers/client";
import {
    createBoard,
    createFolder,
    createNote,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, uniqueSuffix } from "../helpers/setup";

/**
 * MCP surface: POST /mcp (stateless Streamable HTTP, JSON responses).
 *
 * MCP is the AI surface: private notes, boards, folders, and private folder
 * subtrees are hidden. rest-api.test.ts proves the owner still sees the same
 * records through REST.
 */

const MCP_PATH = "/mcp";
const ACCEPT = "application/json, text/event-stream";

interface McpToolResult {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    [key: string]: unknown;
}

interface McpResponse {
    jsonrpc: string;
    id: number | null;
    result?: McpToolResult;
    error?: { code: number; message: string };
}

interface McpCall {
    payload: Record<string, unknown>;
    isError: boolean;
    response: McpResponse;
}

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
    published: boolean;
    [key: string]: unknown;
}

interface NoteDto extends NoteSummaryDto {
    content: string;
    slug: string;
}

interface BoardDto {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    folderId: string | null;
    isPrivate: boolean;
}

interface TaskDto {
    id: string;
    title: string;
    description: string;
    status: "backlog" | "next" | "progress" | "done";
    priority: string;
    dueDate: string | null;
    boardOrder: number;
    labels: string[];
    noteId: string | null;
    boardId: string;
    [key: string]: unknown;
}

let owner: TestUser;

const suffix = uniqueSuffix();
let privateFolder: TestRecord;
let privateChildFolder: TestRecord;
let visibleFolder: TestRecord;
let privateFolderNote: TestRecord;
let privateChildNote: TestRecord;
let privateNote: TestRecord;
let privateBoard: TestRecord;
let privateFolderBoard: TestRecord;
let visibleNote: TestRecord;
let visibleBoard: TestRecord;

let requestId = 0;

function nextId(): number {
    requestId += 1;
    return requestId;
}

function mcpRequest(token: string | null, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: ACCEPT,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return bunRequest(MCP_PATH, {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

async function mcpJson(token: string | null, body: unknown): Promise<McpResponse> {
    const res = await mcpRequest(token, body);
    await expectStatus(res, 200, "mcp request");
    expect(res.headers.get("Content-Type")).toContain("application/json");
    return readJson<McpResponse>(res, "mcp response");
}

async function mcpInitialize(token: string): Promise<McpResponse> {
    return mcpJson(token, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "initialize",
        params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "nana-integration-tests", version: "1.0.0" },
        },
    });
}

/** Call one tool and parse its JSON text content. */
async function mcpCall(
    token: string,
    name: string,
    args: Record<string, unknown> = {},
): Promise<McpCall> {
    const response = await mcpJson(token, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/call",
        params: { name, arguments: args },
    });

    if (response.error) {
        throw new Error(`tools/call ${name} returned JSON-RPC error ${response.error.code}: ${response.error.message}`);
    }
    const result = response.result;
    if (!result) throw new Error(`tools/call ${name} returned no result`);

    const text = result.content?.[0]?.text;
    if (typeof text !== "string") throw new Error(`tools/call ${name} returned no text content`);

    let payload: Record<string, unknown>;
    try {
        payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
        throw new Error(`tools/call ${name} returned non-JSON text: ${text.slice(0, 200)}`);
    }

    return { payload, isError: result.isError === true, response };
}

function expectNotFound(call: McpCall): void {
    expect(call.isError).toBe(true);
    expect(call.payload.error).toMatchObject({ code: "not_found" });
}

beforeAll(async () => {
    owner = await createUser("mcp-owner");

    // AI-hidden fixtures owned by the same user: a private folder with a child
    // folder, notes inside both, a private note, a private board, and a board
    // filed into the private folder.
    privateFolder = await createFolder(owner, {
        name: `MCP Private Folder ${suffix}`,
        is_private: true,
    });
    privateChildFolder = await createFolder(owner, {
        name: `MCP Private Child ${suffix}`,
        parent: privateFolder.id,
    });
    privateFolderNote = await createNote(owner, {
        title: `MCP Private Folder Note ${suffix}`,
        content: "Hidden with its private folder.",
        folder: privateFolder.id,
    });
    privateChildNote = await createNote(owner, {
        title: `MCP Private Child Note ${suffix}`,
        content: "Hidden with the private subtree.",
        folder: privateChildFolder.id,
    });
    privateNote = await createNote(owner, {
        title: `MCP Private Note ${suffix}`,
        content: "Hidden by its own flag.",
        is_private: true,
    });
    privateBoard = await createBoard(owner, {
        name: `MCP Private Board ${suffix}`,
        is_private: true,
    });
    privateFolderBoard = await createBoard(owner, {
        name: `MCP Private Folder Board ${suffix}`,
        folder: privateFolder.id,
    });

    visibleFolder = await createFolder(owner, { name: `MCP Visible Folder ${suffix}` });
    visibleNote = await createNote(owner, {
        title: `MCP Visible Note ${suffix}`,
        content: "# Visible\n\nAI can read this.",
        tags: ["visible"],
    });
    visibleBoard = await createBoard(owner, { name: `MCP Visible Board ${suffix}` });
});

describe("MCP transport", () => {
    test("rejects a request without a token", async () => {
        const res = await mcpRequest(null, {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "anonymous", version: "1.0.0" },
            },
        });
        const body = await expectJsonError(res, 401, "Authorization");
        expect(typeof body.error).toBe("string");
    });

    test("rejects GET with 405 and Allow: POST", async () => {
        const res = await bunRequest(MCP_PATH, { method: "GET" });
        await expectJsonError(res, 405, "Method not allowed");
        expect(res.headers.get("Allow")).toBe("POST");
    });

    test("returns a JSON-RPC parse error for malformed JSON", async () => {
        const res = await mcpRequest(owner.token, "{\"jsonrpc\":");
        await expectStatus(res, 400, "malformed MCP body");
        expect(res.headers.get("Content-Type")).toContain("application/json");

        const body = await readJson<McpResponse>(res, "malformed MCP body");
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBeNull();
        expect(body.error?.code).toBe(-32700);
        expect(body.error?.message).toContain("Parse error");
    });

    test("initializes and lists the registered tools", async () => {
        const initialized = await mcpInitialize(owner.token);
        expect(initialized.result).toBeDefined();
        expect(initialized.result).toMatchObject({
            serverInfo: { name: "nana" },
        });
        expect(typeof initialized.result?.instructions).toBe("string");

        const list = await mcpJson(owner.token, {
            jsonrpc: "2.0",
            id: nextId(),
            method: "tools/list",
            params: {},
        });
        const tools = (list.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
        const names = tools.map((tool) => tool.name);
        expect(names).toEqual(
            expect.arrayContaining([
                "list_notes",
                "read_note",
                "create_note",
                "update_note",
                "delete_note",
                "list_boards",
                "create_board",
                "create_task",
                "delete_task",
                "add_note_to_board",
            ]),
        );
    });
});

describe("note tools", () => {
    test("runs the note write, read, move, and trash flow", async () => {
        const title = `MCP Note ${suffix}`;
        const folderName = `MCP Note Folder ${suffix}`;

        const folderCall = await mcpCall(owner.token, "create_folder", { name: folderName });
        expect(folderCall.isError).toBe(false);
        const folder = folderCall.payload as unknown as FolderDto;
        expect(folder.name).toBe(folderName);
        expect(folder.parentId).toBeNull();

        const createCall = await mcpCall(owner.token, "create_note", {
            title,
            content: "# Created\n\nInitial body",
            tags: ["mcp", "note"],
        });
        expect(createCall.isError).toBe(false);
        const note = createCall.payload as unknown as NoteDto;
        expect(note).toMatchObject({
            title,
            tags: ["mcp", "note"],
            folderId: null,
            isPrivate: false,
        });
        expect(note.content).toContain("Initial body");

        const listCall = await mcpCall(owner.token, "list_notes", { query: title });
        expect(listCall.isError).toBe(false);
        const list = listCall.payload as unknown as {
            notes: NoteSummaryDto[];
            totalItems: number;
        };
        const listed = list.notes.find((item) => item.id === note.id);
        expect(listed).toBeDefined();
        expect(listed).not.toHaveProperty("content");

        const readCall = await mcpCall(owner.token, "read_note", { noteId: note.id });
        expect(readCall.isError).toBe(false);
        expect(readCall.payload.content).toContain("Initial body");

        const updatedTitle = `MCP Note Updated ${suffix}`;
        const updateCall = await mcpCall(owner.token, "update_note", {
            noteId: note.id,
            title: updatedTitle,
            content: "# Updated\n\nNew body",
        });
        expect(updateCall.isError).toBe(false);
        expect(updateCall.payload).toMatchObject({ id: note.id, title: updatedTitle });
        expect(updateCall.payload.content).toContain("New body");

        const moveCall = await mcpCall(owner.token, "move_note", {
            noteId: note.id,
            folderId: folder.id,
        });
        expect(moveCall.isError).toBe(false);
        expect(moveCall.payload.folderId).toBe(folder.id);

        const folderListCall = await mcpCall(owner.token, "list_notes", { folderId: folder.id });
        const folderList = folderListCall.payload as unknown as { notes: NoteSummaryDto[] };
        expect(folderList.notes.map((item) => item.id)).toContain(note.id);

        const deleteCall = await mcpCall(owner.token, "delete_note", { noteId: note.id });
        expect(deleteCall.isError).toBe(false);
        expect(deleteCall.payload).toEqual({
            deleted: true,
            trashDocumentId: expect.any(String),
        });

        const trashId = deleteCall.payload.trashDocumentId as string;
        expect(await pbRecordExists(owner.token, "documents", note.id)).toBe(false);
        const trash = await pbGetRecord<{ original_document_id: string }>(
            owner.token,
            "trash_documents",
            trashId,
        );
        expect(trash.original_document_id).toBe(note.id);

        const afterDeleteCall = await mcpCall(owner.token, "list_notes", { folderId: folder.id });
        const afterDelete = afterDeleteCall.payload as unknown as { notes: NoteSummaryDto[] };
        expect(afterDelete.notes.map((item) => item.id)).not.toContain(note.id);
    });
});

describe("board and task tools", () => {
    test("runs the board and task lifecycle", async () => {
        const boardName = `MCP Board ${suffix}`;
        const createBoardCall = await mcpCall(owner.token, "create_board", {
            name: boardName,
            description: "MCP board description",
        });
        expect(createBoardCall.isError).toBe(false);
        const board = createBoardCall.payload as unknown as BoardDto;
        expect(board).toMatchObject({
            name: boardName,
            description: "MCP board description",
            archived: false,
            isPrivate: false,
        });

        const defaultBoardsCall = await mcpCall(owner.token, "list_boards");
        const defaultBoards = defaultBoardsCall.payload as unknown as {
            boards: Array<{ id: string }>;
        };
        expect(defaultBoards.boards.map((item) => item.id)).toContain(board.id);

        const taskTitle = `MCP Task ${suffix}`;
        const createTaskCall = await mcpCall(owner.token, "create_task", {
            boardId: board.id,
            title: taskTitle,
            description: "Task body",
            status: "backlog",
            priority: "high",
            labels: ["mcp"],
            boardOrder: 1,
        });
        expect(createTaskCall.isError).toBe(false);
        const task = createTaskCall.payload as unknown as TaskDto;
        expect(task).toMatchObject({
            title: taskTitle,
            status: "backlog",
            priority: "high",
            labels: ["mcp"],
            boardOrder: 1,
            boardId: board.id,
        });

        const tasksCall = await mcpCall(owner.token, "list_tasks", { boardId: board.id });
        const tasks = tasksCall.payload as unknown as { items: TaskDto[] };
        expect(tasks.items.map((item) => item.id)).toContain(task.id);

        const updatedTitle = `MCP Task Updated ${suffix}`;
        const updateCall = await mcpCall(owner.token, "update_task", {
            taskId: task.id,
            status: "next",
            title: updatedTitle,
        });
        expect(updateCall.isError).toBe(false);
        expect(updateCall.payload).toMatchObject({
            id: task.id,
            title: updatedTitle,
            status: "next",
        });

        const moveCall = await mcpCall(owner.token, "move_task", {
            taskId: task.id,
            status: "progress",
            boardOrder: 4,
        });
        expect(moveCall.isError).toBe(false);
        expect(moveCall.payload).toMatchObject({
            id: task.id,
            status: "progress",
            boardOrder: 4,
        });

        const activeDeleteCall = await mcpCall(owner.token, "delete_board", { boardId: board.id });
        expect(activeDeleteCall.isError).toBe(true);
        expect(activeDeleteCall.payload.error).toMatchObject({ code: "conflict" });

        const archiveCall = await mcpCall(owner.token, "archive_board", { boardId: board.id });
        expect(archiveCall.isError).toBe(false);
        expect(archiveCall.payload.archived).toBe(true);

        const activeBoardsCall = await mcpCall(owner.token, "list_boards");
        const activeBoards = activeBoardsCall.payload as unknown as {
            boards: Array<{ id: string }>;
        };
        expect(activeBoards.boards.map((item) => item.id)).not.toContain(board.id);

        const allBoardsCall = await mcpCall(owner.token, "list_boards", { includeArchived: true });
        const allBoards = allBoardsCall.payload as unknown as {
            boards: Array<{ id: string; archived: boolean }>;
        };
        const archivedBoard = allBoards.boards.find((item) => item.id === board.id);
        expect(archivedBoard).toBeDefined();
        expect(archivedBoard?.archived).toBe(true);

        const restoreCall = await mcpCall(owner.token, "restore_board", { boardId: board.id });
        expect(restoreCall.isError).toBe(false);
        expect(restoreCall.payload.archived).toBe(false);

        const linkedNoteTitle = `MCP Linked Note ${suffix}`;
        const linkedNoteCall = await mcpCall(owner.token, "create_note", {
            title: linkedNoteTitle,
            content: "# Linked\n\nPlain **excerpt**",
            tags: ["alpha", "beta"],
        });
        const linkedNote = linkedNoteCall.payload as unknown as NoteDto;

        const addNoteCall = await mcpCall(owner.token, "add_note_to_board", {
            boardId: board.id,
            noteId: linkedNote.id,
            status: "done",
        });
        expect(addNoteCall.isError).toBe(false);
        const linkedTask = addNoteCall.payload as unknown as TaskDto;
        expect(linkedTask).toMatchObject({
            title: linkedNoteTitle,
            status: "done",
            noteId: linkedNote.id,
            boardId: board.id,
            labels: ["alpha", "beta"],
        });
        expect(linkedTask.description).toContain("Plain excerpt");

        const deleteLinkedCall = await mcpCall(owner.token, "delete_task", { taskId: linkedTask.id });
        expect(deleteLinkedCall.isError).toBe(false);
        expect(deleteLinkedCall.payload).toEqual({ deleted: true, taskId: linkedTask.id });
        expect(await pbRecordExists(owner.token, "tasks", linkedTask.id)).toBe(false);
        // Deleting a task never deletes its linked note.
        expect(await pbRecordExists(owner.token, "documents", linkedNote.id)).toBe(true);

        const archiveAgainCall = await mcpCall(owner.token, "archive_board", { boardId: board.id });
        expect(archiveAgainCall.isError).toBe(false);

        const deleteBoardCall = await mcpCall(owner.token, "delete_board", { boardId: board.id });
        expect(deleteBoardCall.isError).toBe(false);
        expect(deleteBoardCall.payload).toEqual({ deleted: true, boardId: board.id });
        expect(await pbRecordExists(owner.token, "boards", board.id)).toBe(false);
        // PocketBase cascades the board's tasks.
        expect(await pbRecordExists(owner.token, "tasks", task.id)).toBe(false);

        const restRes = await bunRequest(`/api/v1/boards/${board.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectJsonError(restRes, 404, "not found");
    });
});

describe("private lock", () => {
    test("hides private notes and private folder subtrees from lists", async () => {
        const listCall = await mcpCall(owner.token, "list_notes", { perPage: 50 });
        expect(listCall.isError).toBe(false);
        const notes = (listCall.payload as unknown as { notes: NoteSummaryDto[] }).notes;
        const ids = notes.map((note) => note.id);

        expect(ids).toContain(visibleNote.id);
        expect(ids).not.toContain(privateNote.id);
        expect(ids).not.toContain(privateFolderNote.id);
        expect(ids).not.toContain(privateChildNote.id);
    });

    test("makes hidden notes look missing by id", async () => {
        for (const note of [privateNote, privateFolderNote, privateChildNote]) {
            const call = await mcpCall(owner.token, "read_note", { noteId: note.id });
            expectNotFound(call);
        }
    });

    test("hides private boards and private folder boards from lists", async () => {
        const listCall = await mcpCall(owner.token, "list_boards", { includeArchived: true });
        expect(listCall.isError).toBe(false);
        const boards = (listCall.payload as unknown as { boards: Array<{ id: string }> }).boards;
        const ids = boards.map((board) => board.id);

        expect(ids).toContain(visibleBoard.id);
        expect(ids).not.toContain(privateBoard.id);
        expect(ids).not.toContain(privateFolderBoard.id);
    });

    test("makes hidden boards look missing by id", async () => {
        for (const board of [privateBoard, privateFolderBoard]) {
            const call = await mcpCall(owner.token, "read_board", { boardId: board.id });
            expectNotFound(call);
        }
    });

    test("hides private folders and their descendants from lists", async () => {
        const listCall = await mcpCall(owner.token, "list_folders");
        expect(listCall.isError).toBe(false);
        const folders = listCall.payload as unknown as FolderDto[];
        const ids = folders.map((folder) => folder.id);

        expect(ids).toContain(visibleFolder.id);
        expect(ids).not.toContain(privateFolder.id);
        expect(ids).not.toContain(privateChildFolder.id);
    });

    test("refuses writes into hidden folders and boards", async () => {
        const noteCall = await mcpCall(owner.token, "create_note", {
            title: `MCP Hidden Note ${suffix}`,
            folderId: privateFolder.id,
        });
        expectNotFound(noteCall);

        const boardCall = await mcpCall(owner.token, "create_board", {
            name: `MCP Hidden Board ${suffix}`,
            folderId: privateFolder.id,
        });
        expectNotFound(boardCall);

        const taskCall = await mcpCall(owner.token, "create_task", {
            boardId: privateBoard.id,
            title: `MCP Hidden Task ${suffix}`,
        });
        expectNotFound(taskCall);

        const folderCall = await mcpCall(owner.token, "create_folder", {
            name: `MCP Hidden Child ${suffix}`,
            parentId: privateFolder.id,
        });
        expectNotFound(folderCall);
    });

    test("keeps the same private records visible on the REST owner surface", async () => {
        const noteRes = await bunRequest(`/api/v1/notes/${privateNote.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(noteRes, 200, "REST owner reads private note");
        expect((await readJson<NoteDto>(noteRes, "REST private note")).isPrivate).toBe(true);

        const folderNoteRes = await bunRequest(`/api/v1/notes/${privateFolderNote.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(folderNoteRes, 200, "REST owner reads private folder note");

        const boardRes = await bunRequest(`/api/v1/boards/${privateBoard.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(boardRes, 200, "REST owner reads private board");
        expect((await readJson<BoardDto>(boardRes, "REST private board")).isPrivate).toBe(true);

        const folderBoardRes = await bunRequest(`/api/v1/boards/${privateFolderBoard.id}`, {
            headers: authHeaders(owner.token),
        });
        await expectStatus(folderBoardRes, 200, "REST owner reads private folder board");
    });
});
