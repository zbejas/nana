import { describe, expect, test } from "bun:test";
import {
    isRevisionConflict,
    mergeConcurrentMarkdown,
    needsConcurrentMerge,
} from "../../src/lib/collaboration/merge";

describe("mergeConcurrentMarkdown", () => {
    test("keeps non-overlapping edits from both writers", () => {
        const base = "one\ntwo\nthree\nfour";
        const local = "one\ntwo local\nthree\nfour";
        const remote = "one\ntwo\nthree\nfour remote";
        expect(mergeConcurrentMarkdown(base, local, remote)).toBe(
            "one\ntwo local\nthree\nfour remote",
        );
    });

    test("keeps the local draft when both edit the same line", () => {
        const base = "one\ntwo\nthree";
        const local = "one\nlocal two\nthree";
        const remote = "one\nremote two\nthree";
        expect(mergeConcurrentMarkdown(base, local, remote)).toBe(
            "one\nlocal two\nthree",
        );
    });

    test("adopts the remote side when the local side is untouched", () => {
        const base = "one\ntwo";
        expect(mergeConcurrentMarkdown(base, base, "one\nremote")).toBe("one\nremote");
    });

    test("adopts the local side when the remote side is untouched", () => {
        const base = "one\ntwo";
        expect(mergeConcurrentMarkdown(base, "one\nlocal", base)).toBe("one\nlocal");
    });

    test("handles insertions at different ends", () => {
        const base = "middle";
        expect(mergeConcurrentMarkdown(base, "top\nmiddle", "middle\nbottom")).toBe(
            "top\nmiddle\nbottom",
        );
    });

    test("keeps one copy of identical insertions at the same point", () => {
        const base = "one\ntwo\nthree\nfour";
        const local = "one local\ntwo\ninserted\nthree\nfour";
        const remote = "one\ntwo\ninserted\nthree\nfour remote";
        expect(mergeConcurrentMarkdown(base, local, remote)).toBe(
            "one local\ntwo\ninserted\nthree\nfour remote",
        );
    });

    test("keeps the local insertion when both sides insert at the same point", () => {
        const base = "one\ntwo";
        const local = "one\nlocal insert\ntwo";
        const remote = "one\nremote insert\ntwo";
        expect(mergeConcurrentMarkdown(base, local, remote)).toBe(
            "one\nlocal insert\ntwo",
        );
    });

    test("keeps the local replacement when a remote insertion lands on a replaced-line boundary", () => {
        const base = "one\ntwo\nthree\nfour";
        const local = "one\nTWO\nTHREE\nfour";
        const remote = "one\ntwo\ninserted\nthree\nfour";
        expect(mergeConcurrentMarkdown(base, local, remote)).toBe(
            "one\nTWO\nTHREE\nfour",
        );
    });

    test("handles empty and whitespace-only documents", () => {
        expect(mergeConcurrentMarkdown("", "", "remote")).toBe("remote");
        expect(mergeConcurrentMarkdown("", "local", "")).toBe("local");
        expect(mergeConcurrentMarkdown("base", "base", "base")).toBe("base");
    });

    test("reports when both sides moved", () => {
        expect(needsConcurrentMerge("a", "a local", "a remote")).toBe(true);
        expect(needsConcurrentMerge("a", "a", "a remote")).toBe(false);
        expect(needsConcurrentMerge("a", "a local", "a")).toBe(false);
    });
});

describe("isRevisionConflict", () => {
    test("recognizes the PocketBase revision guard message", () => {
        expect(isRevisionConflict({
            status: 400,
            message: "This note changed since it was loaded. Reload it and try again.",
        })).toBe(true);
        expect(isRevisionConflict({
            status: 400,
            data: { message: "This note changed since it was loaded." },
        })).toBe(true);
    });

    test("ignores unrelated failures", () => {
        expect(isRevisionConflict({ status: 400, message: "Failed to save" })).toBe(false);
        expect(isRevisionConflict({ status: 500, message: "changed since it was loaded" })).toBe(false);
        expect(isRevisionConflict(null)).toBe(false);
        expect(isRevisionConflict("failure")).toBe(false);
    });
});
