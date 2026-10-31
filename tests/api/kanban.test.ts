import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    patchJson,
    pbCreate,
    pbList,
    pbRequest,
    postJson,
    readJson,
} from "../helpers/client";
import {
    createAdmin,
    createUser,
    getSuperuserToken,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, uniqueSuffix } from "../helpers/setup";

/**
 * Typed workspace kanban contract: dynamic columns, new task fields, relations,
 * and activity. The browser facade and chat/MCP read tools reuse the same
 * columns and status guards.
 */

const API = "/api/v1";

interface BoardDto {
    id: string;
    name: string;
    icon: string;
    taskCounter: number;
}

interface BoardColumnDto {
    id: string;
    boardId: string;
    name: string;
    slug: string;
    position: number;
    icon: string;
    color: string;
    isFinal: boolean;
}

interface TaskDto {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    startDate: string | null;
    completedAt: string | null;
    assigneeId: string | null;
    recurrence: { frequency: string; interval: number; weekdays?: number[] } | null;
    taskNumber: number | null;
    boardId: string;
    labels: string[];
    noteId: string | null;
}

interface TaskRelationDto {
    id: string;
    sourceTaskId: string;
    targetTaskId: string;
    type: string;
    targetTitle: string | null;
    targetStatus: string | null;
}

interface TaskActivityDto {
    id: string;
    taskId: string;
    type: string;
    data: Record<string, unknown>;
}

interface ListResult<T> {
    items: T[];
}

let owner: TestUser;
let other: TestUser;

function get(path: string): Promise<Response> {
    return bunRequest(`${API}${path}`, { headers: authHeaders(owner.token) });
}

function post(path: string, body: unknown): Promise<Response> {
    return postJson(`${API}${path}`, body, authHeaders(owner.token, true));
}

function patch(path: string, body: unknown): Promise<Response> {
    return patchJson(`${API}${path}`, body, authHeaders(owner.token, true));
}

function remove(path: string): Promise<Response> {
    return bunRequest(`${API}${path}`, {
        method: "DELETE",
        headers: authHeaders(owner.token),
    });
}

async function createBoard(name: string): Promise<BoardDto> {
    const res = await post("/boards", { name });
    await expectStatus(res, 201, `create ${name}`);
    return readJson<BoardDto>(res, `create ${name}`);
}

async function createTask(boardId: string, body: Record<string, unknown>): Promise<TaskDto> {
    const res = await post(`/boards/${boardId}/tasks`, body);
    await expectStatus(res, 201, `create task ${String(body.title ?? "")}`);
    return readJson<TaskDto>(res, "create task");
}

beforeAll(async () => {
    owner = await createUser("kanban-owner");
    other = await createUser("kanban-other");
});

describe("board workflow columns", () => {
    test("seeds defaults, supports CRUD/reorder, and protects statuses", async () => {
        const suffix = uniqueSuffix();
        const board = await createBoard(`Kanban Board ${suffix}`);
        expect(board.taskCounter).toBe(0);

        const columnsRes = await get(`/boards/${board.id}/columns`);
        await expectStatus(columnsRes, 200, "list columns");
        const columns = await readJson<BoardColumnDto[]>(columnsRes, "list columns");
        expect(columns.map((column) => column.slug)).toEqual(["backlog", "next", "progress", "done"]);
        expect(columns.find((column) => column.slug === "done")?.isFinal).toBe(true);

        const reviewRes = await post(`/boards/${board.id}/columns`, {
            name: "In review",
            icon: "eye",
            color: "warning",
        });
        await expectStatus(reviewRes, 201, "create review column");
        const review = await readJson<BoardColumnDto>(reviewRes, "create review column");
        expect(review).toMatchObject({
            boardId: board.id,
            name: "In review",
            slug: "in-review",
            icon: "eye",
            color: "warning",
            isFinal: false,
        });
        expect(review.position).toBe(4);

        const finalRes = await patch(`/board-columns/${review.id}`, { name: "Reviewing" });
        await expectStatus(finalRes, 200, "rename column");
        expect((await readJson<BoardColumnDto>(finalRes, "rename column")).name).toBe("Reviewing");

        const reservedRes = await post(`/boards/${board.id}/columns`, {
            name: "Planned",
            slug: "planned",
        });
        await expectJsonError(reservedRes, 400, "reserved");

        const reorderRes = await post(`/boards/${board.id}/columns/reorder`, {
            orderedIds: [review.id, ...columns.map((column) => column.id)],
        });
        await expectStatus(reorderRes, 200, "reorder columns");
        const reordered = await readJson<BoardColumnDto[]>(reorderRes, "reorder columns");
        expect(reordered.map((column) => column.slug)).toEqual([
            "in-review",
            "backlog",
            "next",
            "progress",
            "done",
        ]);
        expect(reordered.map((column) => column.position)).toEqual([0, 1, 2, 3, 4]);

        const task = await createTask(board.id, {
            title: `Review task ${suffix}`,
            status: "in-review",
            assigneeId: owner.id,
            startDate: "2026-11-01 09:00:00.000Z",
            dueDate: "2026-11-05 17:00:00.000Z",
            priority: "high",
            labels: ["kanban"],
            recurrence: { frequency: "weekly", interval: 1, weekdays: [1, 3] },
        });

        expect(task.status).toBe("in-review");
        expect(task.assigneeId).toBe(owner.id);
        expect(task.startDate).toBe("2026-11-01 09:00:00.000Z");
        expect(task.recurrence).toEqual({
            frequency: "weekly",
            interval: 1,
            weekdays: [1, 3],
        });
        expect(task.taskNumber).toBe(1);
        expect(task.completedAt).toBeNull();

        const readRes = await get(`/tasks/${task.id}`);
        await expectStatus(readRes, 200, "read task");
        const read = await readJson<TaskDto>(readRes, "read task");
        expect(read).toMatchObject({
            status: "in-review",
            assigneeId: owner.id,
            taskNumber: 1,
        });
        expect(read.startDate).toBe("2026-11-01 09:00:00.000Z");

        const doneRes = await patch(`/tasks/${task.id}`, { status: "done" });
        await expectStatus(doneRes, 200, "complete task");
        expect((await readJson<TaskDto>(doneRes, "complete task")).completedAt).not.toBeNull();

        const listRes = await get(`/boards/${board.id}/tasks?status=done`);
        await expectStatus(listRes, 200, "list column tasks");
        const listed = await readJson<ListResult<TaskDto>>(listRes, "list column tasks");
        expect(listed.items.map((item) => item.id)).toContain(task.id);

        expect((await patch(`/tasks/${task.id}`, { status: "planned" })).status).toBe(200);
        const planned = await readJson<TaskDto>(
            await get(`/tasks/${task.id}`),
            "read planned task",
        );
        expect(planned.status).toBe("planned");
        expect(planned.completedAt).toBeNull();

        const invalidStatus = await patch(`/tasks/${task.id}`, { status: "no-such-column" });
        await expectJsonError(invalidStatus, 400, "task status");

        const missingStatus = await post(`/boards/${board.id}/tasks`, {
            title: `Missing status ${suffix}`,
            status: "no-such-column",
        });
        await expectJsonError(missingStatus, 400, "task status");

        const foreignAssignee = await post(`/boards/${board.id}/tasks`, {
            title: `Foreign assignee ${suffix}`,
            status: "backlog",
            assigneeId: other.id,
        });
        await expectJsonError(foreignAssignee, 400, "not valid");

        const defaultTask = await createTask(board.id, { title: `Default column ${suffix}` });
        expect(defaultTask.status).toBe("in-review");

        // The moved task still references nothing in review, but the default
        // task does, so the column is protected until it moves away.
        const guardedDelete = await remove(`/board-columns/${review.id}`);
        await expectJsonError(guardedDelete, 400, "not valid");

        const slugChange = await patch(`/board-columns/${review.id}`, { slug: "review" });
        await expectJsonError(slugChange, 400, "not valid");

        const moveDefault = await patch(`/tasks/${defaultTask.id}`, { status: "backlog" });
        await expectStatus(moveDefault, 200, "move default task out of review");

        const deleteRes = await remove(`/board-columns/${review.id}`);
        await expectStatus(deleteRes, 204, "delete empty review column");

        const afterDelete = await get(`/boards/${board.id}/columns`);
        const remaining = await readJson<BoardColumnDto[]>(afterDelete, "columns after delete");
        expect(remaining.map((column) => column.slug)).not.toContain("in-review");
    });

    test("rejects a column order that omits a column or duplicates one", async () => {
        const board = await createBoard(`Reorder guard ${uniqueSuffix()}`);
        const columnsRes = await get(`/boards/${board.id}/columns`);
        const columns = await readJson<BoardColumnDto[]>(columnsRes, "columns");

        const omitted = await post(`/boards/${board.id}/columns/reorder`, {
            orderedIds: columns.slice(1).map((column) => column.id),
        });
        await expectJsonError(omitted, 400, "column order");

        const duplicate = await post(`/boards/${board.id}/columns/reorder`, {
            orderedIds: [columns[0]!.id, ...columns.map((column) => column.id)],
        });
        await expectJsonError(duplicate, 400, "column order");
    });
});

describe("task relations and activity", () => {
    test("creates, reads, and deletes directed relations", async () => {
        const suffix = uniqueSuffix();
        const board = await createBoard(`Relations ${suffix}`);
        const parent = await createTask(board.id, {
            title: `Parent ${suffix}`,
            status: "backlog",
        });
        const child = await createTask(board.id, {
            title: `Child ${suffix}`,
            status: "next",
        });

        const createRes = await post(`/tasks/${parent.id}/relations`, {
            targetTaskId: child.id,
            type: "subtask",
        });
        await expectStatus(createRes, 201, "create relation");
        const relation = await readJson<TaskRelationDto>(createRes, "create relation");
        expect(relation).toMatchObject({
            sourceTaskId: parent.id,
            targetTaskId: child.id,
            type: "subtask",
        });

        const parentRelationsRes = await get(`/tasks/${parent.id}/relations`);
        await expectStatus(parentRelationsRes, 200, "parent relations");
        const parentRelations = await readJson<TaskRelationDto[]>(parentRelationsRes, "parent relations");
        expect(parentRelations.map((item) => item.id)).toContain(relation.id);
        expect(parentRelations[0]?.targetTitle).toBe(`Child ${suffix}`);
        expect(parentRelations[0]?.targetStatus).toBe("next");

        const childRelationsRes = await get(`/tasks/${child.id}/relations`);
        const childRelations = await readJson<TaskRelationDto[]>(childRelationsRes, "child relations");
        expect(childRelations.map((item) => item.id)).toContain(relation.id);

        const selfRelation = await post(`/tasks/${parent.id}/relations`, {
            targetTaskId: parent.id,
            type: "related",
        });
        await expectJsonError(selfRelation, 400, "cannot relate to itself");

        const deleteRes = await remove(`/task-relations/${relation.id}`);
        await expectStatus(deleteRes, 204, "delete relation");

        const emptyRes = await get(`/tasks/${parent.id}/relations`);
        const empty = await readJson<TaskRelationDto[]>(emptyRes, "relations after delete");
        expect(empty).toEqual([]);
    });

    test("records create and update activity newest first", async () => {
        const suffix = uniqueSuffix();
        const board = await createBoard(`Activity ${suffix}`);
        const task = await createTask(board.id, {
            title: `Activity task ${suffix}`,
            status: "backlog",
        });

        const patchRes = await patch(`/tasks/${task.id}`, { status: "next", priority: "urgent" });
        await expectStatus(patchRes, 200, "update activity task");

        const activityRes = await get(`/tasks/${task.id}/activity`);
        await expectStatus(activityRes, 200, "list activity");
        const activity = await readJson<TaskActivityDto[]>(activityRes, "list activity");
        const types = activity.map((entry) => entry.type);
        expect(types).toContain("created");
        expect(types).toContain("status_changed");
        expect(types).toContain("priority_changed");
        expect(activity[0]).toHaveProperty("created");
        expect(activity.every((entry) => entry.taskId === task.id)).toBe(true);

        const statusEntry = activity.find((entry) => entry.type === "status_changed");
        expect(statusEntry?.data).toMatchObject({ from: "backlog", to: "next" });

        const commentRes = await bunRequest(`${API}/sharing/comments`, {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({
                targetType: "task",
                targetId: task.id,
                body: "First task comment",
            }),
        });
        await expectStatus(commentRes, 200, "comment on a task");
        const comment = await readJson<{ id: string; targetId: string; body: string }>(
            commentRes,
            "comment on a task",
        );
        expect(comment.targetId).toBe(task.id);
        expect(comment.body).toBe("First task comment");

        const commentsRes = await bunRequest(
            `${API}/sharing/comments?targetType=task&targetId=${encodeURIComponent(task.id)}`,
            { headers: authHeaders(owner.token) },
        );
        await expectStatus(commentsRes, 200, "list task comments");
        const comments = await readJson<{ items: Array<{ id: string }>; canComment: boolean }>(
            commentsRes,
            "list task comments",
        );
        expect(comments.items.map((item) => item.id)).toContain(comment.id);
        expect(comments.canComment).toBe(true);

        const editCommentRes = await bunRequest(`${API}/sharing/comments/${comment.id}`, {
            method: "PATCH",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({ body: "Edited task comment" }),
        });
        await expectStatus(editCommentRes, 200, "edit task comment");
        expect((await readJson<{ body: string }>(editCommentRes, "edit task comment")).body)
            .toBe("Edited task comment");

        const deleteCommentRes = await bunRequest(`${API}/sharing/comments/${comment.id}`, {
            method: "DELETE",
            headers: authHeaders(owner.token),
        });
        await expectStatus(deleteCommentRes, 200, "delete task comment");
    });

    test("allocates numbers after validation and atomically under concurrency", async () => {
        const board = await createBoard(`Numbering ${uniqueSuffix()}`);

        const rejected = await post(`/boards/${board.id}/tasks`, {
            title: "Invalid status",
            status: "no-such-column",
        });
        await expectJsonError(rejected, 400, "task status");

        const rejectedAssignee = await post(`/boards/${board.id}/tasks`, {
            title: "Invalid assignee",
            status: "backlog",
            assigneeId: other.id,
        });
        await expectJsonError(rejectedAssignee, 400);

        const afterFailure = await readJson<BoardDto>(
            await get(`/boards/${board.id}`),
            "board after rejected create",
        );
        expect(afterFailure.taskCounter).toBe(0);

        const attempts = Array.from({ length: 10 }, (_, index) =>
            post(`/boards/${board.id}/tasks`, {
                title: `Concurrent ${index}`,
                status: "backlog",
            }),
        );
        const responses = await Promise.all(attempts);
        for (const res of responses) await expectStatus(res, 201, "concurrent create");
        const tasks = await Promise.all(responses.map((res) => readJson<TaskDto>(res, "concurrent task")));
        const numbers = tasks.map((task) => task.taskNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
        expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(new Set(numbers).size).toBe(10);
    });

    test("rejects a client task number except for a superuser import", async () => {
        const board = await createBoard(`Manual number ${uniqueSuffix()}`);

        const ownerAttempt = await pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({
                title: "Owner number",
                status: "backlog",
                board: board.id,
                task_number: 9001,
            }),
        });
        await expectStatus(ownerAttempt, 400, "owner task number");

        const superuserToken = await getSuperuserToken();
        const imported = await pbCreate<{ id: string; task_number: number }>(superuserToken, "tasks", {
            title: "Imported number",
            status: "backlog",
            board: board.id,
            task_number: 9001,
            labels: [],
        });
        expect(imported.task_number).toBe(9001);

        // A counter that trails an imported number skips the occupied value
        // instead of failing the unique index.
        const importedFirst = await pbCreate<{ id: string; task_number: number }>(superuserToken, "tasks", {
            title: "Imported first number",
            status: "backlog",
            board: board.id,
            task_number: 1,
            labels: [],
        });
        expect(importedFirst.task_number).toBe(1);

        const next = await createTask(board.id, { title: "After import", status: "backlog" });
        expect(next.taskNumber).toBe(2);
    });

    test("recomputes completed_at when a column becomes final or open", async () => {
        const board = await createBoard(`Final toggle ${uniqueSuffix()}`);
        const columnsRes = await get(`/boards/${board.id}/columns`);
        const columns = await readJson<BoardColumnDto[]>(columnsRes, "columns");
        const done = columns.find((column) => column.slug === "done")!;
        const task = await createTask(board.id, { title: "Finish me", status: "done" });
        expect(task.completedAt).not.toBeNull();

        await expectStatus(
            await patch(`/board-columns/${done.id}`, { name: "Done", isFinal: false }),
            200,
            "open final column",
        );
        const reopened = await readJson<TaskDto>(await get(`/tasks/${task.id}`), "reopened task");
        expect(reopened.completedAt).toBeNull();

        await expectStatus(
            await patch(`/board-columns/${done.id}`, { name: "Done", isFinal: true }),
            200,
            "finalize column",
        );
        const completed = await readJson<TaskDto>(await get(`/tasks/${task.id}`), "completed task");
        expect(completed.completedAt).not.toBeNull();
    });

    test("repairs a partial default-column seed", async () => {
        const board = await createBoard(`Seed repair ${uniqueSuffix()}`);
        const columnsRes = await get(`/boards/${board.id}/columns`);
        const columns = await readJson<BoardColumnDto[]>(columnsRes, "columns before delete");
        const next = columns.find((column) => column.slug === "next")!;

        const superuserToken = await getSuperuserToken();
        const deleted = await pbRequest(`/collections/board_columns/records/${next.id}`, {
            method: "DELETE",
            headers: authHeaders(superuserToken),
        });
        await expectStatus(deleted, 204, "delete seeded column");

        const admin = await createAdmin("kanban-repair");
        const repaired = await pbRequest("/admin/repair-kanban", {
            method: "POST",
            headers: authHeaders(admin.token, true),
            body: JSON.stringify({ boardId: board.id }),
        });
        await expectStatus(repaired, 200, "repair columns");

        const after = await readJson<BoardColumnDto[]>(
            await get(`/boards/${board.id}/columns`),
            "columns after repair",
        );
        expect(after.map((column) => column.slug)).toEqual(["backlog", "next", "progress", "done"]);
    });

    test("records user and AI activity actors", async () => {
        const board = await createBoard(`Actors ${uniqueSuffix()}`);
        const created = await pbRequest("/collections/tasks/records", {
            method: "POST",
            headers: authHeaders(owner.token, true),
            body: JSON.stringify({
                title: "Actor task",
                status: "backlog",
                board: board.id,
            }),
        });
        await expectStatus(created, 200, "create actor task");
        const task = await readJson<{ id: string }>(created);

        const updated = await pbRequest(`/collections/tasks/records/${task.id}`, {
            method: "PATCH",
            headers: {
                ...authHeaders(owner.token, true),
                "X-Nana-Actor": "ai",
            },
            body: JSON.stringify({ priority: "urgent" }),
        });
        await expectStatus(updated, 200, "AI update");

        const activity = await pbList<{
            type: string;
            actor: string;
            actor_type: string;
            actor_label: string;
        }>(owner.token, "task_activity", {
            filter: `task = "${task.id}"`,
            sort: "-created",
        });
        const createdRow = activity.items.find((row) => row.type === "created")!;
        expect(createdRow.actor).toBe(owner.id);
        expect(createdRow.actor_type).toBe("user");

        const aiRow = activity.items.find((row) => row.type === "priority_changed")!;
        expect(aiRow.actor).toBe("");
        expect(aiRow.actor_type).toBe("ai");
        expect(aiRow.actor_label).toBe("Nana");
    });

    test("keeps typed REST author-scoped", async () => {
        const suffix = uniqueSuffix();
        const board = await createBoard(`Owner only ${suffix}`);
        const task = await createTask(board.id, { title: `Private ${suffix}`, status: "backlog" });

        const foreignRead = await bunRequest(`${API}/tasks/${task.id}`, {
            headers: authHeaders(other.token),
        });
        await expectJsonError(foreignRead, 404, "not found");

        const foreignActivity = await bunRequest(`${API}/tasks/${task.id}/activity`, {
            headers: authHeaders(other.token),
        });
        await expectJsonError(foreignActivity, 404, "not found");
    });
});
