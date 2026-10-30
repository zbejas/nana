import { describe, expect, test } from "bun:test";
import { rehypeNormalizeAlertClasses } from "../../src/lib/sanitize";

describe("Markdown alerts", () => {
    test("normalizes the class property emitted by remark-github-blockquote-alert", () => {
        const tree = {
            type: "root",
            children: [
                {
                    type: "element",
                    tagName: "div",
                    properties: { class: "markdown-alert markdown-alert-warning", dir: "auto" },
                    children: [],
                },
            ],
        };

        rehypeNormalizeAlertClasses()(tree);

        expect(tree.children[0]?.properties.className).toEqual([
            "markdown-alert",
            "markdown-alert-warning",
        ]);
        expect(tree.children[0]?.properties.class).toBeUndefined();
    });

    test("leaves unrelated class values alone", () => {
        const tree = {
            type: "root",
            children: [
                {
                    type: "element",
                    tagName: "div",
                    properties: { class: "other" },
                    children: [],
                },
            ],
        };

        rehypeNormalizeAlertClasses()(tree);

        expect(tree.children[0]?.properties.class).toBe("other");
        expect(tree.children[0]?.properties.className).toBeUndefined();
    });
});
