import { describe, expect, test } from "bun:test";
import { plainTextExcerpt, stripMarkdown } from "../../src/lib/tasks/text";

describe("stripMarkdown", () => {
    test("removes code fences, images, and link targets", () => {
        expect(
            stripMarkdown("```ts\nconst x = 1;\n```\n![logo](logo.png) [docs](https://example.com)"),
        ).toBe("docs");
    });

    test("removes common Markdown markers", () => {
        expect(stripMarkdown("# Title\n\n> quoted **bold** _italic_ ~~gone~~ `code`")).toBe(
            "Title\n\nquoted bold italic gone code",
        );
    });

    test("removes list markers and checkboxes", () => {
        expect(stripMarkdown("- [x] Done\n- [ ] Next\n1. First\n2. Second")).toBe(
            "Done\nNext\nFirst\nSecond",
        );
    });

    test("collapses three or more newlines to a paragraph break", () => {
        expect(stripMarkdown("one\n\n\n\n two")).toBe("one\n\n two");
    });

    test("handles empty and nullish values", () => {
        expect(stripMarkdown("")).toBe("");
        expect(stripMarkdown(undefined as unknown as string)).toBe("");
    });
});

describe("plainTextExcerpt", () => {
    test("collapses whitespace into a single line", () => {
        expect(plainTextExcerpt("one\n\n two\tthree")).toBe("one two three");
    });

    test("clips long descriptions with an ellipsis", () => {
        const excerpt = plainTextExcerpt("word ".repeat(20), 20);
        expect(excerpt.length).toBeLessThanOrEqual(20);
        expect(excerpt.endsWith("…")).toBe(true);
    });

    test("returns short descriptions unchanged", () => {
        expect(plainTextExcerpt("short", 20)).toBe("short");
    });
});
