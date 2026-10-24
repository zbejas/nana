import { beforeAll, describe, expect, test } from "bun:test";
import {
    PB_API,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
} from "../helpers/setup";
import { listNotes, readNote } from "../../src/api/chat/tools/notes";
import { listBoards, readBoard } from "../../src/api/chat/tools/boards";
import type { ToolContext } from "../../src/api/chat/tools/http";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "testPassword123!";

let superuserToken: string;
let userA: { id: string; token: string };
let userB: { id: string; token: string };
let contextA: ToolContext;
let contextB: ToolContext;
let noteField = "document";

const notes = {
    alpha: "",
    beta: "",
    gamma: "",
    secret: "",
};

const boards = {
    roadmap: "",
    archived: "",
    private: "",
};

const taskIds = {
    backlog: "",
    next: "",
    progress: "",
    done1: "",
    done2: "",
};

const noteContent = [
    "Line one",
    "Line two",
    "Line three",
    "x".repeat(2500),
    "Line five",
].join("\n");

async function pbCreate(token: string, collection: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${PB_API}/collections/${collection}/records`, {
        method: "POST",
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Failed to create ${collection} (${res.status}): ${text}`);
    }
    return JSON.parse(text);
}

async function createNote(token: string, userId: string, title: string, content: string, tags: string[] = []): Promise<string> {
    const record = await pbCreate(token, "documents", {
        title,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
        content,
        tags,
        author: userId,
    });
    return record.id;
}

async function createBoard(token: string, userId: string, name: string, archived = false): Promise<string> {
    const record = await pbCreate(token, "boards", {
        name,
        description: `${name} description`,
        archived,
        author: userId,
    });
    return record.id;
}

async function createTask(
    token: string,
    userId: string,
    boardId: string,
    data: {
        title: string;
        status: "backlog" | "next" | "progress" | "done";
        boardOrder: number;
        description?: string;
        noteId?: string;
        labels?: string[];
        priority?: string;
        dueDate?: string;
    },
): Promise<string> {
    const base: Record<string, unknown> = {
        title: data.title,
        description: data.description ?? "",
        status: data.status,
        board_order: data.boardOrder,
        labels: data.labels ?? [],
        ...(data.priority ? { priority: data.priority } : {}),
        ...(data.dueDate ? { due_date: data.dueDate } : {}),
        board: boardId,
        author: userId,
        ...(data.noteId ? { [noteField]: data.noteId } : {}),
    };

    const record = await pbCreate(token, "tasks", base);
    return record.id;
}

async function resolveTaskNoteField(): Promise<void> {
    const res = await fetch(`${PB_API}/collections/tasks`, {
        headers: { Authorization: superuserToken },
    });
    if (!res.ok) {
        throw new Error(`Failed to inspect tasks collection (${res.status})`);
    }
    const collection = (await res.json()) as { fields?: Array<{ name?: string }> };
    const names = new Set((collection.fields ?? []).map((field) => field.name));
    noteField = names.has("note") ? "note" : "document";
}

beforeAll(async () => {
    superuserToken = await authenticateSuperuser();
    await resolveTaskNoteField();

    const emailA = `chat-tools-a-${suffix}@test.local`;
    const emailB = `chat-tools-b-${suffix}@test.local`;

    const createdA = await createTestUser(superuserToken, {
        email: emailA,
        password,
        name: "Chat Tools A",
    });
    const createdB = await createTestUser(superuserToken, {
        email: emailB,
        password,
        name: "Chat Tools B",
    });

    const authA = await authenticateUser(emailA, password);
    const authB = await authenticateUser(emailB, password);
    userA = { id: createdA.id, token: authA.token };
    userB = { id: createdB.id, token: authB.token };
    contextA = { authHeader: userA.token, userId: userA.id };
    contextB = { authHeader: userB.token, userId: userB.id };

    notes.alpha = await createNote(userA.token, userA.id, "Alpha Planning", noteContent, ["work", "urgent"]);
    notes.beta = await createNote(userA.token, userA.id, "Beta Notes", "Beta body", ["work"]);
    notes.gamma = await createNote(userA.token, userA.id, "Gamma Log", "Gamma body");
    notes.secret = await createNote(userB.token, userB.id, "Secret Note", "User B only", ["private"]);

    boards.roadmap = await createBoard(userA.token, userA.id, "Roadmap");
    boards.archived = await createBoard(userA.token, userA.id, "Old Roadmap", true);
    boards.private = await createBoard(userB.token, userB.id, "Private Board");

    taskIds.backlog = await createTask(userA.token, userA.id, boards.roadmap, {
        title: "Backlog item",
        status: "backlog",
        boardOrder: 1,
    });
    taskIds.next = await createTask(userA.token, userA.id, boards.roadmap, {
        title: "Next item",
        status: "next",
        boardOrder: 1,
        priority: "high",
        labels: ["work"],
        dueDate: "2026-11-01 12:00:00.000Z",
        noteId: notes.alpha,
    });
    taskIds.progress = await createTask(userA.token, userA.id, boards.roadmap, {
        title: "Progress item",
        status: "progress",
        boardOrder: 1,
    });
    taskIds.done1 = await createTask(userA.token, userA.id, boards.roadmap, {
        title: "Shipped release",
        status: "done",
        boardOrder: 1,
        description: "## Ship the **release**\n\n<p>Build &amp; test the <strong>landing page</strong>.</p>",
    });
    taskIds.done2 = await createTask(userA.token, userA.id, boards.roadmap, {
        title: "Second done item",
        status: "done",
        boardOrder: 2,
    });

    await createTask(userB.token, userB.id, boards.private, {
        title: "User B task",
        status: "progress",
        boardOrder: 1,
    });
});

describe("list_notes", () => {
    test("returns only the caller's notes with metadata and no body", async () => {
        const result = await listNotes(contextA, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.notes.length).toBe(3);
        expect(result.notes.map((note) => note.id)).not.toContain(notes.secret);
        expect(result.notes[0]).toHaveProperty("wordCount");
        expect(result.notes[0]).toHaveProperty("readingTime");
        expect(result.notes[0]).not.toHaveProperty("content");
    });

    test("pages and sorts metadata", async () => {
        const first = await listNotes(contextA, { perPage: 2, page: 1, sort: "title" });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.notes.map((note) => note.title)).toEqual(["Alpha Planning", "Beta Notes"]);
        expect(first.totalItems).toBe(3);
        expect(first.totalPages).toBe(2);
        expect(first.hasMore).toBe(true);

        const second = await listNotes(contextA, { perPage: 2, page: 2, sort: "title" });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.notes.map((note) => note.title)).toEqual(["Gamma Log"]);
        expect(second.hasMore).toBe(false);
    });

    test("filters by tag and survives filter-string injection", async () => {
        const tagged = await listNotes(contextA, { tag: "urgent" });
        expect(tagged.ok).toBe(true);
        if (!tagged.ok) return;
        expect(tagged.notes.map((note) => note.id)).toEqual([notes.alpha]);

        const injected = await listNotes(contextA, { query: '"; author != "' });
        expect(injected.ok).toBe(true);
        if (!injected.ok) return;
        expect(injected.notes).toEqual([]);
    });

    test("does not leak notes for an invalid token", async () => {
        const result = await listNotes(
            { authHeader: "invalid-token-value", userId: userA.id },
            {},
        );
        // PocketBase treats an invalid token as a guest and applies listRule,
        // so this is an empty 200 page, not a 401. What matters is no leak.
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.notes).toEqual([]);
        expect(result.totalItems).toBe(0);
    });

    test("returns unauthorized when the auth header is missing", async () => {
        const result = await listNotes(
            { authHeader: "", userId: userA.id },
            {},
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("unauthorized");
    });

    test("rejects malformed folder ids", async () => {
        const result = await listNotes(contextA, { folderId: 'bad"id' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("invalid_input");
    });
});

describe("read_note", () => {
    test("pages by line and reports continuation", async () => {
        const result = await readNote(contextA, { noteId: notes.alpha, offset: 2, limit: 2 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content).toBe("Line two\nLine three");
        expect(result.totalLines).toBe(5);
        expect(result.hasMore).toBe(true);
        expect(result.nextOffset).toBe(4);
        expect(result.truncated).toBe(false);
    });

    test("clips long lines and reports truncation", async () => {
        const result = await readNote(contextA, { noteId: notes.alpha, offset: 4, limit: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content.length).toBe(2000);
        expect(result.clippedLines).toBe(1);
        expect(result.truncated).toBe(true);
        expect(result.hasMore).toBe(true);
        expect(result.nextOffset).toBe(5);
    });

    test("returns the tail without claiming more", async () => {
        const result = await readNote(contextA, { noteId: notes.alpha, offset: 5, limit: 10 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content).toBe("Line five");
        expect(result.hasMore).toBe(false);
        expect(result.nextOffset).toBeNull();
    });

    test("hides another user's note behind a generic not_found", async () => {
        const result = await readNote(contextA, { noteId: notes.secret });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("not_found");
    });
});

describe("list_boards", () => {
    test("returns active boards with exact task and column counts", async () => {
        const result = await listBoards(contextA, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.boards.map((board) => board.id)).toContain(boards.roadmap);
        expect(result.boards.map((board) => board.id)).not.toContain(boards.archived);
        expect(result.totalBoards).toBe(result.boards.length);

        const roadmap = result.boards.find((board) => board.id === boards.roadmap);
        expect(roadmap?.taskCounts).toEqual({
            open: 3,
            done: 2,
            total: 5,
            columns: { backlog: 1, next: 1, progress: 1, done: 2 },
        });
    });

    test("can include archived boards on request", async () => {
        const result = await listBoards(contextA, { includeArchived: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.boards.map((board) => board.id)).toContain(boards.archived);
        expect(result.boards.find((board) => board.id === boards.archived)?.archived).toBe(true);
    });

    test("never lists another user's boards", async () => {
        const resultB = await listBoards(contextB, { includeArchived: true });
        expect(resultB.ok).toBe(true);
        if (!resultB.ok) return;
        expect(resultB.boards.map((board) => board.id)).toContain(boards.private);
        expect(resultB.boards.map((board) => board.id)).not.toContain(boards.roadmap);
    });
});

describe("read_board", () => {
    test("reads a column with paging", async () => {
        const first = await readBoard(contextA, { boardId: boards.roadmap, column: "done", perPage: 1, page: 1 });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        expect(first.column).toBe("done");
        expect(first.totalItems).toBe(2);
        expect(first.totalPages).toBe(2);
        expect(first.hasMore).toBe(true);
        expect(first.tasks).toHaveLength(1);
        expect(first.tasks[0]?.id).toBe(taskIds.done1);
        expect(first.tasks[0]?.boardOrder).toBe(1);

        const second = await readBoard(contextA, { boardId: boards.roadmap, column: "done", perPage: 1, page: 2 });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.tasks[0]?.id).toBe(taskIds.done2);
        expect(second.tasks[0]?.boardOrder).toBe(2);
        expect(second.hasMore).toBe(false);
    });

    test("returns task summaries with note ids and sanitized excerpts", async () => {
        const result = await readBoard(contextA, { boardId: boards.roadmap, column: "backlog" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const backlog = result.tasks[0];
        expect(backlog?.id).toBe(taskIds.backlog);
        expect(backlog).toHaveProperty("dueDate");
        expect(backlog).toHaveProperty("labels");

        const done = await readBoard(contextA, { boardId: boards.roadmap, column: "done" });
        expect(done.ok).toBe(true);
        if (!done.ok) return;
        const shipped = done.tasks.find((task) => task.id === taskIds.done1);
        expect(shipped?.descriptionExcerpt).toContain("Ship the release");
        expect(shipped?.descriptionExcerpt).toContain("Build & test");
        expect(shipped?.descriptionExcerpt).not.toContain("<p>");
        expect(shipped?.descriptionExcerpt).not.toContain("**");
        expect((shipped?.descriptionExcerpt.length ?? 0)).toBeLessThanOrEqual(400);

        const next = await readBoard(contextA, { boardId: boards.roadmap, column: "next" });
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        expect(next.tasks[0]?.noteId).toBe(notes.alpha);
    });

    test("hides another user's board and archived boards", async () => {
        const other = await readBoard(contextA, { boardId: boards.private });
        expect(other.ok).toBe(false);
        if (other.ok) return;
        expect(other.code).toBe("not_found");

        const archived = await readBoard(contextA, { boardId: boards.archived });
        expect(archived.ok).toBe(false);
        if (archived.ok) return;
        expect(archived.code).toBe("not_found");
    });

    test("rejects malformed board ids", async () => {
        const result = await readBoard(contextA, { boardId: 'bad"id' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("invalid_input");
    });
});
