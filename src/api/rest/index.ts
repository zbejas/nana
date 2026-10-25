import { openapi } from "@elysia/openapi";
import { Elysia, status } from "elysia";
import type { ErrorHandler } from "elysia";
import { existsSync } from "fs";
import { resolve } from "path";
import { createLogger } from "../../lib/logger";
import { APP_VERSION } from "../app-version";
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
import { ApiError } from "../workspace/errors";
import { authenticateApiRequest, AuthError } from "./auth";
import {
    AddNoteToBoardBodySchema,
    BoardDtoSchema,
    BoardListSchema,
    CreateBoardBodySchema,
    CreateFolderBodySchema,
    CreateNoteBodySchema,
    CreateTaskBodySchema,
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

const log = createLogger("REST");

const swaggerDistDir = resolve(import.meta.dir, "../../../node_modules/swagger-ui-dist");
const swaggerBundlePath = resolve(swaggerDistDir, "swagger-ui-bundle.js");
const swaggerStylesPath = resolve(swaggerDistDir, "swagger-ui.css");

const API_DESCRIPTION = [
    "JSON API for Nana notes, folders, boards, and tasks.",
    "Every /api/v1 route requires a PocketBase user token, sent either raw or as `Bearer <token>`.",
    "This surface is the owning user's surface: private notes and boards are visible to their owner.",
].join(" ");

function assetResponse(path: string, contentType: string): Response {
    if (!existsSync(path)) {
        return new Response("Not Found", { status: 404 });
    }
    return new Response(Bun.file(path), {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
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

const v1 = new Elysia({ prefix: "/api/v1", name: "api-v1" })
    .onError(handleApiError)
    .derive({ as: "scoped" }, async ({ request }) => {
        const auth = await authenticateApiRequest(request);
        const workspace: ToolContext = {
            authHeader: auth.authHeader,
            userId: auth.userId,
        };
        return { auth, workspace };
    })
    // ── Folders ─────────────────────────────────────────────────────
    .get("/folders", ({ workspace }) => listFolders(workspace), {
        response: { 200: FolderListSchema },
        detail: {
            tags: ["Folders"],
            summary: "List folders",
            description: "Returns the caller's folders. AI surfaces hide private subtrees; this REST surface is the owner's.",
        },
    })
    .post("/folders", ({ workspace, body, set }) => {
        set.status = 201;
        return createFolder(workspace, "user", body);
    }, {
        body: CreateFolderBodySchema,
        response: { 201: FolderDtoSchema },
        detail: {
            tags: ["Folders"],
            summary: "Create a folder",
            description: "Optionally nests the folder under an owned parent.",
        },
    })
    // ── Notes ───────────────────────────────────────────────────────
    .get("/notes", ({ workspace, query }) => listNotes(workspace, "user", query), {
        query: ListNotesQuerySchema,
        response: { 200: NoteListSchema },
        detail: {
            tags: ["Notes"],
            summary: "List notes",
            description: "Metadata only: note content is never returned by the list endpoint. Searches titles and tags.",
        },
    })
    .post("/notes", ({ workspace, body, set }) => {
        set.status = 201;
        return createNote(workspace, "user", body);
    }, {
        body: CreateNoteBodySchema,
        response: { 201: NoteDtoSchema },
        detail: {
            tags: ["Notes"],
            summary: "Create a note",
            description: "Content is sanitized before it is stored. Titles default to Untitled.",
        },
    })
    .get("/notes/:id", ({ workspace, params }) => getNote(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: NoteDtoSchema },
        detail: {
            tags: ["Notes"],
            summary: "Read a note",
            description: "Returns the full note including sanitized content.",
        },
    })
    .patch("/notes/:id", ({ workspace, params, body }) => updateNote(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateNoteBodySchema,
        response: { 200: NoteDtoSchema },
        detail: {
            tags: ["Notes"],
            summary: "Update a note",
            description: "Send `folderId: \"\"` or `null` to move the note to the root. Attachments are not managed here.",
        },
    })
    .delete("/notes/:id", ({ workspace, params }) => deleteNote(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: DeleteNoteResultSchema },
        detail: {
            tags: ["Notes"],
            summary: "Move a note to trash",
            description: "Delegates to the PocketBase trash route and returns the trash record id.",
        },
    })
    // ── Boards ──────────────────────────────────────────────────────
    .get("/boards", ({ workspace, query }) => listBoards(workspace, "user", query), {
        query: ListBoardsQuerySchema,
        response: { 200: BoardListSchema },
        detail: {
            tags: ["Boards"],
            summary: "List boards",
            description: "Active boards by default, newest updated first.",
        },
    })
    .post("/boards", ({ workspace, body, set }) => {
        set.status = 201;
        return createBoard(workspace, "user", body);
    }, {
        body: CreateBoardBodySchema,
        response: { 201: BoardDtoSchema },
        detail: {
            tags: ["Boards"],
            summary: "Create a board",
        },
    })
    .get("/boards/:id", ({ workspace, params }) => getBoard(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: BoardDtoSchema },
        detail: {
            tags: ["Boards"],
            summary: "Read a board",
        },
    })
    .patch("/boards/:id", ({ workspace, params, body }) => updateBoard(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateBoardBodySchema,
        response: { 200: BoardDtoSchema },
        detail: {
            tags: ["Boards"],
            summary: "Update a board",
            description: "Archive with `archived: true`. Send `folderId: \"\"` or `null` to move the board to the root.",
        },
    })
    .delete("/boards/:id", async ({ workspace, params }) => {
        await deleteBoard(workspace, "user", params.id);
        return status(204);
    }, {
        params: IdParamsSchema,
        detail: {
            tags: ["Boards"],
            summary: "Delete an archived board",
            description: "Only archived boards may be deleted. PocketBase cascades their tasks.",
            responses: {
                204: { description: "Board and its tasks deleted." },
            },
        },
    })
    // ── Tasks ───────────────────────────────────────────────────────
    .get("/boards/:id/tasks", ({ workspace, params, query }) =>
        listTasks(workspace, "user", params.id, query), {
        params: IdParamsSchema,
        query: ListTasksQuerySchema,
        response: { 200: TaskListSchema },
        detail: {
            tags: ["Tasks"],
            summary: "List tasks on a board",
            description: "Ordered by board order then creation time.",
        },
    })
    .post("/boards/:id/tasks", ({ workspace, params, body, set }) => {
        set.status = 201;
        return createTask(workspace, "user", { ...body, boardId: params.id });
    }, {
        params: IdParamsSchema,
        body: CreateTaskBodySchema,
        response: { 201: TaskDtoSchema },
        detail: {
            tags: ["Tasks"],
            summary: "Create a task",
            description: "The board must belong to the caller and must not be archived.",
        },
    })
    .post("/boards/:id/notes", ({ workspace, params, body, set }) => {
        set.status = 201;
        return addNoteToBoard(workspace, "user", params.id, body.noteId, body.status);
    }, {
        params: IdParamsSchema,
        body: AddNoteToBoardBodySchema,
        response: { 201: TaskDtoSchema },
        detail: {
            tags: ["Tasks"],
            summary: "Add a note to a board",
            description: "Copies the note title, a plain-text excerpt, and up to six labels into a new task.",
        },
    })
    .get("/tasks/:id", ({ workspace, params }) => getTask(workspace, "user", params.id), {
        params: IdParamsSchema,
        response: { 200: TaskDtoSchema },
        detail: {
            tags: ["Tasks"],
            summary: "Read a task",
        },
    })
    .patch("/tasks/:id", ({ workspace, params, body }) => updateTask(workspace, "user", params.id, body), {
        params: IdParamsSchema,
        body: UpdateTaskBodySchema,
        response: { 200: TaskDtoSchema },
        detail: {
            tags: ["Tasks"],
            summary: "Update or move a task",
            description: "Send `boardId`, `status`, and/or `boardOrder` to move. Send `noteId: \"\"` to clear the note link.",
        },
    })
    .delete("/tasks/:id", async ({ workspace, params }) => {
        await deleteTask(workspace, "user", params.id);
        return status(204);
    }, {
        params: IdParamsSchema,
        detail: {
            tags: ["Tasks"],
            summary: "Delete a task",
            description: "Tasks are permanently deleted; they have no trash flow.",
            responses: {
                204: { description: "Task deleted." },
            },
        },
    });

export const apiApp = new Elysia({ name: "nana-api" })
    .onError(handleApiError)
    .use(openapi({
        path: "/docs",
        specPath: "/docs/json",
        provider: "swagger-ui",
        documentation: {
            info: {
                title: "Nana API",
                version: APP_VERSION,
                description: API_DESCRIPTION,
            },
            tags: [
                { name: "Folders", description: "Folder tree and privacy metadata." },
                { name: "Notes", description: "Markdown notes and metadata." },
                { name: "Boards", description: "Author-scoped task boards." },
                { name: "Tasks", description: "Tasks grouped by board and column." },
            ],
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "PocketBase user token",
                    },
                },
            },
            security: [{ bearerAuth: [] }],
        },
        swagger: {
            cdn: "/docs/swagger-ui-bundle.js",
            theme: "/docs/swagger-ui.css",
            persistAuthorization: true,
        },
        exclude: {
            paths: ["/docs/swagger-ui-bundle.js", "/docs/swagger-ui.css"],
        },
    }))
    .get("/docs/swagger-ui-bundle.js", () =>
        assetResponse(swaggerBundlePath, "application/javascript; charset=utf-8"), {
        detail: { hide: true },
    })
    .get("/docs/swagger-ui.css", () =>
        assetResponse(swaggerStylesPath, "text/css; charset=utf-8"), {
        detail: { hide: true },
    })
    .use(v1);

export type ApiApp = typeof apiApp;
