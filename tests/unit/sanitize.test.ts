import { describe, expect, test } from "bun:test";
import { sanitizeHtml } from "../../src/lib/sanitize";

describe("sanitizeHtml", () => {
    test("removes script and style blocks", async () => {
        const html = await sanitizeHtml(
            '<script>alert("x")</script><style>p{color:red}</style><p>Safe</p>',
        );

        expect(html).toContain("Safe");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<style");
        expect(html).not.toContain("alert");
    });

    test("removes event handlers and unsafe URLs", async () => {
        const html = await sanitizeHtml(
            '<p onclick="steal()">Text</p><a href="javascript:alert(1)">link</a>',
        );

        expect(html).toContain("Text");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain("javascript:");
    });

    test("keeps ordinary formatting and links", async () => {
        const html = await sanitizeHtml(
            '<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>',
        );

        expect(html).toContain("<strong>world</strong>");
        expect(html).toContain('href="https://example.com"');
    });

    test("passes plain Markdown through unchanged", async () => {
        const markdown = "# Title\n\nA **bold** line and a [link](https://example.com).";
        expect(await sanitizeHtml(markdown)).toBe(markdown);
    });
});
