import { describe, expect, test } from "bun:test";
import {
    ChatStreamState,
    doneEvent,
    editEvent,
    sseEvent,
    stepUsage,
    textEvent,
    toolEvent,
} from "../../src/api/chat/stream";
import {
    MAX_EDIT_CONTENT_CHARS,
    MAX_EDIT_CONTENT_TOTAL_CHARS,
    boundEditContentChange,
} from "../../src/api/chat/edit-content";
import type { ChatEditDto } from "../../src/api/chat/types";

function editFixture(overrides: Partial<ChatEditDto> = {}): ChatEditDto {
    return {
        id: "edit1",
        conversationId: "conv1",
        messageId: null,
        target: {
            type: "document",
            id: "note1",
            title: "Note",
            url: "/document/note1",
        },
        tool: "edit_note",
        summary: "Updated a section.",
        status: "applied",
        actorType: "ai",
        actorLabel: "Nana",
        changed: { sections: [{ heading: "Goals", path: ["Goals"], op: "replace_section", from: 1, to: 2 }] },
        undo: { kind: "restore", available: true },
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("chat SSE encoding", () => {
    test("emits a named event and a legacy chunk", () => {
        const block = textEvent("hello");
        expect(block).toContain("event: text\n");
        expect(block).toContain('data: {"type":"text","delta":"hello"}\n\n');
        expect(block).toContain('data: {"type":"text-delta","id":"text","delta":"hello"}\n\n');
    });

    test("can omit legacy chunks for mode-aware clients", () => {
        const block = textEvent("hello", false);
        expect(block).toContain("event: text\n");
        expect(block).not.toContain("text-delta");
    });

    test("keeps the tool activity shape", () => {
        const running = toolEvent({ id: "call-1", name: "read_note", status: "running" });
        expect(running).toContain('"type":"tool"');
        expect(running).toContain('"status":"running"');
        expect(running).toContain('"tool-input-start"');

        const failed = toolEvent({
            id: "call-1",
            name: "edit_note",
            status: "error",
            error: "stale",
        });
        expect(failed).toContain('"status":"error"');
        expect(failed).toContain('"type":"tool-output-error"');
    });

    test("done carries the conversation, message, stop flag, and sources", () => {
        const block = doneEvent({
            conversationId: "conv1",
            messageId: "msg1",
            stopped: true,
            model: "m",
            sources: [{ type: "document", id: "note1", title: "Note" }],
            usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        });
        expect(block).toContain("event: done\n");
        expect(block).toContain('"stopped":true');
        expect(block).toContain('"messageId":"msg1"');
        expect(block).toContain('"usage":{"inputTokens":120,"outputTokens":30,"totalTokens":150}');
        expect(block).toContain("data: [DONE]");
    });

    test("maps one provider step to bounded context usage", () => {
        expect(stepUsage({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            inputTokenDetails: { cacheReadTokens: 10 },
            outputTokenDetails: { reasoningTokens: 5 },
        })).toEqual({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            reasoningTokens: 5,
            cachedInputTokens: 10,
        });
        expect(stepUsage({})).toBeNull();
    });

    test("sseEvent rejects nothing and always adds the type", () => {
        expect(sseEvent("sources", { sources: [] })).toBe(
            'event: sources\ndata: {"type":"sources","sources":[]}\n\n',
        );
    });
});

describe("chat edit event content", () => {
    test("carries document body before/after outside the persisted edit DTO", () => {
        const block = editEvent(editFixture(), {
            before: "# Note\n\nOld body.",
            after: "# Note\n\nNew body.",
            beforeRevision: 2,
            afterRevision: 3,
        });
        expect(block).toContain("event: edit\n");
        expect(block).toContain('"contentChange":{"before":"# Note\\n\\nOld body.","after":"# Note\\n\\nNew body.","beforeRevision":2,"afterRevision":3}');
        expect(block).toContain('"edit":{');
        expect(block).toContain('"tool":"edit_note"');
    });

    test("metadata-only, board, and task events carry no body pair", () => {
        const metadata = editEvent(editFixture({ tool: "update_note" }));
        const board = editEvent(editFixture({
            tool: "create_board",
            target: { type: "board", id: "board1", title: "Board", url: "/board/board1" },
        }));
        const task = editEvent(editFixture({
            tool: "update_task",
            target: { type: "task", id: "task1", title: "Task", url: "/board/board1?task=task1" },
        }));
        for (const block of [metadata, board, task]) {
            expect(block).not.toContain("contentChange");
            expect(block).not.toContain("contentChangeOmitted");
        }
    });

    test("omits an over-cap pair and flags the fallback", () => {
        const block = editEvent(editFixture(), {
            before: "a".repeat(MAX_EDIT_CONTENT_CHARS + 1),
            after: "b",
        });
        expect(block).toContain('"contentChangeOmitted":true');
        expect(block).not.toContain('"contentChange":{"before"');
        expect(block).not.toContain("a".repeat(32));

        const combined = boundEditContentChange({
            before: "a".repeat(MAX_EDIT_CONTENT_TOTAL_CHARS / 2 + 1),
            after: "b".repeat(MAX_EDIT_CONTENT_TOTAL_CHARS / 2 + 1),
        });
        expect(combined).toEqual({ contentChangeOmitted: true });
    });

    test("accepts pairs at the per-body and total caps", () => {
        const half = MAX_EDIT_CONTENT_TOTAL_CHARS / 2;
        expect(boundEditContentChange({
            before: "a".repeat(half),
            after: "b".repeat(half),
        })).toEqual({
            contentChange: {
                before: "a".repeat(half),
                after: "b".repeat(half),
            },
        });
    });

    test("persisted message parts keep only the edit id, never the bodies", () => {
        const state = new ChatStreamState();
        state.addEdit(editFixture());
        state.addText("Done.");
        const parts = state.persistedParts("Done.");
        expect(parts).toContainEqual({ type: "edit", editId: "edit1" });
        expect(JSON.stringify(parts)).not.toContain("before");
        expect(JSON.stringify(parts)).not.toContain("contentChange");
    });
});

describe("ChatStreamState", () => {
    test("accumulates text and reasoning", () => {
        const state = new ChatStreamState();
        state.addText("Hello ");
        state.addText("world");
        state.addReasoning("thinking");
        expect(state.text).toBe("Hello world");
        expect(state.reasoning).toBe("thinking");
    });

    test("keeps call order, deduplicates names, and lets an error win", () => {
        const state = new ChatStreamState();
        state.addToolStart("1", "list_notes");
        state.addToolResult("1", "list_notes", true);
        state.addToolStart("2", "edit_note");
        state.addToolError("2", "edit_note", "conflict");
        state.addToolStart("3", "list_notes");
        state.addToolResult("3", "list_notes", true);

        expect(state.toolEvents().map((event) => `${event.name}:${event.status}`)).toEqual([
            "list_notes:success",
            "edit_note:error",
            "list_notes:success",
        ]);
        expect(state.toolActivity()).toEqual([
            { name: "list_notes", status: "success" },
            { name: "edit_note", status: "error" },
        ]);
    });

    test("treats a tool that never finished as an error in persisted activity", () => {
        const state = new ChatStreamState();
        state.addToolStart("1", "read_board");
        expect(state.toolActivity()).toEqual([{ name: "read_board", status: "error" }]);
    });

    test("interleaves text and tool calls in the order they streamed", () => {
        const state = new ChatStreamState();
        state.addText("Checking the notes.");
        state.addToolStart("1", "list_notes");
        state.addToolResult("1", "list_notes", true);
        state.addText(" Here is the answer.");

        expect(state.parts).toEqual([
            { type: "text", text: "Checking the notes." },
            { type: "tool", id: "1", name: "list_notes", status: "success" },
            { type: "text", text: " Here is the answer." },
        ]);
    });

    test("adds the fallback text and closes unfinished calls in persisted parts", () => {
        const state = new ChatStreamState();
        state.addToolStart("1", "read_note");

        expect(state.persistedParts("I couldn't finish that answer.")).toEqual([
            { type: "tool", id: "1", name: "read_note", status: "error" },
            { type: "text", text: "I couldn't finish that answer." },
        ]);
    });
});
