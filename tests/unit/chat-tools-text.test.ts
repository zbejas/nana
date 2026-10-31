import { describe, expect, test } from "bun:test";
import {
    clampInt,
    createToolSignal,
    escapeFilterString,
    isValidRecordId,
    normalizeStringList,
    plainTextExcerpt,
    truncate,
} from "../../src/api/chat/tools/text";

describe("escapeFilterString", () => {
    test("leaves ordinary values unchanged", () => {
        expect(escapeFilterString("Alpha Planning")).toBe("Alpha Planning");
    });

    test("escapes double quotes and backslashes", () => {
        expect(escapeFilterString('a"b')).toBe('a\\"b');
        expect(escapeFilterString("a\\b")).toBe("a\\\\b");
    });

    test("neutralises a filter-injection attempt", () => {
        expect(escapeFilterString('"; author != "')).toBe('\\"; author != \\"');
    });
});

describe("isValidRecordId", () => {
    test("accepts PocketBase-sized alphanumeric ids", () => {
        expect(isValidRecordId("abc123")).toBe(true);
        expect(isValidRecordId("A".repeat(64))).toBe(true);
    });

    test("rejects empty, oversized, and punctuated ids", () => {
        expect(isValidRecordId("")).toBe(false);
        expect(isValidRecordId("A".repeat(65))).toBe(false);
        expect(isValidRecordId('bad"id')).toBe(false);
        expect(isValidRecordId("bad-id")).toBe(false);
        expect(isValidRecordId("bad id")).toBe(false);
    });

    test("rejects non-string values", () => {
        expect(isValidRecordId(123)).toBe(false);
        expect(isValidRecordId(null)).toBe(false);
        expect(isValidRecordId(undefined)).toBe(false);
    });
});

describe("truncate", () => {
    test("returns short values unchanged", () => {
        expect(truncate("short", 10)).toBe("short");
        expect(truncate("exact", 5)).toBe("exact");
    });

    test("trims and adds an ellipsis when clipping", () => {
        expect(truncate("abcdefghij", 6)).toBe("abcde…");
    });

    test("does not split a surrogate pair", () => {
        const result = truncate("😀😀😀", 3);
        expect(result.endsWith("…")).toBe(true);
        expect(result).not.toContain("\uFFFD");
    });
});

describe("plainTextExcerpt", () => {
    test("strips scripts, styles, tags, and code fences", () => {
        const value = [
            '<script>alert("x")</script>',
            "<style>p{color:red}</style>",
            "```ts\nconst secret = 1;\n```",
            "<p>Hello <strong>world</strong></p>",
        ].join("\n");

        const excerpt = plainTextExcerpt(value);
        expect(excerpt).toBe("Hello world");
        expect(excerpt).not.toContain("alert");
        expect(excerpt).not.toContain("color:red");
        expect(excerpt).not.toContain("secret");
    });

    test("turns Markdown links into their labels and drops images", () => {
        const excerpt = plainTextExcerpt("See [the docs](https://example.com) ![logo](logo.png)");
        expect(excerpt).toBe("See the docs");
    });

    test("removes heading, quote, and emphasis markers", () => {
        const excerpt = plainTextExcerpt("## Title\n\n> quoted **bold** and _italic_ and ~~gone~~");
        expect(excerpt).toBe("Title quoted bold and italic and gone");
    });

    test("decodes common HTML entities", () => {
        expect(plainTextExcerpt("Build &amp; test&nbsp;the &quot;page&quot;")).toBe(
            'Build & test the "page"',
        );
    });

    test("collapses whitespace and enforces the character cap", () => {
        const excerpt = plainTextExcerpt("one\n\n two   three", 8);
        expect(excerpt).toBe("one two…");
        expect(excerpt.length).toBeLessThanOrEqual(8);
    });
});

describe("normalizeStringList", () => {
    test("trims, drops empties and non-strings, and deduplicates", () => {
        expect(normalizeStringList([" work ", "", 42, "work", "urgent"])).toEqual([
            "work",
            "urgent",
        ]);
    });

    test("caps item count", () => {
        expect(normalizeStringList(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    });

    test("clips long items", () => {
        const [item] = normalizeStringList(["x".repeat(100)], 10, 10);
        expect(item).toBe("xxxxxxxxx…");
    });

    test("returns an empty list for non-array values", () => {
        expect(normalizeStringList(null)).toEqual([]);
        expect(normalizeStringList({ 0: "a" })).toEqual([]);
    });
});

describe("clampInt", () => {
    test("truncates finite numbers", () => {
        expect(clampInt(3.9, 1, 10, 5)).toBe(3);
        expect(clampInt(-3.9, -10, 10, 0)).toBe(-3);
    });

    test("clamps to the range", () => {
        expect(clampInt(0, 1, 10, 5)).toBe(1);
        expect(clampInt(99, 1, 10, 5)).toBe(10);
    });

    test("falls back for non-numeric values", () => {
        expect(clampInt("5", 1, 10, 5)).toBe(5);
        expect(clampInt(Number.NaN, 1, 10, 5)).toBe(5);
        expect(clampInt(Number.POSITIVE_INFINITY, 1, 10, 5)).toBe(5);
        expect(clampInt(undefined, 1, 10, 5)).toBe(5);
    });
});

describe("createToolSignal", () => {
    test("returns a live signal when no external signal is supplied", () => {
        const signal = createToolSignal();
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
    });

    test("aborts when the caller's signal aborts", () => {
        const controller = new AbortController();
        const signal = createToolSignal(controller.signal);
        expect(signal.aborted).toBe(false);

        controller.abort();
        expect(signal.aborted).toBe(true);
    });
});
