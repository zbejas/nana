import { beforeAll, describe, expect, test } from "bun:test";
import { createChatTools } from "../../src/api/chat/tools";
import { ChatRunRecorder } from "../../src/api/chat/tools/recorder";
import { readNote } from "../../src/api/chat/tools/notes";
import {
    appendNoteTool,
    createBoardTool,
    createFolderTool,
    createNoteTool,
    createTaskTool,
    deleteNoteTool,
    editNoteTool,
    moveBoardTool,
    moveFolderTool,
    moveNoteTool,
    moveTaskTool,
    renameFolderTool,
    updateBoardTool,
    updateNoteTool,
    updateTaskTool,
} from "../../src/api/chat/tools/writes";
import { resolveChatContext } from "../../src/api/chat/context";
import { cancelChatEdit, confirmChatEdit, getChatEdit, listChatEdits, undoChatEdit } from "../../src/api/chat/edits";
import type { ToolContext } from "../../src/api/pocketbase/client";
import { bunRequest, expectStatus, pbGetRecord, pbList, pbRecordExists, readJson } from "../helpers/client";
import {
    createBoard,
    createConversation,
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
let conversation: TestRecord;
let privateFolder: TestRecord;

const notes: Record<"editable" | "second" | "privateNote" | "folderNote" | "otherNote", TestRecord> = {
    editable: { id: "" },
    second: { id: "" },
    privateNote: { id: "" },
    folderNote: { id: "" },
    otherNote: { id: "" },
};

const boards: Record<"work" | "archived" | "otherBoard", TestRecord> = {
    work: { id: "" },
    archived: { id: "" },
    otherBoard: { id: "" },
};

const noteContent = [
    "# Plan",
    "",
    "Intro line.",
    "",
    "## Goals",
    "",
    "- One",
    "- Two",
    "",
    "## Risks",
    "",
    "None yet.",
    "",
].join("\n");

interface WriteOptions {
    conversationId?: string;
    recorder?: ChatRunRecorder;
}

function writeContext(options: WriteOptions = {}) {
    return {
        context: ownerContext,
        recorder: options.recorder ?? new ChatRunRecorder(),
        conversationId: options.conversationId ?? conversation.id,
    };
}

async function shareNoteWithOther(noteId: string, permission: "view" | "edit"): Promise<void> {
    const response = await bunRequest("/api/v1/sharing/links", {
        method: "POST",
        headers: { Authorization: owner.token, "Content-Type": "application/json" },
        body: JSON.stringify({
            targetType: "document",
            targetId: noteId,
            userId: other.id,
            permission,
        }),
    });
    await expectStatus(response, 200, `share note ${permission}`);
}

async function readEditorNote(noteId: string) {
    const result = await readNote(ownerContext, { noteId, limit: 600 });
    if (!result.ok) throw new Error(`read_note failed: ${result.code} ${result.message}`);
    return result;
}

beforeAll(async () => {
    owner = await createUser("chat-write-owner");
    other = await createUser("chat-write-other");
    ownerContext = { authHeader: owner.token, userId: owner.id };
    otherContext = { authHeader: other.token, userId: other.id };
    conversation = await createConversation(owner, {
        title: "Write tools",
        messages: [],
    });

    notes.editable = await createNote(owner, {
        title: "Editable plan",
        content: noteContent,
        tags: ["work"],
    });
    notes.second = await createNote(owner, {
        title: "Second note",
        content: "# Second\n\nBody.",
    });
    notes.otherNote = await createNote(other, {
        title: "Other note",
        content: "# Other\n\nSecret.",
    });

    privateFolder = await createFolder(owner, { name: "Private AI folder", is_private: true });
    notes.privateNote = await createNote(owner, {
        title: "Private note",
        content: "# Private\n\nHidden.",
        is_private: true,
    });
    notes.folderNote = await createNote(owner, {
        title: "Folder note",
        content: "# Folder\n\nHidden.",
        folder: privateFolder.id,
    });

    boards.work = await createBoard(owner, { name: "Write board", description: "Tasks" });
    boards.archived = await createBoard(owner, {
        name: "Archived write board",
        archived: true,
    });
    boards.otherBoard = await createBoard(other, { name: "Other board" });

    await createTask(owner, boards.work.id, { title: "Existing task", status: "backlog" });
});

describe("tool registry", () => {
    test("ask mode has no write tools", () => {
        const tools = createChatTools(ownerContext, { mode: "ask" });
        expect(Object.keys(tools)).toContain("list_folders");
        expect(Object.keys(tools)).toContain("read_note");
        expect(Object.keys(tools)).toContain("list_tasks");
        for (const name of ["create_folder", "rename_folder", "move_folder", "create_note", "append_note", "edit_note", "update_note", "move_note", "create_board", "update_board", "move_board", "create_task", "update_task", "move_task", "delete_note", "delete_task", "delete_folder", "delete_board"]) {
            expect(Object.keys(tools)).not.toContain(name);
        }
    });

    test("edit mode registers the write allowlist", () => {
        const tools = createChatTools(ownerContext, { mode: "edit" });
        for (const name of ["create_folder", "rename_folder", "move_folder", "create_note", "append_note", "edit_note", "update_note", "move_note", "create_board", "update_board", "move_board", "create_task", "update_task", "move_task", "delete_note", "delete_task", "delete_folder", "delete_board"]) {
            expect(Object.keys(tools)).toContain(name);
        }
    });

    test("read tools collect sources from real results", async () => {
        const recorder = new ChatRunRecorder();
        const tools = createChatTools(ownerContext, { mode: "edit", recorder });
        const execute = tools.read_note?.execute as unknown as (
            input: unknown,
            options: { toolCallId: string },
        ) => Promise<unknown>;
        const result = await execute({ noteId: notes.second.id }, { toolCallId: "call-1" });
        expect((result as { ok: boolean }).ok).toBe(true);
        expect(recorder.listSources()).toContainEqual({
            type: "document",
            id: notes.second.id,
            title: "Second note",
        });
    });

    test("list tools do not become answer sources", async () => {
        const recorder = new ChatRunRecorder();
        const tools = createChatTools(ownerContext, { mode: "edit", recorder });
        const execute = tools.list_notes?.execute as unknown as (
            input: unknown,
            options: { toolCallId: string },
        ) => Promise<unknown>;
        const result = await execute({ query: "note" }, { toolCallId: "call-list" });
        expect((result as { ok: boolean }).ok).toBe(true);
        expect(recorder.listSources()).toEqual([]);
    });

    test("strict view note scope registers only read_note", () => {
        const tools = createChatTools(otherContext, {
            mode: "edit",
            noteScope: { documentId: notes.second.id, accessLevel: 1, strict: true },
        });
        expect(Object.keys(tools)).toEqual(["read_note"]);
    });

    test("strict edit note scope registers only the bound note tools", () => {
        const tools = createChatTools(otherContext, {
            mode: "edit",
            noteScope: { documentId: notes.second.id, accessLevel: 3, strict: true },
        });
        expect(Object.keys(tools).sort()).toEqual([
            "append_note",
            "edit_note",
            "read_note",
            "update_note",
        ]);
        for (const name of [
            "list_notes",
            "list_folders",
            "list_boards",
            "list_tasks",
            "read_task",
            "create_folder",
            "rename_folder",
            "move_folder",
            "create_note",
            "move_note",
            "create_board",
            "update_board",
            "move_board",
            "create_task",
            "update_task",
            "move_task",
            "delete_note",
            "delete_task",
            "delete_folder",
            "delete_board",
        ]) {
            expect(Object.keys(tools)).not.toContain(name);
        }
    });
});

describe("context resolution", () => {
    test("resolves titles from the database", async () => {
        const note = await resolveChatContext(ownerContext, { type: "document", id: notes.second.id });
        expect(note.ok).toBe(true);
        if (!note.ok) return;
        expect(note.context).toEqual({
            type: "document",
            id: notes.second.id,
            title: "Second note",
        });

        const board = await resolveChatContext(ownerContext, { type: "board", id: boards.work.id });
        expect(board.ok).toBe(true);
        if (!board.ok) return;
        expect(board.context.title).toBe("Write board");

        const folder = await resolveChatContext(ownerContext, { type: "folder", id: privateFolder.id });
        expect(folder.ok).toBe(false);
        if (folder.ok) return;
        expect(folder.status).toBe(404);
    });

    test("rejects foreign, private, and malformed context", async () => {
        const foreign = await resolveChatContext(ownerContext, { type: "document", id: notes.otherNote.id });
        expect(foreign.ok).toBe(false);
        if (foreign.ok) return;
        expect(foreign.status).toBe(404);

        const privateNote = await resolveChatContext(ownerContext, { type: "document", id: notes.privateNote.id });
        expect(privateNote.ok).toBe(false);
        if (privateNote.ok) return;
        expect(privateNote.status).toBe(404);

        const folderNote = await resolveChatContext(ownerContext, { type: "document", id: notes.folderNote.id });
        expect(folderNote.ok).toBe(false);
        if (folderNote.ok) return;
        expect(folderNote.status).toBe(404);

        const badType = await resolveChatContext(ownerContext, {
            type: "task" as never,
            id: notes.second.id,
        });
        expect(badType.ok).toBe(false);
        if (badType.ok) return;
        expect(badType.status).toBe(400);
    });
});

describe("shared note scope", () => {
    test("reads the bound note for a grantee and rejects other notes", async () => {
        const note = await createNote(owner, {
            title: "Grantee readable note",
            content: "# Shared\n\nGrantee read body.",
        });
        const unrelated = await createNote(other, { title: "Unrelated grantee note" });
        await shareNoteWithOther(note.id, "edit");

        const scope = { documentId: note.id, accessLevel: 3, strict: true };
        const read = await readNote(otherContext, { noteId: note.id }, undefined, scope);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.content).toContain("Grantee read body.");

        const wrong = await readNote(
            otherContext,
            { noteId: unrelated.id },
            undefined,
            scope,
        );
        expect(wrong.ok).toBe(false);
        if (wrong.ok) return;
        expect(wrong.code).toBe("not_found");

        const ownerRead = await readNote(ownerContext, { noteId: note.id });
        expect(ownerRead.ok).toBe(true);
    });

    test("edits the bound note at edit access and rejects view or unrelated scopes", async () => {
        const note = await createNote(owner, {
            title: "Grantee editable note",
            content: "# Shared\n\nOriginal grantee body.",
        });
        const unrelated = await createNote(owner, {
            title: "Outside the shared scope",
            content: "# Outside\n\nDo not touch.",
        });
        await shareNoteWithOther(note.id, "edit");

        const scope = { documentId: note.id, accessLevel: 3, strict: true };
        const read = await readNote(otherContext, { noteId: note.id }, undefined, scope);
        expect(read.ok).toBe(true);
        if (!read.ok) return;

        const granteeConversation = await createConversation(other, {
            title: "Grantee scope writes",
            messages: [],
        });
        const granteeWrite = {
            context: otherContext,
            recorder: new ChatRunRecorder(),
            conversationId: granteeConversation.id,
            noteScope: scope,
        };

        const edited = await editNoteTool(granteeWrite, {
            noteId: note.id,
            expectedRevision: read.versionToken,
            operations: [
                {
                    op: "replace_section",
                    heading: "Shared",
                    markdown: "Edited by the grantee.",
                },
            ],
            summary: "Grantee edit",
        });
        expect(edited.ok).toBe(true);
        if (!edited.ok) return;

        const stored = await pbGetRecord<TestRecord>(other.token, "documents", note.id);
        expect(String(stored.content)).toContain("Edited by the grantee.");
        expect(String(stored.content)).not.toContain("Original grantee body.");
        const sharedEvent = granteeWrite.recorder.drainEdits()[0];
        expect(sharedEvent?.contentChange?.before).toContain("Original grantee body.");
        expect(sharedEvent?.contentChange?.after).toContain("Edited by the grantee.");
        expect(sharedEvent?.contentChange?.beforeRevision).toBe(read.revision);
        expect(sharedEvent?.contentChange?.afterRevision).toBe(Number(stored.revision));

        const viewWrite = {
            ...granteeWrite,
            noteScope: { documentId: note.id, accessLevel: 1, strict: true },
        };
        const viewEdit = await editNoteTool(viewWrite, {
            noteId: note.id,
            expectedRevision: Number(stored.revision),
            operations: [{ op: "append", markdown: "View cannot write." }],
            summary: "View edit",
        });
        expect(viewEdit.ok).toBe(false);
        if (viewEdit.ok) return;
        expect(viewEdit.code).toBe("not_found");

        const unrelatedRead = await readNote(ownerContext, { noteId: unrelated.id });
        expect(unrelatedRead.ok).toBe(true);
        if (!unrelatedRead.ok) return;
        const wrongNote = await editNoteTool(granteeWrite, {
            noteId: unrelated.id,
            expectedRevision: unrelatedRead.revision,
            operations: [{ op: "append", markdown: "Wrong note." }],
            summary: "Wrong note edit",
        });
        expect(wrongNote.ok).toBe(false);
        if (wrongNote.ok) return;
        expect(wrongNote.code).toBe("not_found");

        const unchanged = await pbGetRecord<TestRecord>(owner.token, "documents", unrelated.id);
        expect(String(unchanged.content)).not.toContain("Wrong note.");
    });
});

describe("create_note", () => {
    test("creates an AI-authored note and records the edit", async () => {
        const recorder = new ChatRunRecorder();
        const result = await createNoteTool(writeContext({ recorder }), {
            title: "Chat created note",
            content: "# Created\n\nFrom chat.",
            tags: ["ai"],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.target.type).toBe("document");
        if (result.target.type !== "document") return;
        expect(result.target.url).toBe(`/document/${result.target.id}`);
        expect(result.undo.available).toBe(true);

        const record = await pbGetRecord<TestRecord>(owner.token, "documents", result.target.id);
        expect(record.title).toBe("Chat created note");
        expect(record.author).toBe(owner.id);
        expect(record.last_edit_source).toBe("ai");
        expect(record.last_edited_by).toBe("Nana");
        expect(record.revision).toBe(1);
        expect(recorder.listSources()).toContainEqual({
            type: "document",
            id: result.target.id,
            title: "Chat created note",
        });

        if (!result.undo.editId) throw new Error("missing edit id");
        const edit = await getChatEdit(owner.token, result.undo.editId);
        expect(edit.tool).toBe("create_note");
        expect(edit.status).toBe("applied");
        expect(edit.actorType).toBe("ai");
        expect(edit.actorLabel).toBe("Nana");
        expect(edit.target.title).toBe("Chat created note");
        expect(recorder.drainEdits()[0]?.contentChange).toBeUndefined();
    });
});

describe("append_note", () => {
    test("appends without changing untouched content and records the before snapshot", async () => {
        const before = await readEditorNote(notes.editable.id);
        const recorder = new ChatRunRecorder();
        const result = await appendNoteTool(writeContext({ recorder }), {
            noteId: notes.editable.id,
            markdown: "## Follow-up\n\nAdded by Nana.",
            expectedRevision: before.versionToken,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.changed.sections?.length).toBe(1);

        const record = await pbGetRecord<TestRecord>(owner.token, "documents", notes.editable.id);
        const content = String(record.content);
        expect(content.startsWith(noteContent.trimEnd())).toBe(true);
        expect(content).toContain("## Follow-up\n\nAdded by Nana.");
        expect(content).toContain("## Risks\n\nNone yet.");
        expect(record.revision).toBe(before.revision + 1);
        expect(record.last_edit_source).toBe("ai");
        expect(record.last_edited_by).toBe("Nana");

        if (!result.undo.editId) throw new Error("missing edit id");
        const edits = await pbList<TestRecord>(owner.token, "chat_edits", {
            filter: `id="${result.undo.editId}"`,
            perPage: 1,
        });
        const rawOperations = edits.items[0]?.operations;
        const operations = (typeof rawOperations === "string"
            ? JSON.parse(rawOperations)
            : rawOperations) as {
                before?: { content?: string };
                versionId?: string;
                contentChange?: unknown;
            };
        expect(operations.before?.content).toBe(before.content);
        expect(operations.versionId).toBeUndefined();

        // The before/after body pair rides the live event only. It is not part
        // of the DTO returned by get/list, nor the persisted operations row.
        const events = recorder.drainEdits();
        expect(events).toHaveLength(1);
        expect(events[0]?.edit.id).toBe(result.undo.editId);
        expect(events[0]?.contentChange).toEqual({
            before: before.content,
            after: content,
            beforeRevision: before.revision,
            afterRevision: Number(record.revision),
        });
        expect((events[0]?.edit as { contentChange?: unknown }).contentChange).toBeUndefined();
        expect(operations.contentChange).toBeUndefined();

        const dto = await getChatEdit(owner.token, result.undo.editId);
        expect((dto as { contentChange?: unknown }).contentChange).toBeUndefined();
        const listed = (await listChatEdits(owner.token, conversation.id))
            .find((edit) => edit.id === result.undo.editId);
        expect((listed as { contentChange?: unknown } | undefined)?.contentChange).toBeUndefined();
    });
});

describe("edit_note", () => {
    test("replaces only the requested section", async () => {
        const before = await readEditorNote(notes.editable.id);
        const result = await editNoteTool(writeContext(), {
            noteId: notes.editable.id,
            expectedRevision: before.revision,
            operations: [
                { op: "replace_section", heading: "Goals", markdown: "- Three" },
            ],
            summary: "Updated goals",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.changed.sections?.[0]?.heading).toBe("Goals");

        const record = await pbGetRecord<TestRecord>(owner.token, "documents", notes.editable.id);
        const content = String(record.content);
        expect(content).toContain("## Goals\n\n- Three\n\n## Risks\n\nNone yet.");
        expect(content).toContain("Intro line.");
        expect(content).not.toContain("- One");
        expect(content).not.toContain("- Two");
    });

    test("two sequential edits emit distinct, ordered before/after bodies", async () => {
        const note = await createNote(owner, {
            title: "Sequential flash",
            content: "# One\n\nFirst body.",
        });
        const recorder = new ChatRunRecorder();
        const firstRead = await readEditorNote(note.id);
        const first = await editNoteTool(writeContext({ recorder }), {
            noteId: note.id,
            expectedRevision: firstRead.revision,
            operations: [{ op: "replace_section", heading: "One", markdown: "Second body." }],
            summary: "First edit",
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const firstEvent = recorder.drainEdits()[0];
        expect(firstEvent?.contentChange?.before).toBe(firstRead.content);
        expect(firstEvent?.contentChange?.after).toContain("Second body.");

        const secondRead = await readEditorNote(note.id);
        const second = await editNoteTool(writeContext({ recorder }), {
            noteId: note.id,
            expectedRevision: secondRead.revision,
            operations: [{ op: "replace_section", heading: "One", markdown: "Third body." }],
            summary: "Second edit",
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const secondEvent = recorder.drainEdits()[0];
        expect(secondEvent?.contentChange?.before).toBe(secondRead.content);
        expect(secondEvent?.contentChange?.before).toBe(firstEvent?.contentChange?.after);
        expect(secondEvent?.contentChange?.after).toContain("Third body.");
        expect(secondEvent?.contentChange?.after).not.toBe(firstEvent?.contentChange?.after);
        expect(secondEvent?.contentChange?.beforeRevision).toBeGreaterThan(
            firstEvent?.contentChange?.beforeRevision ?? 0,
        );
    });

    test("rejects stale revisions without writing", async () => {
        const before = await readEditorNote(notes.editable.id);
        const stale = before.revision - 1;
        const result = await editNoteTool(writeContext(), {
            noteId: notes.editable.id,
            expectedRevision: stale,
            operations: [{ op: "append", markdown: "stale" }],
            summary: "Should not apply",
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("conflict");

        const record = await pbGetRecord<TestRecord>(owner.token, "documents", notes.editable.id);
        expect(String(record.content)).not.toContain("stale");
        expect(record.revision).toBe(before.revision);
    });

    test("aborts the whole edit on a missing or ambiguous anchor", async () => {
        const before = await readEditorNote(notes.editable.id);
        const missing = await editNoteTool(writeContext(), {
            noteId: notes.editable.id,
            expectedRevision: before.revision,
            operations: [{ op: "replace_section", heading: "No such heading", markdown: "x" }],
            summary: "Missing",
        });
        expect(missing.ok).toBe(false);
        if (missing.ok) return;
        expect(missing.code).toBe("invalid_input");

        const nearMiss = await editNoteTool(writeContext(), {
            noteId: notes.editable.id,
            expectedRevision: before.revision,
            operations: [{ op: "replace_text", find: "Intro  line.", markdown: "Replacement." }],
            summary: "Near miss",
        });
        expect(nearMiss.ok).toBe(false);
        if (nearMiss.ok) return;
        expect(nearMiss.code).toBe("invalid_input");
        expect(nearMiss.message).not.toContain("Intro line.");
        expect(nearMiss.candidates?.map((candidate) => candidate.text)).toContain("Intro line.");

        const ambiguousNote = await createNote(owner, {
            title: "Ambiguous",
            content: "# Top\n\n## Same\n\nA\n\n## Same\n\nB",
        });
        const ambiguousRead = await readEditorNote(ambiguousNote.id);
        const ambiguous = await editNoteTool(writeContext(), {
            noteId: ambiguousNote.id,
            expectedRevision: ambiguousRead.revision,
            operations: [{ op: "replace_section", heading: "Same", markdown: "C" }],
            summary: "Ambiguous",
        });
        expect(ambiguous.ok).toBe(false);
        if (ambiguous.ok) return;
        expect(ambiguous.code).toBe("conflict");

        const unchanged = await pbGetRecord<TestRecord>(owner.token, "documents", notes.editable.id);
        expect(unchanged.revision).toBe(before.revision);
    });

    test("hides private notes and private-folder notes from edits", async () => {
        const recorder = new ChatRunRecorder();
        const privateResult = await appendNoteTool(writeContext({ recorder }), {
            noteId: notes.privateNote.id,
            markdown: "hidden",
            expectedRevision: 1,
        });
        expect(privateResult.ok).toBe(false);
        if (privateResult.ok) return;
        expect(privateResult.code).toBe("not_found");

        const folderResult = await updateNoteTool(writeContext({ recorder }), {
            noteId: notes.folderNote.id,
            expectedRevision: 1,
            title: "Nope",
        });
        expect(folderResult.ok).toBe(false);
        if (folderResult.ok) return;
        expect(folderResult.code).toBe("not_found");
        expect(recorder.drainEdits()).toEqual([]);
    });
});

describe("update_note", () => {
    test("changes title and tags only", async () => {
        const before = await readEditorNote(notes.second.id);
        const recorder = new ChatRunRecorder();
        const result = await updateNoteTool(writeContext({ recorder }), {
            noteId: notes.second.id,
            expectedRevision: before.revision,
            title: "Second note renamed",
            tags: ["renamed"],
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.changed.fields).toEqual(["title", "tags"]);

        const record = await pbGetRecord<TestRecord>(owner.token, "documents", notes.second.id);
        expect(record.title).toBe("Second note renamed");
        expect(record.tags).toEqual(["renamed"]);
        expect(record.content).toBe(before.content);
        expect(record.last_edit_source).toBe("ai");
        expect(recorder.drainEdits()[0]?.contentChange).toBeUndefined();
    });
});

describe("board and task writes", () => {
    test("creates a board with Nana as the actor", async () => {
        const recorder = new ChatRunRecorder();
        const result = await createBoardTool(writeContext({ recorder }), {
            name: "Chat board",
            description: "Made by Nana",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const record = await pbGetRecord<TestRecord>(owner.token, "boards", result.target.id);
        expect(record.name).toBe("Chat board");
        expect(record.author).toBe(owner.id);
        expect(recorder.drainEdits()[0]?.contentChange).toBeUndefined();
    });

    test("creates, updates, and moves a task with AI activity", async () => {
        const recorder = new ChatRunRecorder();
        const created = await createTaskTool(writeContext({ recorder }), {
            boardId: boards.work.id,
            title: "Nana task",
            description: "Do the thing",
            status: "next",
            priority: "high",
            dueDate: "2026-11-02",
            assignee: "me",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(recorder.drainEdits()[0]?.contentChange).toBeUndefined();
        const taskId = created.target.id;
        expect(created.target.type).toBe("task");
        expect(created.target.url).toBe(`/board/${boards.work.id}?task=${taskId}`);

        const updated = await updateTaskTool(writeContext(), {
            taskId,
            status: "progress",
            priority: "urgent",
        });
        expect(updated.ok).toBe(true);
        if (!updated.ok) return;

        const moved = await moveTaskTool(writeContext(), { taskId, status: "done" });
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;

        const activity = await pbList<TestRecord>(owner.token, "task_activity", {
            filter: `task="${taskId}"`,
            sort: "created",
            perPage: 50,
        });
        expect(activity.items.length).toBeGreaterThanOrEqual(3);
        for (const row of activity.items) {
            expect(row.actor_type).toBe("ai");
            expect(row.actor_label).toBe("Nana");
            expect(row.actor).toBeFalsy();
        }
        expect(activity.items.some((row) => row.type === "status_changed")).toBe(true);
    });

    test("rejects archived boards, invalid statuses, and foreign tasks", async () => {
        const archived = await createTaskTool(writeContext(), {
            boardId: boards.archived.id,
            title: "Should fail",
        });
        expect(archived.ok).toBe(false);
        if (archived.ok) return;
        expect(archived.code).toBe("conflict");

        const badStatus = await createTaskTool(writeContext(), {
            boardId: boards.work.id,
            title: "Bad status",
            status: "not-a-column",
        });
        expect(badStatus.ok).toBe(false);
        if (badStatus.ok) return;
        expect(badStatus.code).toBe("invalid_input");

        const foreignTask = await createTask(other, boards.otherBoard.id, {
            title: "Other task",
            status: "backlog",
        });
        const foreign = await updateTaskTool(writeContext(), {
            taskId: foreignTask.id,
            title: "Nope",
        });
        expect(foreign.ok).toBe(false);
        if (foreign.ok) return;
        expect(foreign.code).toBe("not_found");
    });
});

describe("undo and edit cards", () => {
    test("undoing a created note moves it to trash and is idempotent", async () => {
        const created = await createNoteTool(writeContext(), {
            title: "Undo me",
            content: "body",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const editId = created.undo.editId;
        if (!editId) throw new Error("missing edit id");

        const first = await undoChatEdit(ownerContext, editId);
        expect(first.alreadyUndone).toBe(false);
        expect(first.edit.status).toBe("undone");
        expect(first.edit.undo.available).toBe(false);

        expect(await pbRecordExists(owner.token, "documents", created.target.id)).toBe(false);

        const second = await undoChatEdit(ownerContext, editId);
        expect(second.alreadyUndone).toBe(true);
        expect(second.edit.status).toBe("undone");
    });

    test("undoing a note edit restores the snapshot and repeated undo is a no-op", async () => {
        const note = await createNote(owner, {
            title: "Undo restore",
            content: "# Before\n\nOriginal.",
        });
        const before = await readEditorNote(note.id);
        const edited = await editNoteTool(writeContext(), {
            noteId: note.id,
            expectedRevision: before.revision,
            operations: [{ op: "replace_section", heading: "Before", markdown: "Changed." }],
            summary: "Change it",
        });
        expect(edited.ok).toBe(true);
        if (!edited.ok) return;
        const editId = edited.undo.editId;
        if (!editId) throw new Error("missing edit id");

        const afterEdit = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(String(afterEdit.content)).toContain("Changed.");

        const first = await undoChatEdit(ownerContext, editId);
        expect(first.alreadyUndone).toBe(false);
        expect(first.edit.status).toBe("undone");

        const restored = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(restored.title).toBe("Undo restore");
        expect(String(restored.content)).toContain("Original.");
        expect(String(restored.content)).not.toContain("Changed.");
        const revisionAfterUndo = restored.revision;

        const second = await undoChatEdit(ownerContext, editId);
        expect(second.alreadyUndone).toBe(true);
        const still = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(still.revision).toBe(revisionAfterUndo);
    });

    test("lists edit cards oldest first with status and undo availability", async () => {
        const created = await createNoteTool(writeContext(), {
            title: "Card note",
            content: "card",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const editId = created.undo.editId;
        if (!editId) throw new Error("missing edit id");

        const res = await bunRequest(`/api/chat/conversations/${conversation.id}/edits`, {
            headers: { Authorization: owner.token },
        });
        await expectStatus(res, 200);
        const data = await readJson<{ edits: Array<{ id: string; status: string; target: { title: string }; undo: { available: boolean } }> }>(res);
        const ids = data.edits.map((edit) => edit.id);
        expect(ids).toContain(editId);
        expect(ids.indexOf(editId)).toBeGreaterThanOrEqual(0);

        const card = data.edits.find((edit) => edit.id === editId);
        expect(card?.status).toBe("applied");
        expect(card?.target.title).toBe("Card note");
        expect(card?.undo.available).toBe(true);
    });

    test("another user cannot read the edit cards or undo the edit", async () => {
        const created = await createNoteTool(writeContext(), {
            title: "Private card",
            content: "mine",
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const list = await bunRequest(`/api/chat/conversations/${conversation.id}/edits`, {
            headers: { Authorization: other.token },
        });
        await expectStatus(list, 404);

        const undo = await bunRequest(`/api/chat/edits/${created.undo.editId}/undo`, {
            method: "POST",
            headers: { Authorization: other.token },
        });
        await expectStatus(undo, 404);
    });
});

describe("creation tools", () => {
    test("creates a folder and records a folder edit card", async () => {
        const created = await createFolderTool(writeContext(), { name: "Chat-created folder" });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        expect(created.target.type).toBe("folder");
        expect(created.target.url).toBe(`/folders/${created.target.id}`);
        const stored = await pbGetRecord<TestRecord>(owner.token, "folders", created.target.id);
        expect(stored.name).toBe("Chat-created folder");
    });

    test("renames and moves folders", async () => {
        const parent = await createFolder(owner, { name: "Folder parent" });
        const child = await createFolder(owner, { name: "Folder child" });

        const renamed = await renameFolderTool(writeContext(), {
            folderId: child.id,
            name: "Folder child renamed",
        });
        expect(renamed.ok).toBe(true);
        if (!renamed.ok) return;
        expect(renamed.target.title).toBe("Folder child renamed");

        const moved = await moveFolderTool(writeContext(), {
            folderId: child.id,
            parentId: parent.id,
        });
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;
        const stored = await pbGetRecord<TestRecord>(owner.token, "folders", child.id);
        expect(stored.parent).toBe(parent.id);
        expect(stored.name).toBe("Folder child renamed");
    });

    test("moves a note into a folder", async () => {
        const folder = await createFolder(owner, { name: "Note destination" });
        const note = await createNote(owner, { title: "Movable note" });

        const moved = await moveNoteTool(writeContext(), {
            noteId: note.id,
            folderId: folder.id,
        });
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;
        const stored = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(stored.folder).toBe(folder.id);
        expect(moved.target.type).toBe("document");
    });

    test("does not move a note into a private folder", async () => {
        const note = await createNote(owner, { title: "Private move guard" });
        const moved = await moveNoteTool(writeContext(), {
            noteId: note.id,
            folderId: privateFolder.id,
        });
        expect(moved.ok).toBe(false);
        const stored = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(stored.folder ?? "").toBe("");
    });
});

describe("board management", () => {
    test("moves and renames a board", async () => {
        const folder = await createFolder(owner, { name: "Board destination" });
        const board = await createBoard(owner, { name: "Board to organize" });

        const moved = await moveBoardTool(writeContext(), {
            boardId: board.id,
            folderId: folder.id,
        });
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;

        const updated = await updateBoardTool(writeContext(), {
            boardId: board.id,
            name: "Board renamed",
        });
        expect(updated.ok).toBe(true);
        if (!updated.ok) return;
        const stored = await pbGetRecord<TestRecord>(owner.token, "boards", board.id);
        expect(stored.name).toBe("Board renamed");
        expect(stored.folder).toBe(folder.id);
        expect(stored.archived).toBe(false);
    });
});

describe("delete confirmation", () => {
    test("does not delete a note until the pending action is confirmed", async () => {
        const note = await createNote(owner, {
            title: "Confirm delete note",
            content: "# Keep until confirmed",
        });

        const requested = await deleteNoteTool(writeContext(), { noteId: note.id });
        expect(requested.ok).toBe(true);
        if (!requested.ok) return;
        expect(requested.pending).toBe(true);
        expect(requested.actionId).toBeTruthy();

        const pending = (await listChatEdits(ownerContext.authHeader, conversation.id))
            .find((edit) => edit.id === requested.actionId);
        expect(pending?.status).toBe("pending");
        const stillThere = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(String(stillThere.deleted_at ?? "")).toBe("");

        const confirmed = await confirmChatEdit(ownerContext, requested.actionId!);
        expect(confirmed.status).toBe("applied");
        // The owner token no longer sees the trashed document through the live
        // records API; that is the correct post-delete state.
        expect(await pbRecordExists(owner.token, "documents", note.id)).toBe(false);
    });

    test("cancelling a pending delete leaves the note untouched", async () => {
        const note = await createNote(owner, {
            title: "Cancel delete note",
            content: "# Stay",
        });
        const requested = await deleteNoteTool(writeContext(), { noteId: note.id });
        expect(requested.ok).toBe(true);
        if (!requested.ok || !requested.actionId) return;

        const cancelled = await cancelChatEdit(ownerContext, requested.actionId);
        expect(cancelled.status).toBe("cancelled");
        const stillThere = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(String(stillThere.deleted_at ?? "")).toBe("");
    });

    test("another user cannot confirm a pending delete", async () => {
        const note = await createNote(owner, {
            title: "Protected delete note",
            content: "# Protected",
        });
        const requested = await deleteNoteTool(writeContext(), { noteId: note.id });
        expect(requested.ok).toBe(true);
        if (!requested.ok || !requested.actionId) return;

        await expect(confirmChatEdit(otherContext, requested.actionId)).rejects.toThrow();
        const stillThere = await pbGetRecord<TestRecord>(owner.token, "documents", note.id);
        expect(String(stillThere.deleted_at ?? "")).toBe("");
    });
});
