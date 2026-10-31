import { describe, expect, test } from "bun:test";
import { generateSlug } from "../../src/lib/documents/utils";

describe("generateSlug", () => {
    test("lowercases and hyphenates words", () => {
        expect(generateSlug("My First Note")).toBe("my-first-note");
    });

    test("collapses punctuation and repeated separators", () => {
        expect(generateSlug("Hello,   world!! -- again")).toBe("hello-world-again");
    });

    test("removes leading and trailing separators", () => {
        expect(generateSlug("  --Hello--  ")).toBe("hello");
    });

    test("strips non-ASCII characters consistently", () => {
        expect(generateSlug("Résumé 日本")).toBe("r-sum");
    });

    test("falls back to untitled for empty titles", () => {
        expect(generateSlug("")).toBe("untitled");
        expect(generateSlug("   ")).toBe("untitled");
        expect(generateSlug(null)).toBe("untitled");
        expect(generateSlug(undefined)).toBe("untitled");
    });
});
