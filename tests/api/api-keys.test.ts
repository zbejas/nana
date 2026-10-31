import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    readJson,
} from "../helpers/client";
import {
    createBoard,
    createFolder,
    createNote,
    createTask,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, uniqueSuffix } from "../helpers/setup";

/**
 * Long-lived API keys: creation, hashed storage, read-only access, folder/root
 * scope on the typed REST API and MCP, revocation, and the session-only
 * management boundary.
 */

const API = "/api/v1";
const MCP_PATH = "/mcp";
const MCP_ACCEPT = "application/json, text/event-stream";

interface ApiKeyDto {
    id: string;
    name: string;
    prefix: string;
    access: "read" | "write";
    scope: "workspace" | "root" | "folders";
    folders: Array<{ id: string; name: string }>;
    lastUsedAt: string | null;
    createdAt: string;
}

interface CreatedKey {
    token: string;
    apiKey: ApiKeyDto;
}

interface FolderDto {
    id: string;
    name: string;
    parentId: string | null;
}

interface NoteSummaryDto {
    id: string;
    title: string;
    folderId: string | null;
}

interface NoteList {
    items: NoteSummaryDto[];
}

interface BoardDto {
    id: string;
    name: string;
    folderId: string | null;
}

interface BoardList {
    items: BoardDto[];
}

interface McpToolResult {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    instructions?: string;
    tools?: Array<{ name: string }>;
    [key: string]: unknown;
}

interface McpResponse {
    jsonrpc: string;
    id: number | null;
    result?: McpToolResult;
    error?: { code: number; message: string };
}

let owner: TestUser;
let other: TestUser;

let alpha: TestRecord;
let alphaChild: TestRecord;
let alphaGrandchild: TestRecord;
let beta: TestRecord;
let betaChild: TestRecord;

let alphaNote: TestRecord;
let alphaChildNote: TestRecord;
let betaNote: TestRecord;
let rootNote: TestRecord;
let privateNote: TestRecord;

let alphaBoard: TestRecord;
let betaBoard: TestRecord;
let rootBoard: TestRecord;
let betaTask: TestRecord;

let requestId = 0;

const suffix = uniqueSuffix();

function nextId(): number {
    requestId += 1;
    return requestId;
}

function apiGet(path: string, token: string): Promise<Response> {
    return bunRequest(`${API}${path}`, { headers: authHeaders(token) });
}

function apiPost(path: string, body: unknown, token: string, bearer = false): Promise<Response> {
    return bunRequest(`${API}${path}`, {
        method: "POST",
        headers: {
            ...(bearer ? { Authorization: `Bearer ${token}` } : authHeaders(token)),
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

function apiPatch(path: string, body: unknown, token: string): Promise<Response> {
    return bunRequest(`${API}${path}`, {
        method: "PATCH",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function apiDelete(path: string, token: string): Promise<Response> {
    return bunRequest(`${API}${path}`, { method: "DELETE", headers: authHeaders(token) });
}

async function createKey(
    sessionToken: string,
    body: {
        name?: string;
        access?: "read" | "write";
        scope?: "workspace" | "root" | "folders";
        folderIds?: string[];
    },
): Promise<CreatedKey> {
    const response = await apiPost("/api-keys", {
        name: body.name ?? `Key ${uniqueSuffix()}`,
        access: body.access ?? "write",
        scope: body.scope ?? "workspace",
        folderIds: body.folderIds ?? [],
    }, sessionToken);
    await expectStatus(response, 201, "create API key");
    return readJson<CreatedKey>(response, "create API key");
}

async function listNotesWith(token: string): Promise<NoteList> {
    const response = await apiGet("/notes?perPage=50", token);
    await expectStatus(response, 200, "list notes with API key");
    return readJson<NoteList>(response, "list notes with API key");
}

async function listBoardsWith(token: string): Promise<BoardList> {
    const response = await apiGet("/boards?includeArchived=true&perPage=50", token);
    await expectStatus(response, 200, "list boards with API key");
    return readJson<BoardList>(response, "list boards with API key");
}

async function listFoldersWith(token: string): Promise<FolderDto[]> {
    const response = await apiGet("/folders", token);
    await expectStatus(response, 200, "list folders with API key");
    return readJson<FolderDto[]>(response, "list folders with API key");
}

function mcpRequest(token: string, body: unknown): Promise<Response> {
    return bunRequest(MCP_PATH, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: MCP_ACCEPT,
        },
        body: JSON.stringify(body),
    });
}

async function mcpJson(token: string, body: unknown): Promise<McpResponse> {
    const response = await mcpRequest(token, body);
    await expectStatus(response, 200, "MCP request with API key");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    return readJson<McpResponse>(response, "MCP response");
}

async function mcpInitialize(token: string): Promise<McpResponse> {
    return mcpJson(token, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "initialize",
        params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "nana-api-key-tests", version: "1.0.0" },
        },
    });
}

async function mcpToolNames(token: string): Promise<string[]> {
    const response = await mcpJson(token, {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/list",
        params: {},
    });
    return (response.result?.tools ?? []).map((tool) => tool.name);
}

interface McpCall {
    isError: boolean;
    payload: Record<string, unknown>;
    response: McpResponse;
}

async function mcpCall(
    token: string,
    name: string,
    args: Record<string, unknown>,
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
    if (typeof text !== "string") throw new Error(`tools/call ${name} returned no text`);

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
    owner = await createUser("api-key-owner");
    other = await createUser("api-key-other");

    alpha = await createFolder(owner, { name: `Alpha ${suffix}` });
    alphaChild = await createFolder(owner, { name: `Alpha child ${suffix}`, parent: alpha.id });
    alphaGrandchild = await createFolder(owner, { name: `Alpha grandchild ${suffix}`, parent: alphaChild.id });
    beta = await createFolder(owner, { name: `Beta ${suffix}` });
    betaChild = await createFolder(owner, { name: `Beta child ${suffix}`, parent: beta.id });

    alphaNote = await createNote(owner, { title: `Alpha note ${suffix}`, folder: alpha.id });
    alphaChildNote = await createNote(owner, { title: `Alpha child note ${suffix}`, folder: alphaChild.id });
    betaNote = await createNote(owner, { title: `Beta note ${suffix}`, folder: beta.id });
    rootNote = await createNote(owner, { title: `Root note ${suffix}` });
    privateNote = await createNote(owner, { title: `Private note ${suffix}`, folder: alpha.id, is_private: true });

    alphaBoard = await createBoard(owner, { name: `Alpha board ${suffix}`, folder: alpha.id });
    betaBoard = await createBoard(owner, { name: `Beta board ${suffix}`, folder: beta.id });
    rootBoard = await createBoard(owner, { name: `Root board ${suffix}` });
    betaTask = await createTask(owner, betaBoard.id, { title: `Beta task ${suffix}` });
});

describe("API key creation and hashed storage", () => {
    test("returns the secret once, stores metadata, and authenticates the typed API", async () => {
        const created = await createKey(owner.token, {
            name: `Workspace key ${suffix}`,
            access: "write",
            scope: "workspace",
        });

        expect(created.token).toMatch(/^nana_[A-Za-z0-9_-]{32,64}$/);
        expect(created.apiKey.prefix).toBe(created.token.slice(0, 16));
        expect(created.apiKey).toMatchObject({
            name: `Workspace key ${suffix}`,
            access: "write",
            scope: "workspace",
            folders: [],
        });
        expect(JSON.stringify(created.apiKey)).not.toContain("key_hash");
        expect(JSON.stringify(created.apiKey)).not.toContain(created.token);

        const listed = await readJson<ApiKeyDto[]>(await apiGet("/api-keys", owner.token), "list API keys");
        const record = listed.find((key) => key.id === created.apiKey.id);
        expect(record).toBeDefined();
        expect(JSON.stringify(record)).not.toContain(created.token);
        expect(JSON.stringify(record)).not.toContain("key_hash");
        expect(JSON.stringify(record)).not.toContain("keyHash");

        const folders = await listFoldersWith(created.token);
        expect(folders.map((folder) => folder.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]));

        const me = await apiGet("/notes", created.token);
        await expectStatus(me, 200, "typed API with API key");

        const manage = await apiPost("/api-keys", {
            name: "Nested key",
            access: "read",
            scope: "workspace",
        }, created.token);
        await expectJsonError(manage, 403, "cannot manage API keys");

        const revoked = await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
        await expectStatus(revoked, 204, "revoke API key");
    });

    test("accepts a Bearer key as well as a raw key", async () => {
        const created = await createKey(owner.token, { name: `Bearer key ${suffix}`, scope: "workspace" });
        const response = await apiPost("/notes", { title: `Bearer note ${suffix}` }, created.token, true);
        await expectStatus(response, 201, "create note with Bearer API key");
        await apiDelete(`/notes/${(await readJson<NoteSummaryDto>(response, "created note")).id}`, created.token);
        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });

    test("validates scope and folder ownership", async () => {
        const noFolders = await apiPost("/api-keys", {
            name: "Missing folders",
            access: "read",
            scope: "folders",
            folderIds: [],
        }, owner.token);
        await expectJsonError(noFolders, 400, "at least one folder");

        const foreign = await createFolder(other, { name: `Other folder ${suffix}` });
        const foreignKey = await apiPost("/api-keys", {
            name: "Foreign folder",
            access: "read",
            scope: "folders",
            folderIds: [foreign.id],
        }, owner.token);
        await expectJsonError(foreignKey, 400, "not available");

        const invalidScope = await apiPost("/api-keys", {
            name: "Bad scope",
            access: "read",
            scope: "universe",
        }, owner.token);
        await expectJsonError(invalidScope, 422);
    });
});

describe("folder-scoped keys", () => {
    test("restrict reads, writes, folders, boards, and tasks to the subtree", async () => {
        const created = await createKey(owner.token, {
            name: `Folder key ${suffix}`,
            access: "write",
            scope: "folders",
            folderIds: [alpha.id],
        });
        expect(created.apiKey.folders).toEqual([{ id: alpha.id, name: `Alpha ${suffix}` }]);

        const notes = await listNotesWith(created.token);
        const noteIds = notes.items.map((note) => note.id);
        expect(noteIds).toEqual(expect.arrayContaining([alphaNote.id, alphaChildNote.id]));
        expect(noteIds).not.toContain(betaNote.id);
        expect(noteIds).not.toContain(rootNote.id);
        for (const note of notes.items) {
            expect([alpha.id, alphaChild.id, alphaGrandchild.id]).toContain(note.folderId);
        }

        await expectStatus(await apiGet(`/notes/${betaNote.id}`, created.token), 404, "read outside folder scope");
        await expectStatus(await apiGet(`/notes/${rootNote.id}`, created.token), 404, "read root with folder key");

        const folders = await listFoldersWith(created.token);
        const folderIds = folders.map((folder) => folder.id);
        expect(folderIds.sort()).toEqual([alpha.id, alphaChild.id, alphaGrandchild.id].sort());
        expect(folders.find((folder) => folder.id === alpha.id)?.parentId).toBeNull();

        await expectStatus(
            await apiPost("/notes", { title: `Outside ${suffix}`, folderId: beta.id }, created.token),
            404,
            "create in another folder",
        );
        await expectStatus(
            await apiPost("/notes", { title: `Root create ${suffix}` }, created.token),
            404,
            "create at root with folder key",
        );
        await expectStatus(
            await apiPost("/folders", { name: `Root folder ${suffix}` }, created.token),
            404,
            "create root folder with folder key",
        );

        const inside = await apiPost("/notes", {
            title: `Inside ${suffix}`,
            folderId: alphaChild.id,
        }, created.token);
        await expectStatus(inside, 201, "create inside folder scope");

        const moveNote = await createNote(owner, {
            title: `Move note ${suffix}`,
            folder: alpha.id,
        });
        await expectStatus(
            await apiPatch(`/notes/${moveNote.id}`, { folderId: beta.id }, created.token),
            404,
            "move note outside scope",
        );
        await expectStatus(
            await apiPatch(`/notes/${moveNote.id}`, { folderId: "" }, created.token),
            404,
            "move note to root with folder key",
        );
        const moved = await apiPatch(`/notes/${moveNote.id}`, { folderId: alphaChild.id }, created.token);
        await expectStatus(moved, 200, "move note inside scope");

        const boards = await listBoardsWith(created.token);
        const boardIds = boards.items.map((board) => board.id);
        expect(boardIds).toContain(alphaBoard.id);
        expect(boardIds).not.toContain(betaBoard.id);
        expect(boardIds).not.toContain(rootBoard.id);
        for (const board of boards.items) {
            expect([alpha.id, alphaChild.id, alphaGrandchild.id]).toContain(board.folderId);
        }

        await expectStatus(await apiGet(`/boards/${betaBoard.id}`, created.token), 404, "read outside board scope");
        await expectStatus(await apiGet(`/boards/${betaBoard.id}/tasks`, created.token), 404, "list tasks outside scope");
        await expectStatus(await apiGet(`/tasks/${betaTask.id}`, created.token), 404, "read task outside scope");
        await expectStatus(
            await apiPatch(`/tasks/${betaTask.id}`, { status: "done" }, created.token),
            404,
            "write task outside scope",
        );

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });

    test("MCP limits folder lists, re-roots the scope root, and hides outside records", async () => {
        const created = await createKey(owner.token, {
            name: `MCP folder key ${suffix}`,
            access: "write",
            scope: "folders",
            folderIds: [alphaChild.id],
        });

        const initialized = await mcpInitialize(created.token);
        expect(initialized.result?.instructions).toContain("selected for it");
        expect(initialized.result?.instructions).toContain("folder");

        const folders = await mcpCall(created.token, "list_folders", {});
        expect(folders.isError).toBe(false);
        const folderItems = folders.payload as unknown as FolderDto[];
        expect(folderItems.map((folder) => folder.id).sort()).toEqual([alphaChild.id, alphaGrandchild.id].sort());
        expect(folderItems.find((folder) => folder.id === alphaChild.id)?.parentId).toBeNull();

        const notes = await mcpCall(created.token, "list_notes", {});
        expect(notes.isError).toBe(false);
        const noteItems = (notes.payload as unknown as { notes: NoteSummaryDto[] }).notes;
        const noteIds = noteItems.map((note) => note.id);
        expect(noteIds).toContain(alphaChildNote.id);
        expect(noteIds).not.toContain(alphaNote.id);
        expect(noteIds).not.toContain(betaNote.id);

        expectNotFound(await mcpCall(created.token, "read_note", { noteId: alphaNote.id }));
        expectNotFound(await mcpCall(created.token, "read_note", { noteId: betaNote.id }));
        expect(
            (await mcpCall(created.token, "read_note", { noteId: alphaChildNote.id })).isError,
        ).toBe(false);

        expectNotFound(await mcpCall(created.token, "create_note", {
            title: `Outside MCP ${suffix}`,
            folderId: beta.id,
        }));
        expectNotFound(await mcpCall(created.token, "create_note", { title: `Root MCP ${suffix}` }));
        expect(
            (await mcpCall(created.token, "create_note", {
                title: `Inside MCP ${suffix}`,
                folderId: alphaChild.id,
            })).isError,
        ).toBe(false);

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });
});

describe("root-scoped keys", () => {
    test("see only root notes and boards and cannot touch folders", async () => {
        const created = await createKey(owner.token, {
            name: `Root key ${suffix}`,
            access: "write",
            scope: "root",
        });

        const toolNames = await mcpToolNames(created.token);
        expect(toolNames).toContain("create_note");
        expect(toolNames).not.toContain("create_folder");

        const notes = await listNotesWith(created.token);
        const noteIds = notes.items.map((note) => note.id);
        expect(noteIds).toContain(rootNote.id);
        expect(noteIds).not.toContain(alphaNote.id);
        expect(noteIds).not.toContain(betaNote.id);
        for (const note of notes.items) expect(note.folderId).toBeNull();

        await expectStatus(await apiGet(`/notes/${alphaNote.id}`, created.token), 404, "read folder note with root key");

        const folders = await listFoldersWith(created.token);
        expect(folders).toEqual([]);

        const boards = await listBoardsWith(created.token);
        const boardIds = boards.items.map((board) => board.id);
        expect(boardIds).toContain(rootBoard.id);
        expect(boardIds).not.toContain(alphaBoard.id);
        expect(boardIds).not.toContain(betaBoard.id);
        for (const board of boards.items) expect(board.folderId).toBeNull();

        await expectStatus(
            await apiPost("/notes", { title: `Root only ${suffix}` }, created.token),
            201,
            "create root note with root key",
        );
        await expectStatus(
            await apiPost("/notes", { title: `Folder blocked ${suffix}`, folderId: alpha.id }, created.token),
            404,
            "create folder note with root key",
        );
        await expectStatus(
            await apiPost("/folders", { name: `Folder blocked ${suffix}` }, created.token),
            404,
            "create folder with root key",
        );

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });
});

describe("workspace keys and the AI private lock", () => {
    test("cover the whole workspace but still hide private records from MCP", async () => {
        const created = await createKey(owner.token, {
            name: `AI lock key ${suffix}`,
            access: "write",
            scope: "workspace",
        });

        const notes = await listNotesWith(created.token);
        expect(notes.items.map((note) => note.id)).toEqual(expect.arrayContaining([
            rootNote.id,
            alphaNote.id,
            betaNote.id,
            privateNote.id,
        ]));

        const folders = await listFoldersWith(created.token);
        expect(folders.map((folder) => folder.id)).toEqual(expect.arrayContaining([alpha.id, beta.id, betaChild.id]));

        const mcpNotes = await mcpCall(created.token, "list_notes", {});
        expect(mcpNotes.isError).toBe(false);
        const mcpIds = ((mcpNotes.payload as unknown as { notes: NoteSummaryDto[] }).notes).map((note) => note.id);
        expect(mcpIds).toContain(rootNote.id);
        expect(mcpIds).toContain(alphaNote.id);
        expect(mcpIds).not.toContain(privateNote.id);

        expectNotFound(await mcpCall(created.token, "read_note", { noteId: privateNote.id }));

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });
});

describe("read-only keys", () => {
    test("allow reads, refuse typed writes, and hide MCP write tools", async () => {
        const created = await createKey(owner.token, {
            name: `Read key ${suffix}`,
            access: "read",
            scope: "workspace",
        });

        await expectStatus(await apiGet("/notes", created.token), 200, "read with read-only key");
        await expectStatus(
            await apiPost("/notes", { title: `Read only blocked ${suffix}` }, created.token),
            403,
            "create with read-only key",
        );
        await expectStatus(
            await apiPatch(`/notes/${alphaNote.id}`, { title: "Blocked" }, created.token),
            403,
            "update with read-only key",
        );
        await expectStatus(
            await apiDelete(`/notes/${alphaNote.id}`, created.token),
            403,
            "delete with read-only key",
        );

        const initialized = await mcpInitialize(created.token);
        expect(initialized.result?.instructions).toContain("read-only");

        const names = await mcpToolNames(created.token);
        expect(names).toEqual(expect.arrayContaining([
            "list_folders",
            "list_notes",
            "read_note",
            "list_boards",
            "read_board",
            "list_tasks",
        ]));
        for (const writeTool of [
            "create_folder",
            "create_note",
            "update_note",
            "move_note",
            "delete_note",
            "create_board",
            "update_board",
            "move_board",
            "archive_board",
            "restore_board",
            "delete_board",
            "create_task",
            "update_task",
            "move_task",
            "delete_task",
            "add_note_to_board",
        ]) {
            expect(names).not.toContain(writeTool);
        }

        const read = await mcpCall(created.token, "list_notes", {});
        expect(read.isError).toBe(false);

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });
});

describe("revocation and rejection", () => {
    test("revocation is immediate and cannot be performed by another account", async () => {
        const created = await createKey(owner.token, { name: `Revoke key ${suffix}`, scope: "workspace" });
        await expectStatus(await apiGet("/notes", created.token), 200, "use key before revoke");

        await expectStatus(
            await apiDelete(`/api-keys/${created.apiKey.id}`, other.token),
            404,
            "cross-account revoke",
        );
        await expectStatus(
            await apiGet("/notes", created.token),
            200,
            "key still works after failed cross-account revoke",
        );

        await expectStatus(await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token), 204, "owner revoke");
        await expectJsonError(await apiGet("/notes", created.token), 401, "Invalid API key");
    });

    test("rejects invalid keys and keeps them out of the browser facade", async () => {
        await expectJsonError(
            await apiGet("/notes", `nana_${"x".repeat(43)}`),
            401,
            "Invalid API key",
        );

        const created = await createKey(owner.token, { name: `Facade key ${suffix}`, scope: "workspace" });
        await expectStatus(
            await bunRequest(`${API}/records/documents`, { headers: authHeaders(created.token) }),
            401,
            "browser facade rejects API keys",
        );
        await expectStatus(
            await bunRequest(`${API}/me`, { headers: authHeaders(created.token) }),
            401,
            "browser profile route rejects API keys",
        );

        await apiDelete(`/api-keys/${created.apiKey.id}`, owner.token);
    });
});
