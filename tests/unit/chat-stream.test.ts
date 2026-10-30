import { describe, expect, test } from "bun:test";
import {
    ChatStreamState,
    doneEvent,
    sseEvent,
    stepUsage,
    textEvent,
    toolEvent,
} from "../../src/api/chat/stream";

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
