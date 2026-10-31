import { describe, expect, test } from "bun:test";
import { noteVersionToken, revisionMatches } from "../../src/api/chat/tools/version";

describe("noteVersionToken", () => {
    const base = {
        title: "Plan",
        content: "# Plan\n\nBody",
        tags: ["work"],
        updated: "2026-10-30 10:00:00.000Z",
    };

    test("is deterministic and bounded", () => {
        const first = noteVersionToken(base);
        const second = noteVersionToken({ ...base, tags: ["work"] });
        expect(first).toBe(second);
        expect(first).toMatch(/^[a-f0-9]{32}$/);
    });

    test("changes when any bound field changes", () => {
        const token = noteVersionToken(base);
        expect(noteVersionToken({ ...base, title: "Plan 2" })).not.toBe(token);
        expect(noteVersionToken({ ...base, content: "# Plan\n\nChanged" })).not.toBe(token);
        expect(noteVersionToken({ ...base, tags: ["work", "urgent"] })).not.toBe(token);
        expect(noteVersionToken({ ...base, updated: "2026-10-30 10:00:01.000Z" })).not.toBe(token);
    });

    test("tolerates missing fields and non-string values", () => {
        expect(noteVersionToken({})).toMatch(/^[a-f0-9]{32}$/);
        expect(noteVersionToken({ title: 42, content: null, tags: "work" })).toMatch(/^[a-f0-9]{32}$/);
    });
});

describe("revisionMatches", () => {
    const current = { revision: 4, versionToken: "abc123" };

    test("accepts the numeric revision or numeric string", () => {
        expect(revisionMatches(4, current)).toBe(true);
        expect(revisionMatches("4", current)).toBe(true);
    });

    test("accepts the opaque token", () => {
        expect(revisionMatches("abc123", current)).toBe(true);
    });

    test("rejects stale revisions, empty values, and other tokens", () => {
        expect(revisionMatches(3, current)).toBe(false);
        expect(revisionMatches("5", current)).toBe(false);
        expect(revisionMatches("", current)).toBe(false);
        expect(revisionMatches("other", current)).toBe(false);
    });
});
