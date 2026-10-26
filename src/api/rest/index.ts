import { openapi } from "@elysia/openapi";
import { Elysia, status } from "elysia";
import type { ErrorHandler } from "elysia";
import { existsSync } from "fs";
import { resolve } from "path";
import { createLogger } from "../../lib/logger";
import {
    createApiKeyForUser,
    listApiKeysForUser,
    revokeApiKeyForUser,
} from "../api-keys";
import type { ApiKeyDto } from "../api-keys/types";
import {
    addNoteToBoard,
    createBoard,
    createFolder,
    createNote,
    createTask,
    deleteBoard,
    deleteNote,
    deleteTask,
    getBoard,
    getNote,
    getTask,
    listBoards,
    listFolders,
    listNotes,
    listTasks,
    updateBoard,
    updateNote,
    updateTask,
    type ToolContext,
} from "../workspace";
import { ApiError, forbidden } from "../workspace/errors";
import { authenticateApiRequest, AuthError } from "./auth";
import {
    AddNoteToBoardBodySchema,
    ApiKeyListSchema,
    BoardDtoSchema,
    BoardListSchema,
    CreateApiKeyBodySchema,
    CreateBoardBodySchema,
    CreateFolderBodySchema,
    CreateNoteBodySchema,
    CreateTaskBodySchema,
    CreatedApiKeySchema,
    DeleteNoteResultSchema,
    FolderDtoSchema,
    FolderListSchema,
    IdParamsSchema,
    ListBoardsQuerySchema,
    ListNotesQuerySchema,
    ListTasksQuerySchema,
    NoteDtoSchema,
    NoteListSchema,
    TaskDtoSchema,
    TaskListSchema,
    UpdateBoardBodySchema,
    UpdateNoteBodySchema,
    UpdateTaskBodySchema,
} from "./schemas";
import { adminApi } from "./admin";
import { browserApi } from "./browser";
import {
    apiOpenApiConfig,
    GEIST_FONT_PATH,
    GEIST_MONO_FONT_PATH,
    SCALAR_BUNDLE_PATH,
} from "./openapi";
import {
    ConflictErrorSchema,
    NotFoundErrorSchema,
    workspaceErrorSchemas,
} from "./responses";

const log = createLogger("REST");

const docsAssetsDir = resolve(import.meta.dir, "../../../node_modules/@scalar/api-reference/dist/browser");
const scalarBundlePath = resolve(docsAssetsDir, "standalone.js");
const geistFontPath = resolve(import.meta.dir, "../../assets/fonts/geist-variable.woff2");
const geistMonoFontPath = resolve(import.meta.dir, "../../assets/fonts/geist-mono-variable.woff2");

function assetResponse(path: string, contentType: string, cacheControl = "public, max-age=3600"): Response {
    if (!existsSync(path)) {
        return new Response("Not Found", { status: 404 });
    }
    return new Response(Bun.file(path), {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
        },
    });
}

const handleApiError: ErrorHandler = ({ code, error, request, set }) => {
    if (error instanceof ApiError) {
        set.status = error.status;
        return { error: error.message };
    }
    if (error instanceof AuthError) {
        set.status = error.status || 401;
        return { error: error.message };
    }
    if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Invalid request." };
    }
    if (code === "PARSE") {
        set.status = 400;
        return { error: "Invalid request body." };
    }
    if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found." };
    }

    let path = "";
    try {
        path = new URL(request.url).pathname;
    } catch {
        path = "";
    }
    log.error("Unhandled REST error", {
        code,
        name: error instanceof Error ? error.name : "unknown",
        method: request.method,
        path,
    });

    set.status = 500;
    return { error: "Internal server error." };
};

/**
 * Key management is a session action. A key cannot mint, list, or revoke
 * credentials, even when it belongs to an admin.
 */
function assertSessionKeyManagement(workspace: ToolContext): void {
    if (workspace.apiKey) throw forbidden("API keys cannot manage API keys.");
}

async function listSessionApiKeys(workspace: ToolContext): Promise<ApiKeyDto[]> {
    assertSessionKeyManagement(workspace);
    return listApiKeysForUser(workspace.userId);
}

const v1 = new Elysia({ prefix: "/api/v1", name: "api-v1" })
    .onError(handleApiError)
    .derive({ as: "scoped" }, async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        const workspace: ToolContext = {
            authHeader: auth.authHeader,
            userId: auth.userId,
            apiKey: auth.apiKey,
        };
        return { auth, workspace };
    })
    // ── Folders ─────────────────────────────────────────────────────
    .get("/folders", ({ workspace }) => listFolders(workspace), {
        response: { 200: FolderListSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Folders"],
            operationId: "listFolders",
            summary: "List folders",
            description: "Returns every folder owned by the caller as a flat array, sorted by name. Build the tree from `parentId`. AI surfaces hide private subtrees; this owner surface does not.",
        },
    })
    .post("/folders", ({ workspace, body, set }) => {
        set.status = 201;
        return createFolder(workspace, "user", body);
    }, {
        body: CreateFolderBodySchema,
        response: { 201: FolderDtoSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Folders"],
            operationId: "createFolder",
            summary: "Create a folder",
            description: "Creates a folder, optionally nested under an owned parent. The caller becomes the author; the server never accepts an author from the request body.",
        },
    })
    // ── Notes ───────────────────────────────────────────────────────
    .get("/notes", ({ workspace, query }) => listNotes(workspace, "user", query), {
        query: ListNotesQuerySchema,
        response: { 200: NoteListSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Notes"],
            operationId: "listNotes",
            summary: "List notes",
            description: "Returns note metadata only: `content` is never included in a list. `query` searches titles and tags (not bodies). Use `folderId` to scope to one folder; omit it for the whole library.",
        },
    })
    .post("/notes", ({ workspace, body, set }) => {
        set.status = 201;
        return createNote(workspace, "user", body);
    }, {
        body: CreateNoteBodySchema,
        response: { 201: NoteDtoSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Notes"],
            operationId: "createNote",
            summary: "Create a note",
            description: "Creates a note and returns the full record. `content` is sanitized before it is stored. Titles default to `Untitled`; slugs are generated from the title.",
        },
    })
    .get("/notes/:id", ({ workspace, params }) => getNote(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: NoteDtoSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Notes"],
            operationId: "getNote",
            summary: "Read a note",
            description: "Returns the full note, including sanitized content, slug, tags, folder, privacy flags, and reading statistics.",
        },
    })
    .patch("/notes/:id", ({ workspace, params, body }) => updateNote(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateNoteBodySchema,
        response: { 200: NoteDtoSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Notes"],
            operationId: "updateNote",
            summary: "Update a note",
            description: "Partial update. Send `folderId: \"\"` or `null` to move the note to the workspace root. Attachments, publishing, and versions are not managed by this endpoint.",
        },
    })
    .delete("/notes/:id", ({ workspace, params }) => deleteNote(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: DeleteNoteResultSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Notes"],
            operationId: "deleteNote",
            summary: "Move a note to trash",
            description: "Soft-deletes the note through the PocketBase trash route and returns the trashed document id. Restore or permanently delete it from the trash surface.",
        },
    })
    // ── Boards ──────────────────────────────────────────────────────
    .get("/boards", ({ workspace, query }) => listBoards(workspace, "user", query), {
        query: ListBoardsQuerySchema,
        response: { 200: BoardListSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Boards"],
            operationId: "listBoards",
            summary: "List boards",
            description: "Returns the caller's boards, newest updated first. Active boards only by default; set `includeArchived=true` to include the archive. Use `folderId` to list one folder.",
        },
    })
    .post("/boards", ({ workspace, body, set }) => {
        set.status = 201;
        return createBoard(workspace, "user", body);
    }, {
        body: CreateBoardBodySchema,
        response: { 201: BoardDtoSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Boards"],
            operationId: "createBoard",
            summary: "Create a board",
            description: "Creates an active board at the workspace root or inside an owned folder. A private board is hidden from chat and MCP, but remains visible on this owner surface.",
        },
    })
    .get("/boards/:id", ({ workspace, params }) => getBoard(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: BoardDtoSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Boards"],
            operationId: "getBoard",
            summary: "Read a board",
            description: "Returns board metadata. Use `GET /boards/:id/tasks` for the board's tasks.",
        },
    })
    .patch("/boards/:id", ({ workspace, params, body }) => updateBoard(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateBoardBodySchema,
        response: { 200: BoardDtoSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Boards"],
            operationId: "updateBoard",
            summary: "Update a board",
            description: "Partial update. Archive with `archived: true`; restore with `archived: false`. Send `folderId: \"\"` or `null` to move the board to the workspace root.",
        },
    })
    .delete("/boards/:id", async ({ workspace, params }) => {
        await deleteBoard(workspace, "user", params.id);
        return status(204);
    }, {
        params: IdParamsSchema,
        response: { 404: NotFoundErrorSchema, 409: ConflictErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Boards"],
            operationId: "deleteBoard",
            summary: "Delete an archived board",
            description: "Permanently deletes a board and every task on it. The board must be archived first; deleting an active board returns `409`.",
        },
    })
    // ── Tasks ───────────────────────────────────────────────────────
    .get("/boards/:id/tasks", ({ workspace, params, query }) =>
        listTasks(workspace, "user", params.id, query), {
        params: IdParamsSchema,
        query: ListTasksQuerySchema,
        response: { 200: TaskListSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "listTasks",
            summary: "List tasks on a board",
            description: "Returns a board's tasks ordered by `boardOrder`, then creation time. Use `status` to fetch one column.",
        },
    })
    .post("/boards/:id/tasks", ({ workspace, params, body, set }) => {
        set.status = 201;
        return createTask(workspace, "user", { ...body, boardId: params.id });
    }, {
        params: IdParamsSchema,
        body: CreateTaskBodySchema,
        response: { 201: TaskDtoSchema, 404: NotFoundErrorSchema, 409: ConflictErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "createTask",
            summary: "Create a task",
            description: "Creates a task on the board in the path. The board must belong to the caller and must not be archived.",
        },
    })
    .post("/boards/:id/notes", ({ workspace, params, body, set }) => {
        set.status = 201;
        return addNoteToBoard(workspace, "user", params.id, body.noteId, body.status);
    }, {
        params: IdParamsSchema,
        body: AddNoteToBoardBodySchema,
        response: { 201: TaskDtoSchema, 404: NotFoundErrorSchema, 409: ConflictErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "addNoteToBoard",
            summary: "Add a note to a board",
            description: "Creates a task from a note. Copies the title, a plain-text excerpt (up to 4,000 characters), up to six labels, and the note relation; the note itself is unchanged.",
        },
    })
    .get("/tasks/:id", ({ workspace, params }) => getTask(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: TaskDtoSchema, 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "getTask",
            summary: "Read a task",
            description: "Returns one task, including its board, optional note link, column, priority, labels, and due date.",
        },
    })
    .patch("/tasks/:id", ({ workspace, params, body }) => updateTask(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateTaskBodySchema,
        response: { 200: TaskDtoSchema, 404: NotFoundErrorSchema, 409: ConflictErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "updateTask",
            summary: "Update or move a task",
            description: "Partial update, including column/order moves. Send `boardId` to move the task to another active owned board, and `noteId: \"\"` to clear the note link.",
        },
    })
    .delete("/tasks/:id", async ({ workspace, params }) => {
        await deleteTask(workspace, "user", params.id);
        return status(204);
    }, {
        params: IdParamsSchema,
        response: { 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["Tasks"],
            operationId: "deleteTask",
            summary: "Delete a task",
            description: "Permanently deletes the task. Tasks have no trash flow.",
        },
    })
    // ── API keys ────────────────────────────────────────────────────
    .get("/api-keys", ({ workspace }) => listSessionApiKeys(workspace), {
        response: { 200: ApiKeyListSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["API keys"],
            operationId: "listApiKeys",
            summary: "List API keys",
            description: "Returns metadata for every long-lived key owned by the caller, newest first. Secrets and hashes are never returned. A key cannot call this route; use a signed-in session.",
        },
    })
    .post("/api-keys", ({ workspace, body, set }) => {
        assertSessionKeyManagement(workspace);
        set.status = 201;
        return createApiKeyForUser(workspace.userId, {
            name: body.name,
            access: body.access,
            scope: body.scope,
            folderIds: body.folderIds,
        });
    }, {
        body: CreateApiKeyBodySchema,
        response: { 201: CreatedApiKeySchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["API keys"],
            operationId: "createApiKey",
            summary: "Create an API key",
            description: "Creates a long-lived key for the `/api/v1` workspace API and `/mcp`. The plaintext token is returned exactly once; only a SHA-256 hash is stored. `access` limits reads/writes and `scope` limits the key to the workspace, the root, or selected folder subtrees. Private records stay hidden from MCP regardless of scope.",
        },
    })
    .delete("/api-keys/:id", async ({ workspace, params }) => {
        assertSessionKeyManagement(workspace);
        await revokeApiKeyForUser(workspace.userId, params.id);
        return status(204);
    }, {
        params: IdParamsSchema,
        response: { 404: NotFoundErrorSchema, ...workspaceErrorSchemas },
        detail: {
            tags: ["API keys"],
            operationId: "revokeApiKey",
            summary: "Revoke an API key",
            description: "Permanently deletes the key. Requests using it fail with `401` immediately. A key cannot revoke keys.",
        },
    });

export const apiApp = new Elysia({ name: "nana-api" })
    .onError(handleApiError)
    .use(openapi(apiOpenApiConfig))
    .get(SCALAR_BUNDLE_PATH, () =>
        assetResponse(scalarBundlePath, "application/javascript; charset=utf-8", "public, max-age=31536000, immutable"), {
        detail: { hide: true },
    })
    .get(GEIST_FONT_PATH, () =>
        assetResponse(geistFontPath, "font/woff2", "public, max-age=31536000, immutable"), {
        detail: { hide: true },
    })
    .get(GEIST_MONO_FONT_PATH, () =>
        assetResponse(geistMonoFontPath, "font/woff2", "public, max-age=31536000, immutable"), {
        detail: { hide: true },
    })
    .use(browserApi)
    .use(adminApi)
    .use(v1);

export type ApiApp = typeof apiApp;
