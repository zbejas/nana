import { beforeAll, describe, expect, test } from "bun:test";
import { bunRequest, expectStatus, readJson } from "../helpers/client";
import {
    createAdmin,
    createFolder,
    createNoteWithAttachment,
    createUser,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, BROWSER_API, TEST_PASSWORD, uniqueSuffix } from "../helpers/setup";

/**
 * Public browser facade: /api/v1/auth, /api/v1/records, /api/v1/files,
 * /api/v1/trash, /api/v1/admin, and /api/v1/public. This is the replacement
 * for the deleted /pb proxy, so it keeps PocketBase's record shape while
 * Elysia owns authentication, allowlists, author injection, relation checks,
 * and sanitization.
 */

let user: TestUser;
let other: TestUser;
let admin: TestUser;

const jsonHeaders = (token: string) => authHeaders(token, true);

function api(path: string): string {
    return `${BROWSER_API}${path}`;
}

describe("browser auth facade", () => {
    beforeAll(async () => {
        user = await createUser("browser-user");
        other = await createUser("browser-other");
        admin = await createAdmin("browser-admin");
    });

    test("logs in, refreshes, returns the current user, and lists auth methods", async () => {
        const login = await bunRequest(api("/auth/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: user.email, password: TEST_PASSWORD }),
        });
        await expectStatus(login, 200, "browser login");
        const session = await readJson<{ token: string; record: { id: string } }>(login);
        expect(session.token.length).toBeGreaterThan(10);
        expect(session.record.id).toBe(user.id);

        const refresh = await bunRequest(api("/auth/refresh"), {
            method: "POST",
            headers: authHeaders(session.token),
        });
        await expectStatus(refresh, 200, "browser refresh");

        const me = await bunRequest(api("/me"), { headers: authHeaders(session.token) });
        await expectStatus(me, 200, "browser me");
        expect((await readJson<{ id: string }>(me)).id).toBe(user.id);

        const methods = await bunRequest(api("/auth/methods"));
        await expectStatus(methods, 200, "browser auth methods");
        const methodsBody = await readJson<{ password?: { enabled?: boolean } }>(methods);
        expect(methodsBody.password?.enabled).toBe(true);
    });

    test("rejects bad credentials and a missing token", async () => {
        const bad = await bunRequest(api("/auth/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: user.email, password: "not-the-password" }),
        });
        await expectStatus(bad, 400, "bad login");

        const noToken = await bunRequest(api("/me"));
        await expectStatus(noToken, 401, "missing token");
    });
});

describe("browser record facade", () => {
    test("injects the caller as author and sanitizes note content", async () => {
        const res = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Browser note ${uniqueSuffix()}`,
                slug: `browser-note-${uniqueSuffix()}`,
                content: "<script>alert(1)</script><p>Safe body</p>",
                author: other.id,
                word_count: 999,
            }),
        });
        await expectStatus(res, 200, "browser create note");
        const note = await readJson<{ id: string; author: string; content: string; word_count: number }>(res);

        expect(note.author).toBe(user.id);
        expect(note.content).not.toContain("<script");
        expect(note.content).toContain("Safe body");
        expect(note.word_count).not.toBe(999);
    });

    test("rejects a folder owned by another user", async () => {
        const foreignFolder = await createFolder(other, { name: `Foreign ${uniqueSuffix()}` });

        const res = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Foreign folder note ${uniqueSuffix()}`,
                slug: `foreign-folder-${uniqueSuffix()}`,
                folder: foreignFolder.id,
            }),
        });
        await expectStatus(res, 404, "foreign folder rejected");
    });

    test("runs the board and task relation checks", async () => {
        const folder = await createFolder(user, { name: `Browser folder ${uniqueSuffix()}` });
        const foreignFolder = await createFolder(other, { name: `Foreign folder ${uniqueSuffix()}` });

        const boardRes = await bunRequest(api("/records/boards"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                name: `Browser board ${uniqueSuffix()}`,
                author: other.id,
                folder: folder.id,
            }),
        });
        await expectStatus(boardRes, 200, "browser create board");
        const board = await readJson<{ id: string; author: string; folder: string }>(boardRes);
        expect(board.author).toBe(user.id);
        expect(board.folder).toBe(folder.id);

        const foreignBoard = await bunRequest(api("/records/boards"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ name: "Nope", folder: foreignFolder.id }),
        });
        await expectStatus(foreignBoard, 404, "foreign board folder rejected");

        const taskRes = await bunRequest(api("/records/tasks"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Browser task ${uniqueSuffix()}`,
                status: "next",
                board: board.id,
            }),
        });
        await expectStatus(taskRes, 200, "browser create task");
        const task = await readJson<{ id: string; board: string }>(taskRes);
        expect(task.board).toBe(board.id);

        const foreignTask = await bunRequest(api("/records/tasks"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ title: "Nope", status: "next", board: "missingboard123" }),
        });
        await expectStatus(foreignTask, 404, "missing board rejected");
    });

    test("supports workflow columns, task fields, and read-only relations", async () => {
        const suffix = uniqueSuffix();
        const boardRes = await bunRequest(api("/records/boards"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ name: `Facade kanban ${suffix}` }),
        });
        await expectStatus(boardRes, 200, "create facade board");
        const board = await readJson<{ id: string }>(boardRes);

        const columnRes = await bunRequest(api("/records/board_columns"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ board: board.id, name: "In review", color: "warning" }),
        });
        await expectStatus(columnRes, 200, "create facade column");
        const column = await readJson<{ id: string; slug: string; board: string }>(columnRes);
        expect(column.board).toBe(board.id);
        expect(column.slug).toBe("in-review");

        const columnsRes = await bunRequest(
            api(`/records/board_columns?filter=${encodeURIComponent(`board="${board.id}"`)}&sort=position`),
            { headers: authHeaders(user.token) },
        );
        await expectStatus(columnsRes, 200, "list facade columns");
        const columns = await readJson<{ items: Array<{ slug: string }> }>(columnsRes);
        expect(columns.items.map((item) => item.slug)).toContain("in-review");

        const taskRes = await bunRequest(api("/records/tasks"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Facade kanban task ${suffix}`,
                description: "<script>alert(1)</script><p>Safe task body</p>",
                board: board.id,
                status: "in-review",
                assignee: user.id,
                start_date: "2026-11-01 09:00:00.000Z",
                recurrence: { frequency: "weekly", interval: 1 },
                task_number: 999,
                completed_at: "2026-01-01 00:00:00.000Z",
            }),
        });
        await expectStatus(taskRes, 200, "create facade task");
        const task = await readJson<{
            id: string;
            status: string;
            description: string;
            assignee: string;
            start_date: string;
            recurrence: { frequency: string };
            task_number: number;
            completed_at: string;
        }>(taskRes);
        expect(task.status).toBe("in-review");
        expect(task.description).not.toContain("<script");
        expect(task.description).toContain("Safe task body");
        expect(task.assignee).toBe(user.id);
        expect(task.start_date).toContain("2026-11-01");
        expect(task.recurrence.frequency).toBe("weekly");
        expect(task.task_number).not.toBe(999);
        expect(task.task_number).toBeGreaterThan(0);
        expect(task.completed_at).toBe("");

        const invalidStatus = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ status: "no-such-column" }),
        });
        await expectStatus(invalidStatus, 400, "facade rejects unknown status");

        const ignoredServerFields = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ task_number: 500, completed_at: "2026-02-01 00:00:00.000Z" }),
        });
        await expectStatus(ignoredServerFields, 200, "facade ignores server fields");
        const unchanged = await readJson<{ task_number: number; completed_at: string }>(ignoredServerFields);
        expect(unchanged.task_number).toBe(task.task_number);
        expect(unchanged.completed_at).toBe("");

        const foreignAssignee = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ assignee: other.id }),
        });
        await expectStatus(foreignAssignee, 400, "facade rejects a foreign assignee");

        const labelsRes = await bunRequest(api("/records/labels"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ name: `label-${suffix}`, color: "rose", author: other.id }),
        });
        await expectStatus(labelsRes, 200, "create facade label");
        const label = await readJson<{ author: string }>(labelsRes);
        expect(label.author).toBe(user.id);

        const activityRes = await bunRequest(
            api(`/records/task_activity?filter=${encodeURIComponent(`task="${task.id}"`)}`),
            { headers: authHeaders(user.token) },
        );
        await expectStatus(activityRes, 200, "read facade activity");
        const activity = await readJson<{ items: Array<{ type: string }> }>(activityRes);
        expect(activity.items.map((item) => item.type)).toContain("created");

        const relationsRead = await bunRequest(
            api(`/records/task_relations?filter=${encodeURIComponent(`source="${task.id}"`)}`),
            { headers: authHeaders(user.token) },
        );
        await expectStatus(relationsRead, 200, "read facade relations");

        const relationsWrite = await bunRequest(api("/records/task_relations"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ source: task.id, target: task.id, type: "related" }),
        });
        await expectStatus(relationsWrite, 405, "facade relations are read-only");

        const commentsRead = await bunRequest(api("/records/comments"), {
            headers: authHeaders(user.token),
        });
        await expectStatus(commentsRead, 404, "comments are not on the record facade");
    });

    test("does not let a user promote themselves through the users collection", async () => {
        const res = await bunRequest(api(`/records/users/${user.id}`), {
            method: "PATCH",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ name: "Renamed", admin: true }),
        });
        await expectStatus(res, 200, "self update");
        const record = await readJson<{ admin?: boolean; name: string }>(res);
        expect(record.admin).not.toBe(true);
        expect(record.name).toBe("Renamed");
    });

    test("moves a note to trash and restores it", async () => {
        const noteRes = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Trash browser note ${uniqueSuffix()}`,
                slug: `trash-browser-${uniqueSuffix()}`,
            }),
        });
        await expectStatus(noteRes, 200, "create trash note");
        const note = await readJson<{ id: string }>(noteRes);

        const trash = await bunRequest(api("/trash/move-document"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ documentId: note.id }),
        });
        await expectStatus(trash, 200, "move to trash");
        const trashBody = await readJson<{ trashDocumentId: string }>(trash);

        const restore = await bunRequest(api("/trash/restore-document"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ trashDocumentId: trashBody.trashDocumentId }),
        });
        await expectStatus(restore, 200, "restore from trash");
        const restored = await readJson<{ documentId: string }>(restore);
        expect(restored.documentId).toBeTruthy();
        // The trash route may reuse the original document or create a new one
        // when the original id is no longer present; both are valid restores.
        const readRestored = await bunRequest(api(`/records/documents/${restored.documentId}`), {
            headers: authHeaders(user.token),
        });
        await expectStatus(readRestored, 200, "read restored note");
    });

    test("accepts multipart note uploads through the facade", async () => {
        const form = new FormData();
        form.set("title", `Multipart browser note ${uniqueSuffix()}`);
        form.set("slug", `multipart-browser-${uniqueSuffix()}`);
        form.set("content", "# Uploaded\n\nMultipart through Elysia.");
        form.set("attachments", new File(
            [new TextEncoder().encode("multipart bytes")],
            `multipart-${uniqueSuffix()}.txt`,
            { type: "text/plain" },
        ));

        const res = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: authHeaders(user.token),
            body: form,
        });
        await expectStatus(res, 200, "multipart create document");
        const note = await readJson<{ id: string; author: string; attachments: string[] }>(res);
        expect(note.author).toBe(user.id);
        expect(note.attachments).toHaveLength(1);

        const tokenRes = await bunRequest(api("/files/token"), {
            method: "POST",
            headers: authHeaders(user.token),
        });
        await expectStatus(tokenRes, 200, "multipart file token");
        const tokenBody = await readJson<{ token: string }>(tokenRes);

        const fileRes = await bunRequest(
            api(`/files/documents/${note.id}/${encodeURIComponent(note.attachments[0]!)}?token=${encodeURIComponent(tokenBody.token)}`),
        );
        await expectStatus(fileRes, 200, "multipart file bytes");
        expect(await fileRes.text()).toBe("multipart bytes");
    });

    test("relays the realtime handshake", async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        try {
            const res = await bunRequest(api("/realtime"), { signal: controller.signal });
            await expectStatus(res, 200, "realtime handshake");
            expect(res.headers.get("Content-Type")).toContain("text/event-stream");

            const reader = res.body?.getReader();
            expect(reader).toBeTruthy();
            const chunk = await reader!.read();
            const text = new TextDecoder().decode(chunk.value);
            expect(text).toContain("PB_CONNECT");
            await reader!.cancel();
        } finally {
            clearTimeout(timer);
            controller.abort();
        }
    });

    test("serves protected files through the facade", async () => {
        const note = await createNoteWithAttachment(
            user,
            `browser-${uniqueSuffix()}.txt`,
            new TextEncoder().encode("attachment through Elysia"),
        );

        const tokenRes = await bunRequest(api("/files/token"), {
            method: "POST",
            headers: authHeaders(user.token),
        });
        await expectStatus(tokenRes, 200, "file token");
        const tokenBody = await readJson<{ token: string }>(tokenRes);
        expect(tokenBody.token.length).toBeGreaterThan(10);

        const collectionName = (note as { collectionName?: string }).collectionName;
        const filename = (note.attachments as string[] | undefined)?.[0];
        expect(collectionName).toBe("documents");
        expect(filename).toBeTruthy();

        const fileRes = await bunRequest(
            api(`/files/${collectionName}/${note.id}/${encodeURIComponent(filename!)}?token=${encodeURIComponent(tokenBody.token)}`),
        );
        await expectStatus(fileRes, 200, "file bytes");
        expect(await fileRes.text()).toBe("attachment through Elysia");
    });
});

describe("browser admin and public facade", () => {
    test("protects admin routes and settings records", async () => {
        const userSettings = await bunRequest(api("/records/settings"), {
            headers: authHeaders(user.token),
        });
        await expectStatus(userSettings, 403, "non-admin settings");

        const adminSettings = await bunRequest(api("/records/settings"), {
            headers: authHeaders(admin.token),
        });
        await expectStatus(adminSettings, 200, "admin settings");

        const userAdminRoute = await bunRequest(api("/admin/attachments"), {
            headers: authHeaders(user.token),
        });
        await expectStatus(userAdminRoute, 403, "non-admin admin route");

        const adminRoute = await bunRequest(api("/admin/attachments"), {
            headers: authHeaders(admin.token),
        });
        await expectStatus(adminRoute, 200, "admin route");
    });

    test("serves a public document share and rejects a private one", async () => {
        const token = `share-${uniqueSuffix()}`;
        const createRes = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Public browser note ${uniqueSuffix()}`,
                slug: `public-browser-${uniqueSuffix()}`,
                content: "Public body",
                is_public: true,
                public_share_token: token,
            }),
        });
        await expectStatus(createRes, 200, "create public note");

        const publicRes = await bunRequest(api(`/public/documents/${encodeURIComponent(token)}`));
        await expectStatus(publicRes, 200, "public document");
        const payload = await readJson<{ type: string; document: { content: string } }>(publicRes);
        expect(payload.type).toBe("document");
        expect(payload.document.content).toContain("Public body");

        const privateToken = `private-${uniqueSuffix()}`;
        const privateRes = await bunRequest(api("/records/documents"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({
                title: `Private browser note ${uniqueSuffix()}`,
                slug: `private-browser-${uniqueSuffix()}`,
                is_private: true,
                is_public: true,
                public_share_token: privateToken,
            }),
        });
        await expectStatus(privateRes, 200, "create private note");

        const hidden = await bunRequest(api(`/public/documents/${encodeURIComponent(privateToken)}`));
        await expectStatus(hidden, 404, "private public share");
    });
});
