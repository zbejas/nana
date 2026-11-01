import { beforeAll, describe, expect, test } from "bun:test";
import { listBoards, readBoard } from "../../src/api/chat/tools/boards";
import { listFoldersForChat } from "../../src/api/chat/tools/folders";
import type { ToolContext } from "../../src/api/chat/tools/http";
import { listNotes, readNote } from "../../src/api/chat/tools/notes";
import {
    createBoard,
    createFolder,
    createNote,
    createTask,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";

let owner: TestUser;
let other: TestUser;
let ownerContext: ToolContext;
let otherContext: ToolContext;

const notes: Record<"alpha" | "beta" | "gamma" | "secret", TestRecord> = {
    alpha: { id: "" },
    beta: { id: "" },
    gamma: { id: "" },
    secret: { id: "" },
};

const boards: Record<"roadmap" | "archived" | "private", TestRecord> = {
    roadmap: { id: "" },
    archived: { id: "" },
    private: { id: "" },
};

const hiddenNotes: Record<"privateNote" | "folderNote" | "childNote", TestRecord> = {
    privateNote: { id: "" },
    folderNote: { id: "" },
    childNote: { id: "" },
};

const hiddenBoards: Record<"privateBoard" | "folderBoard", TestRecord> = {
    privateBoard: { id: "" },
    folderBoard: { id: "" },
};

let privateFolder: TestRecord;
let privateChildFolder: TestRecord;

const tasks: Record<"backlog" | "next" | "progress" | "done1" | "done2", TestRecord> = {
    backlog: { id: "" },
    next: { id: "" },
    progress: { id: "" },
    done1: { id: "" },
    done2: { id: "" },
};

const noteContent = [
    "Line one",
    "Line two",
    "Line three",
    "x".repeat(2500),
    "Line five",
].join("\n");

beforeAll(async () => {
    owner = await createUser("chat-tools-owner");
    other = await createUser("chat-tools-other");
    ownerContext = { authHeader: owner.token, userId: owner.id };
    otherContext = { authHeader: other.token, userId: other.id };

    notes.alpha = await createNote(owner, {
        title: "Alpha Planning",
        content: noteContent,
        tags: ["work", "urgent"],
    });
    notes.beta = await createNote(owner, {
        title: "Beta Notes",
        content: "Beta body",
        tags: ["work"],
    });
    notes.gamma = await createNote(owner, {
        title: "Gamma Log",
        content: "Gamma body",
    });
    notes.secret = await createNote(other, {
        title: "Secret Note",
        content: "User B only",
        tags: ["private"],
    });

    boards.roadmap = await createBoard(owner, { name: "Roadmap", description: "The plan" });
    boards.archived = await createBoard(owner, {
        name: "Old Roadmap",
        description: "Done and dusted",
        archived: true,
    });
    boards.private = await createBoard(other, { name: "Private Board" });

    // AI visibility fixtures: a private folder locks its whole subtree, and
    // private records stay hidden even when the caller owns them.
    privateFolder = await createFolder(owner, { name: "Owner Private Folder", is_private: true });
    privateChildFolder = await createFolder(owner, {
        name: "Owner Private Child Folder",
        parent: privateFolder.id,
    });

    hiddenNotes.privateNote = await createNote(owner, {
        title: "Owner Private Note",
        content: "Owner private body",
        is_private: true,
    });
    hiddenNotes.folderNote = await createNote(owner, {
        title: "Owner Folder Note",
        content: "Owner folder body",
        folder: privateFolder.id,
    });
    hiddenNotes.childNote = await createNote(owner, {
        title: "Owner Child Folder Note",
        content: "Owner child folder body",
        folder: privateChildFolder.id,
    });

    hiddenBoards.privateBoard = await createBoard(owner, {
        name: "Owner Private Board",
        description: "Hidden from AI",
        is_private: true,
    });
    hiddenBoards.folderBoard = await createBoard(owner, {
        name: "Owner Folder Board",
        description: "Hidden with its folder",
        folder: privateFolder.id,
    });

    tasks.backlog = await createTask(owner, boards.roadmap.id, {
        title: "Backlog item",
        status: "backlog",
        board_order: 1,
    });
    tasks.next = await createTask(owner, boards.roadmap.id, {
        title: "Next item",
        status: "next",
        board_order: 1,
        priority: "high",
        labels: ["work"],
        due_date: "2026-11-01 12:00:00.000Z",
        document: notes.alpha.id,
    });
    tasks.progress = await createTask(owner, boards.roadmap.id, {
        title: "Progress item",
        status: "progress",
        board_order: 1,
    });
    tasks.done1 = await createTask(owner, boards.roadmap.id, {
        title: "Shipped release",
        status: "done",
        board_order: 1,
        description: "## Ship the **release**\n\n<p>Build &amp; test the <strong>landing page</strong>.</p>",
    });
    tasks.done2 = await createTask(owner, boards.roadmap.id, {
        title: "Second done item",
        status: "done",
        board_order: 2,
    });

    await createTask(other, boards.private.id, {
        title: "User B task",
        status: "progress",
        board_order: 1,
    });
});

describe("list_notes", () => {
    test("returns only the caller's notes with metadata and no body", async () => {
        const result = await listNotes(ownerContext, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.notes).toHaveLength(3);
        expect(result.notes.map((note) => note.id)).not.toContain(notes.secret.id);
        expect(result.notes[0]).toHaveProperty("wordCount");
        expect(result.notes[0]).toHaveProperty("readingTime");
        expect(result.notes[0]).not.toHaveProperty("content");
    });

    test("pages and sorts metadata", async () => {
        const first = await listNotes(ownerContext, { perPage: 2, page: 1, sort: "title" });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.notes.map((note) => note.title)).toEqual(["Alpha Planning", "Beta Notes"]);
        expect(first.totalItems).toBe(3);
        expect(first.totalPages).toBe(2);
        expect(first.hasMore).toBe(true);

        const second = await listNotes(ownerContext, { perPage: 2, page: 2, sort: "title" });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.notes.map((note) => note.title)).toEqual(["Gamma Log"]);
        expect(second.hasMore).toBe(false);
    });

    test("filters by tag and survives filter-string injection", async () => {
        const tagged = await listNotes(ownerContext, { tag: "urgent" });
        expect(tagged.ok).toBe(true);
        if (!tagged.ok) return;
        expect(tagged.notes.map((note) => note.id)).toEqual([notes.alpha.id]);

        const injected = await listNotes(ownerContext, { query: '"; author != "' });
        expect(injected.ok).toBe(true);
        if (!injected.ok) return;
        expect(injected.notes).toEqual([]);
    });

    test("searches titles without returning bodies", async () => {
        const result = await listNotes(ownerContext, { query: "Beta" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.notes.map((note) => note.title)).toEqual(["Beta Notes"]);
        expect(result.notes[0]).not.toHaveProperty("content");
    });

    test("hides private notes and the private folder subtree from lists and totals", async () => {
        const result = await listNotes(ownerContext, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const ids = result.notes.map((note) => note.id);
        expect(ids).not.toContain(hiddenNotes.privateNote.id);
        expect(ids).not.toContain(hiddenNotes.folderNote.id);
        expect(ids).not.toContain(hiddenNotes.childNote.id);
        expect(result.totalItems).toBe(3);

        const inPrivateFolder = await listNotes(ownerContext, { folderId: privateFolder.id });
        expect(inPrivateFolder.ok).toBe(true);
        if (!inPrivateFolder.ok) return;
        expect(inPrivateFolder.notes).toEqual([]);
        expect(inPrivateFolder.totalItems).toBe(0);

        const inChildFolder = await listNotes(ownerContext, { folderId: privateChildFolder.id });
        expect(inChildFolder.ok).toBe(true);
        if (!inChildFolder.ok) return;
        expect(inChildFolder.notes).toEqual([]);
        expect(inChildFolder.totalItems).toBe(0);
    });

    test("does not leak notes for an invalid token", async () => {
        const result = await listNotes(
            { authHeader: "invalid-token-value", userId: owner.id },
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
        const result = await listNotes({ authHeader: "", userId: owner.id }, {});
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("unauthorized");
    });

    test("rejects malformed folder ids", async () => {
        const result = await listNotes(ownerContext, { folderId: 'bad"id' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("invalid_input");
    });

    test("rejects invalid paging input", async () => {
        const result = await listNotes(ownerContext, { page: 0, perPage: 500 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("invalid_input");
    });
});

describe("read_note", () => {
    test("reads the whole note by default", async () => {
        const result = await readNote(ownerContext, { noteId: notes.alpha.id });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content).toBe(noteContent);
        expect(result.totalLines).toBe(5);
        expect(result.returnedLines).toBe(5);
        expect(result.hasMore).toBe(false);
        expect(result.omittedBefore).toBe(0);
        expect(result.omittedAfter).toBe(0);
        expect(result.omittedLines).toBe(0);
        expect(result.nextOffset).toBeNull();
        expect(result.complete).toBe(true);
        expect(result.clippedLines).toBe(0);
        expect(result.tailUnavailable).toBe(false);
        expect(result.notice).toBeNull();
        expect(result.revision).toBeGreaterThanOrEqual(1);
        expect(result.versionToken).toMatch(/^[a-f0-9]{32}$/);
        expect(result.updated).toBeTruthy();
    });

    test("reports omitted lines instead of silently returning a partial note", async () => {
        const longNote = await createNote(owner, {
            title: "Long Note",
            content: Array.from({ length: 2_000 }, (_, index) => `Line ${index + 1} with enough text to fill the budget.`).join("\n"),
        });
        const result = await readNote(ownerContext, { noteId: longNote.id });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.complete).toBe(false);
        expect(result.hasMore).toBe(true);
        expect(result.omittedBefore).toBe(0);
        expect(result.omittedAfter).toBeGreaterThan(0);
        expect(result.omittedLines).toBe(result.omittedAfter);
        expect(result.nextOffset).not.toBeNull();
        expect(result.notice).toContain("Returned lines");
        expect(result.notice).toContain(`offset=${result.nextOffset}`);
    });

    test("pages by line and reports before and after omissions", async () => {
        const result = await readNote(ownerContext, { noteId: notes.alpha.id, offset: 2, limit: 2 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content).toBe("Line two\nLine three");
        expect(result.totalLines).toBe(5);
        expect(result.returnedLines).toBe(2);
        expect(result.hasMore).toBe(true);
        expect(result.omittedBefore).toBe(1);
        expect(result.omittedAfter).toBe(2);
        expect(result.omittedLines).toBe(3);
        expect(result.nextOffset).toBe(4);
        expect(result.complete).toBe(false);
        expect(result.notice).toContain("Earlier lines were not returned");
        expect(result.notice).toContain("Returned lines 2-3 of 5");
        expect(result.notice).toContain("offset=4");
        expect(result.truncated).toBe(false);
    });

    test("clips long lines and reports truncation", async () => {
        const result = await readNote(ownerContext, { noteId: notes.alpha.id, offset: 4, limit: 1 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content.length).toBe(2000);
        expect(result.clippedLines).toBe(1);
        expect(result.truncated).toBe(true);
        expect(result.complete).toBe(false);
        expect(result.hasMore).toBe(true);
        expect(result.omittedBefore).toBe(3);
        expect(result.omittedAfter).toBe(1);
        expect(result.omittedLines).toBe(4);
        expect(result.nextOffset).toBe(5);
        expect(result.notice).toContain("clipped at 2,000 characters");
        expect(result.notice).toContain("not available in a later window");
    });

    test("a tail-only read is incomplete and says earlier lines were not returned", async () => {
        const result = await readNote(ownerContext, { noteId: notes.alpha.id, offset: 5, limit: 10 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.content).toBe("Line five");
        expect(result.hasMore).toBe(false);
        expect(result.nextOffset).toBeNull();
        expect(result.omittedBefore).toBe(4);
        expect(result.omittedAfter).toBe(0);
        expect(result.omittedLines).toBe(4);
        expect(result.complete).toBe(false);
        expect(result.notice).toContain("Earlier lines were not returned");
        expect(result.notice).toContain("start again with offset=1");
    });

    test("rejects an offset past the last line with the actual line count", async () => {
        const result = await readNote(ownerContext, { noteId: notes.alpha.id, offset: 6 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("invalid_input");
        expect(result.message).toContain("5 lines");
        expect(result.message).toContain("offset 6");
        expect(result.message).toContain("between 1 and 5");
    });

    test("reports a byte-capped tail and clipped line as unavailable", async () => {
        const hugeNote = await createNote(owner, {
            title: "Cap Note",
            content: "x".repeat(2_000_001),
        });
        const result = await readNote(ownerContext, { noteId: hugeNote.id });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.complete).toBe(false);
        expect(result.tailUnavailable).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.clippedLines).toBe(1);
        expect(result.notice).toContain("byte read cap");
        expect(result.notice).toContain("tail after line");
        expect(result.notice).toContain("not available in a later window");
    });

    test("hides another user's note behind a generic not_found", async () => {
        const result = await readNote(ownerContext, { noteId: notes.secret.id });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("not_found");
    });

    test("hides private notes and notes inside private folders", async () => {
        for (const note of Object.values(hiddenNotes)) {
            const result = await readNote(ownerContext, { noteId: note.id });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.code).toBe("not_found");
        }
    });

    test("rejects malformed ids and out-of-range windows", async () => {
        const malformed = await readNote(ownerContext, { noteId: 'bad"id' });
        expect(malformed.ok).toBe(false);
        if (malformed.ok) return;
        expect(malformed.code).toBe("invalid_input");

        const oversized = await readNote(ownerContext, { noteId: notes.alpha.id, limit: 2_001 });
        expect(oversized.ok).toBe(false);
        if (oversized.ok) return;
        expect(oversized.code).toBe("invalid_input");
    });
});

describe("list_boards", () => {
    test("returns active boards with exact task and column counts", async () => {
        const result = await listBoards(ownerContext, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.boards.map((board) => board.id)).toContain(boards.roadmap.id);
        expect(result.boards.map((board) => board.id)).not.toContain(boards.archived.id);
        expect(result.totalBoards).toBe(result.boards.length);

        const roadmap = result.boards.find((board) => board.id === boards.roadmap.id);
        expect(roadmap?.taskCounts).toEqual({
            open: 3,
            done: 2,
            total: 5,
            planned: 0,
            archived: 0,
            columns: { backlog: 1, next: 1, progress: 1, done: 2 },
        });
        expect(roadmap?.columns.map((column) => column.slug)).toEqual([
            "backlog",
            "next",
            "progress",
            "done",
        ]);
        expect(roadmap?.columns.find((column) => column.slug === "done")).toMatchObject({
            isFinal: true,
            count: 2,
        });
    });

    test("can include archived boards on request", async () => {
        const result = await listBoards(ownerContext, { includeArchived: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.boards.map((board) => board.id)).toContain(boards.archived.id);
        expect(result.boards.find((board) => board.id === boards.archived.id)?.archived).toBe(true);
    });

    test("never lists another user's boards", async () => {
        const result = await listBoards(otherContext, { includeArchived: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.boards.map((board) => board.id)).toContain(boards.private.id);
        expect(result.boards.map((board) => board.id)).not.toContain(boards.roadmap.id);
    });

    test("pages boards and reports totals", async () => {
        const result = await listBoards(ownerContext, { perPage: 1, page: 1, includeArchived: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.boards).toHaveLength(1);
        expect(result.totalBoards).toBe(2);
        expect(result.totalPages).toBe(2);
        expect(result.hasMore).toBe(true);
    });

    test("hides private boards and boards inside private folders from lists and totals", async () => {
        const result = await listBoards(ownerContext, { includeArchived: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const ids = result.boards.map((board) => board.id);
        expect(ids).not.toContain(hiddenBoards.privateBoard.id);
        expect(ids).not.toContain(hiddenBoards.folderBoard.id);
        expect(ids).toContain(boards.roadmap.id);
        expect(result.totalBoards).toBe(2);
    });

    test("returns unauthorized without a token", async () => {
        const result = await listBoards({ authHeader: "", userId: owner.id }, {});
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("unauthorized");
    });
});

describe("read_board", () => {
    test("reads a column with paging", async () => {
        const first = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "done",
            perPage: 1,
            page: 1,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        expect(first.column).toBe("done");
        expect(first.totalItems).toBe(2);
        expect(first.totalPages).toBe(2);
        expect(first.hasMore).toBe(true);
        expect(first.tasks).toHaveLength(1);
        expect(first.tasks[0]?.id).toBe(tasks.done1.id);
        expect(first.tasks[0]?.boardOrder).toBe(1);

        const second = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "done",
            perPage: 1,
            page: 2,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.tasks[0]?.id).toBe(tasks.done2.id);
        expect(second.tasks[0]?.boardOrder).toBe(2);
        expect(second.hasMore).toBe(false);
    });

    test("returns task summaries with note ids and sanitized excerpts", async () => {
        const result = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "backlog",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const backlog = result.tasks[0];
        expect(backlog?.id).toBe(tasks.backlog.id);
        expect(backlog).toHaveProperty("dueDate");
        expect(backlog).toHaveProperty("labels");

        const done = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "done",
        });
        expect(done.ok).toBe(true);
        if (!done.ok) return;
        const shipped = done.tasks.find((task) => task.id === tasks.done1.id);
        expect(shipped?.descriptionExcerpt).toContain("Ship the release");
        expect(shipped?.descriptionExcerpt).toContain("Build & test");
        expect(shipped?.descriptionExcerpt).not.toContain("<p>");
        expect(shipped?.descriptionExcerpt).not.toContain("**");
        expect(shipped?.descriptionExcerpt.length ?? 0).toBeLessThanOrEqual(400);

        const next = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "next",
        });
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        expect(next.tasks[0]?.noteId).toBe(notes.alpha.id);
        expect(next.tasks[0]?.dueDate).toBe("2026-11-01 12:00:00.000Z");
        expect(next.tasks[0]?.labels).toEqual(["work"]);
    });

    test("reads the whole board ordered by column", async () => {
        const result = await readBoard(ownerContext, { boardId: boards.roadmap.id, perPage: 50 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.column).toBeNull();
        expect(result.tasks).toHaveLength(5);
        expect(result.tasks.map((task) => task.status)).toEqual([
            "backlog",
            "done",
            "done",
            "next",
            "progress",
        ]);
    });

    test("hides another user's board and archived boards", async () => {
        const otherBoard = await readBoard(ownerContext, { boardId: boards.private.id });
        expect(otherBoard.ok).toBe(false);
        if (otherBoard.ok) return;
        expect(otherBoard.code).toBe("not_found");

        const archived = await readBoard(ownerContext, { boardId: boards.archived.id });
        expect(archived.ok).toBe(false);
        if (archived.ok) return;
        expect(archived.code).toBe("not_found");
    });

    test("hides private boards and boards inside private folders", async () => {
        for (const board of Object.values(hiddenBoards)) {
            const result = await readBoard(ownerContext, { boardId: board.id });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.code).toBe("not_found");
        }
    });

    test("rejects malformed board ids and columns", async () => {
        const malformed = await readBoard(ownerContext, { boardId: 'bad"id' });
        expect(malformed.ok).toBe(false);
        if (malformed.ok) return;
        expect(malformed.code).toBe("invalid_input");

        const badColumn = await readBoard(ownerContext, {
            boardId: boards.roadmap.id,
            column: "no-such-column",
        });
        expect(badColumn.ok).toBe(false);
        if (badColumn.ok) return;
        expect(badColumn.code).toBe("invalid_input");
    });
});


describe("list_folders", () => {
    test("lists visible folders and hides private subtrees", async () => {
        const visible = await createFolder(owner, { name: "Visible chat folder" });
        const result = await listFoldersForChat(ownerContext);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const ids = result.folders.map((folder) => folder.id);
        expect(ids).toContain(visible.id);
        expect(ids).not.toContain(privateFolder.id);
        expect(ids).not.toContain(privateChildFolder.id);
    });

    test("never returns another user's folders", async () => {
        const foreign = await createFolder(other, { name: "Other user's folder" });
        const result = await listFoldersForChat(ownerContext);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.folders.map((folder) => folder.id)).not.toContain(foreign.id);
    });
});
