import { describe, expect, test } from "bun:test";
import {
    alignMarkdownToText,
    applyTextChange,
    caretAssocForMarkdown,
    mapOffsetThroughChange,
    mapSelectionThroughChange,
    markdownOffsetToTextOffset,
    minimalTextChange,
    multiTextChanges,
    textOffsetToMarkdownOffset,
    type MarkdownTextSegment,
    type TextChange,
} from "../../src/lib/collaboration/text";

describe("minimalTextChange", () => {
    test("returns null for equal strings", () => {
        expect(minimalTextChange("same", "same")).toBeNull();
        expect(minimalTextChange("", "")).toBeNull();
    });

    test("describes insertions at the start, middle, and end", () => {
        expect(minimalTextChange("Hello world", "Hello brave world")).toEqual({
            from: 6,
            to: 6,
            insert: "brave ",
        });
        expect(minimalTextChange("world", "hello world")).toEqual({
            from: 0,
            to: 0,
            insert: "hello ",
        });
        expect(minimalTextChange("done", "done!")).toEqual({
            from: 4,
            to: 4,
            insert: "!",
        });
    });

    test("describes deletions", () => {
        expect(minimalTextChange("Hello brave world", "Hello world")).toEqual({
            from: 6,
            to: 12,
            insert: "",
        });
        expect(minimalTextChange("prefix-suffix", "suffix")).toEqual({
            from: 0,
            to: 7,
            insert: "",
        });
    });

    test("describes replacements", () => {
        expect(minimalTextChange("the quick fox", "the slow fox")).toEqual({
            from: 4,
            to: 9,
            insert: "slow",
        });
        expect(minimalTextChange("abc123xyz", "abc789xyz")).toEqual({
            from: 3,
            to: 6,
            insert: "789",
        });
    });

    test("keeps surrogate pairs whole", () => {
        const replaced = minimalTextChange("hello 😀 world", "hello 😃 world");
        expect(replaced).toEqual({ from: 6, to: 8, insert: "😃" });
        expect(applyTextChange("hello 😀 world", replaced!)).toBe("hello 😃 world");

        expect(minimalTextChange("a😀b", "ab")).toEqual({ from: 1, to: 3, insert: "" });
        expect(minimalTextChange("a😀b", "a😃b")).toEqual({ from: 1, to: 3, insert: "😃" });
    });
});

describe("applyTextChange", () => {
    test("applies insertions, deletions, and replacements", () => {
        expect(applyTextChange("abcdef", { from: 2, to: 2, insert: "XY" })).toBe("abXYcdef");
        expect(applyTextChange("abcdef", { from: 2, to: 4, insert: "" })).toBe("abef");
        expect(applyTextChange("abcdef", { from: 2, to: 4, insert: "XY" })).toBe("abXYef");
    });

    test("clamps malformed offsets", () => {
        expect(applyTextChange("abcdef", { from: -10, to: 999, insert: "!" })).toBe("!");
        expect(applyTextChange("abcdef", { from: 4, to: 2, insert: "!" })).toBe("abcd!ef");
        expect(applyTextChange("abc", { from: Number.NaN, to: Infinity, insert: "" })).toBe("abc");
        expect(applyTextChange("abc", null as unknown as TextChange)).toBe("abc");
    });
});

describe("mapOffsetThroughChange", () => {
    const replacement: TextChange = { from: 3, to: 5, insert: "XY" };

    test("leaves offsets before and after the change stable", () => {
        expect(mapOffsetThroughChange(1, replacement, -1)).toBe(1);
        expect(mapOffsetThroughChange(1, replacement, 1)).toBe(1);
        expect(mapOffsetThroughChange(8, replacement, -1)).toBe(8);
        expect(mapOffsetThroughChange(8, replacement, 1)).toBe(8);
    });

    test("uses association for offsets inside a replacement", () => {
        expect(mapOffsetThroughChange(4, replacement, -1)).toBe(3);
        expect(mapOffsetThroughChange(4, replacement, 1)).toBe(5);
        expect(mapOffsetThroughChange(3, replacement, -1)).toBe(3);
        expect(mapOffsetThroughChange(3, replacement, 1)).toBe(5);
        expect(mapOffsetThroughChange(5, replacement, -1)).toBe(3);
        expect(mapOffsetThroughChange(5, replacement, 1)).toBe(5);
    });

    test("distinguishes the two sides of an insertion", () => {
        const insertion: TextChange = { from: 3, to: 3, insert: "XY" };
        expect(mapOffsetThroughChange(3, insertion, -1)).toBe(3);
        expect(mapOffsetThroughChange(3, insertion, 1)).toBe(5);
        expect(mapOffsetThroughChange(6, insertion, 1)).toBe(8);
    });

    test("collapses both associations inside a deletion", () => {
        const deletion: TextChange = { from: 3, to: 5, insert: "" };
        expect(mapOffsetThroughChange(4, deletion, -1)).toBe(3);
        expect(mapOffsetThroughChange(4, deletion, 1)).toBe(3);
        expect(mapOffsetThroughChange(7, deletion, 1)).toBe(5);
    });

    test("clamps negative input and tolerates malformed changes", () => {
        expect(mapOffsetThroughChange(-4, replacement, 1)).toBe(0);
        expect(mapOffsetThroughChange(Number.NaN, replacement, 1)).toBe(0);
        expect(mapOffsetThroughChange(4, null as unknown as TextChange, 1)).toBe(4);
    });
});

describe("mapSelectionThroughChange", () => {
    test("keeps a collapsed caret collapsed at an insertion boundary", () => {
        const insertion: TextChange = { from: 3, to: 3, insert: "XY" };

        expect(mapSelectionThroughChange(3, 3, insertion)).toEqual({ anchor: 3, head: 3 });
        expect(mapSelectionThroughChange(6, 6, insertion)).toEqual({ anchor: 8, head: 8 });
    });

    test("anchors a collapsed caret forward through a newline insertion", () => {
        const split: TextChange = { from: 5, to: 5, insert: "\n\n" };

        expect(mapSelectionThroughChange(5, 5, split)).toEqual({ anchor: 7, head: 7 });
        expect(mapSelectionThroughChange(2, 2, split)).toEqual({ anchor: 2, head: 2 });
        expect(mapSelectionThroughChange(8, 8, split)).toEqual({ anchor: 10, head: 10 });
    });

    test("keeps a non-collapsed range from growing over a newline insertion", () => {
        const split: TextChange = { from: 5, to: 5, insert: "\n\n" };

        expect(mapSelectionThroughChange(2, 8, split)).toEqual({ anchor: 2, head: 10 });
    });

    test("keeps the backward bias for a newline replacement", () => {
        const replaced: TextChange = { from: 5, to: 6, insert: "\n\n" };

        expect(mapSelectionThroughChange(5, 5, replaced)).toEqual({ anchor: 5, head: 5 });
    });

    test("shifts both endpoints of a range without collapsing it", () => {
        const insertion: TextChange = { from: 3, to: 3, insert: "XY" };

        expect(mapSelectionThroughChange(5, 8, insertion)).toEqual({ anchor: 7, head: 10 });
    });

    test("collapses a range when the remote edit removes it", () => {
        const deletion: TextChange = { from: 3, to: 8, insert: "" };

        expect(mapSelectionThroughChange(4, 6, deletion)).toEqual({ anchor: 3, head: 3 });
    });
});

describe("alignMarkdownToText", () => {
    test("aligns headings and blank-line-separated paragraphs", () => {
        expect(alignMarkdownToText("# Title\n\nBody text", "Title\nBody text")).toEqual([
            { mdStart: 2, mdEnd: 7, textStart: 0, textEnd: 5 },
            { mdStart: 9, mdEnd: 18, textStart: 6, textEnd: 15 },
        ]);
    });

    test("removes emphasis and link destinations while keeping link labels", () => {
        const markdown = "Some **bold** and [a link](https://example.com).";
        const text = "Some bold and a link.";
        const segments = alignMarkdownToText(markdown, text);

        expect(segments).toEqual([
            { mdStart: 0, mdEnd: markdown.length, textStart: 0, textEnd: text.length },
        ]);
        expect(text.slice(segments[0]!.textStart, segments[0]!.textEnd)).toBe(text);
    });

    test("handles underscore emphasis, strikethrough, and inline code", () => {
        const markdown = "A _very_ ~~old~~ `value` here";
        const text = "A very old value here";

        expect(alignMarkdownToText(markdown, text)).toEqual([
            { mdStart: 0, mdEnd: markdown.length, textStart: 0, textEnd: text.length },
        ]);
    });

    test("removes list markers, task boxes, and blockquote markers", () => {
        const markdown = "- First\n- Second\n  - [ ] Nested";
        expect(alignMarkdownToText(markdown, "First\nSecond\nNested")).toEqual([
            { mdStart: 2, mdEnd: 7, textStart: 0, textEnd: 5 },
            { mdStart: 10, mdEnd: 16, textStart: 6, textEnd: 12 },
            { mdStart: 25, mdEnd: 31, textStart: 13, textEnd: 19 },
        ]);

        expect(alignMarkdownToText("> Quote\n\n1. First", "Quote\nFirst")).toEqual([
            { mdStart: 2, mdEnd: 7, textStart: 0, textEnd: 5 },
            { mdStart: 12, mdEnd: 17, textStart: 6, textEnd: 11 },
        ]);
    });

    test("aligns fenced code content without stripping inline syntax", () => {
        const markdown = "Before\n\n```ts\nconst **x** = 1;\n```\n\nAfter";
        const text = "Before\nconst **x** = 1;\nAfter";
        const segments = alignMarkdownToText(markdown, text);

        expect(segments).toHaveLength(3);
        expect(segments[1]).toEqual({ mdStart: 14, mdEnd: 30, textStart: 7, textEnd: 23 });
        expect(text.slice(segments[1]!.textStart, segments[1]!.textEnd)).toBe("const **x** = 1;");
        expect(segments[2]).toEqual({ mdStart: 36, mdEnd: 41, textStart: 24, textEnd: 29 });
    });

    test("strips HTML tags but keeps their text", () => {
        const markdown = "<span>Hello</span> **world**";
        const text = "Hello world";
        const segments = alignMarkdownToText(markdown, text);

        expect(segments).toHaveLength(1);
        expect(segments[0]!.textStart).toBe(0);
        expect(segments[0]!.textEnd).toBe(text.length);
        expect(segments[0]!.mdStart).toBe(markdown.indexOf("Hello"));
        expect(segments[0]!.mdEnd).toBe(markdown.lastIndexOf("d") + 1);
    });

    test("skips structural-only lines", () => {
        const markdown = "---\n\n[ref]: https://example.com\n\n| a | b |\n| --- | --- |\n\nVisible";
        expect(alignMarkdownToText(markdown, "Visible")).toEqual([
            {
                mdStart: markdown.indexOf("Visible"),
                mdEnd: markdown.indexOf("Visible") + "Visible".length,
                textStart: 0,
                textEnd: "Visible".length,
            },
        ]);
    });

    test("tolerates whitespace differences between source and prose", () => {
        const markdown = "first    line\n\nsecond\tline";
        const text = "first line\nsecond line";
        const segments = alignMarkdownToText(markdown, text);

        expect(segments).toHaveLength(2);
        expect(text.slice(segments[0]!.textStart, segments[0]!.textEnd)).toBe("first line");
        expect(text.slice(segments[1]!.textStart, segments[1]!.textEnd)).toBe("second line");
    });
});

describe("offset mapping", () => {
    test("round-trips cursor offsets in prose lines", () => {
        const markdown = "# Intro\n\nSimple paragraph.\n\n- Item one";
        const text = "Intro\nSimple paragraph.\nItem one";
        const segments = alignMarkdownToText(markdown, text);
        expect(segments).toHaveLength(3);

        for (const segment of segments) {
            for (let offset = segment.textStart; offset < segment.textEnd; offset += 1) {
                const markdownOffset = textOffsetToMarkdownOffset(segments, offset);
                expect(markdownOffset).not.toBeNull();
                expect(markdownOffsetToTextOffset(segments, markdownOffset!)).toBe(offset);
            }

            for (let offset = segment.mdStart; offset < segment.mdEnd; offset += 1) {
                const textOffset = markdownOffsetToTextOffset(segments, offset);
                expect(textOffset).not.toBeNull();
                expect(textOffsetToMarkdownOffset(segments, textOffset!)).toBe(offset);
            }
        }
    });

    test("maps offsets proportionally inside a formatted line", () => {
        const markdown = "A **bold** line";
        const text = "A bold line";
        const segment = alignMarkdownToText(markdown, text)[0]!;

        expect(markdownOffsetToTextOffset([segment], markdown.indexOf("bold") + 2)).toBe(
            text.indexOf("bold") + 2,
        );
        expect(textOffsetToMarkdownOffset([segment], text.indexOf("line"))).toBe(10);
        expect(textOffsetToMarkdownOffset([segment], text.length - 1)).toBe(markdown.length - 1);
    });

    test("maps offsets in small gaps to the nearest segment boundary", () => {
        const segments = alignMarkdownToText("One\n\nTwo", "One\nTwo");
        expect(segments).toHaveLength(2);

        expect(markdownOffsetToTextOffset(segments, 4)).toBe(3);
        expect(textOffsetToMarkdownOffset(segments, 3)).toBe(3);
    });

    test("returns null for offsets far outside aligned content", () => {
        const sourceGap = "One" + "\n".repeat(10) + "Two";
        const sourceSegments = alignMarkdownToText(sourceGap, "One\nTwo");
        expect(markdownOffsetToTextOffset(sourceSegments, 8)).toBeNull();

        const textGap = "One" + "\n".repeat(10) + "Two";
        const textSegments = alignMarkdownToText("One\n\nTwo", textGap);
        expect(textOffsetToMarkdownOffset(textSegments, 8)).toBeNull();
    });
});

describe("caretAssocForMarkdown", () => {
    test("uses left affinity at line ends and right affinity mid-line", () => {
        expect(caretAssocForMarkdown("alpha beta", 0)).toBe(1);
        expect(caretAssocForMarkdown("alpha beta", 3)).toBe(1);
        expect(caretAssocForMarkdown("alpha\nbeta", 5)).toBe(-1);
        expect(caretAssocForMarkdown("alpha\r\nbeta", 5)).toBe(-1);
        expect(caretAssocForMarkdown("alpha\nbeta", 6)).toBe(1);
        expect(caretAssocForMarkdown("alpha", 5)).toBe(-1);
        expect(caretAssocForMarkdown("", 0)).toBe(-1);
        expect(caretAssocForMarkdown("alpha", null)).toBe(-1);
    });
});

describe("multiTextChanges", () => {
    test("reports no changes for equal bodies", () => {
        expect(multiTextChanges("same", "same")).toEqual([]);
    });

    test("splits separate line edits into separate hunks", () => {
        expect(multiTextChanges(
            "one\ntwo\nthree\nfour\nfive",
            "oneA\ntwo\nthree\nfourB\nfive",
        )).toEqual([
            { from: 3, to: 3, insert: "A" },
            { from: 18, to: 18, insert: "B" },
        ]);
    });

    test("preserves exact text for insertions, deletions, and CRLF", () => {
        const current = "one\r\ntwo\r\nthree\r\n";
        const next = "one\r\ntwo\r\nthreeB\r\n";
        const changes = multiTextChanges(current, next);

        expect(changes).toEqual([{ from: 15, to: 15, insert: "B" }]);
        let result = current;
        for (const change of [...changes].reverse()) {
            result = applyTextChange(result, change);
        }
        expect(result).toBe(next);
    });

    test("falls back to one exact splice over the diff cell cap", () => {
        const current = "a\n".repeat(1_000);
        const next = `${current}Z`;
        const changes = multiTextChanges(current, next);

        expect(changes).toHaveLength(1);
        expect(changes[0]).toEqual({ from: current.length, to: current.length, insert: "Z" });
    });
});

describe("malformed and empty input", () => {
    test("empty or non-string input yields no segments", () => {
        expect(alignMarkdownToText("", "text")).toEqual([]);
        expect(alignMarkdownToText("# Heading", "")).toEqual([]);
        expect(alignMarkdownToText(null as unknown as string, undefined as unknown as string)).toEqual([]);
        expect(alignMarkdownToText("```", "unclosed")).toEqual([]);
    });

    test("offset mapping handles empty and invalid segments", () => {
        expect(markdownOffsetToTextOffset([], 0)).toBeNull();
        expect(textOffsetToMarkdownOffset([], 0)).toBeNull();
        expect(markdownOffsetToTextOffset(null as unknown as MarkdownTextSegment[], 0)).toBeNull();
        expect(textOffsetToMarkdownOffset([], Number.NaN)).toBeNull();

        const invalid = [{ mdStart: Number.NaN, mdEnd: 1, textStart: 0, textEnd: 1 }];
        expect(markdownOffsetToTextOffset(invalid, 0)).toBeNull();
        expect(textOffsetToMarkdownOffset(invalid, 0)).toBeNull();
    });
});
