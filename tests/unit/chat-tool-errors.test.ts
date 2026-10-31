import { describe, expect, test } from "bun:test";
import { sanitizeToolError } from "../../src/api/chat/types";

describe("sanitizeToolError", () => {
    test("drops non-string and blank failures", () => {
        expect(sanitizeToolError(undefined)).toBeUndefined();
        expect(sanitizeToolError(null)).toBeUndefined();
        expect(sanitizeToolError({ message: "not a string" })).toBeUndefined();
        expect(sanitizeToolError("")).toBeUndefined();
        expect(sanitizeToolError(" \n\t ")).toBeUndefined();
        expect(sanitizeToolError("\u0000\u001f\u007f")).toBeUndefined();
    });

    test("flattens control characters and whitespace", () => {
        expect(sanitizeToolError("\u0000  Read\n\tfailed \u007f badly  "))
            .toBe("Read failed badly");
    });

    test("keeps ordinary punctuation and Unicode text", () => {
        expect(sanitizeToolError("Couldn't read “Plan” — try again."))
            .toBe("Couldn't read “Plan” — try again.");
    });

    test("bounds the persisted failure to 200 characters", () => {
        const result = sanitizeToolError(`failed ${"x".repeat(500)}`);
        expect(result).toBe(`failed ${"x".repeat(193)}`);
        expect(result?.length).toBe(200);
    });
});
