import { describe, expect, test } from "bun:test";
import type { Ctx } from "@milkdown/kit/ctx";
import {
    editorStateCtx,
    editorViewCtx,
    parserCtx,
    serializerCtx,
} from "@milkdown/kit/core";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { Transform } from "@milkdown/kit/prose/transform";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import {
    applyDocumentSyncSteps,
    replaceEditorMarkdownPreservingSelection,
    caretAssocForMarkdown,
    contentEmptyParagraphIndices,
    editorPositionForPresenceOffset,
    emptyParagraphMarkers,
    hasTrailingEmptyParagraph,
    isTrailingTypingParagraph,
    mapSelectionThroughDocuments,
    planDocumentSync,
    presenceMarkdownOffsetForEditorPosition,
    presenceWidgetSide,
    reconcileEditorTarget,
    trailingTypingParagraphPosition,
    withSuppressedDocumentChange,
    type DocumentSyncPlan,
} from "../../src/components/editor/milkdown/createEditor";

const schema = new Schema({
    nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        heading: {
            content: "inline*",
            group: "block",
            attrs: { level: { default: 1 } },
            defining: true,
        },
        bullet_list: { content: "list_item+", group: "block" },
        list_item: { content: "paragraph block*" },
        code_block: { content: "text*", group: "block", marks: "" },
        text: { group: "inline" },
        hardbreak: { inline: true, group: "inline" },
    },
});

function paragraph(text = ""): ProseNode {
    return schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);
}

function heading(text: string, level = 1): ProseNode {
    return schema.nodes.heading!.create({ level }, text ? schema.text(text) : null);
}

function bulletList(...items: ProseNode[]): ProseNode {
    return schema.nodes.bullet_list!.create(null, items);
}

function codeBlock(text = ''): ProseNode {
    return schema.nodes.code_block!.create(null, text ? schema.text(text) : null);
}

function docOf(...nodes: ProseNode[]): ProseNode {
    return schema.nodes.doc!.create(null, nodes);
}

/** Position of `offset` characters into the first textblock containing `text`. */
function positionInTextblock(doc: ProseNode, text: string, offset: number): number {
    let position = -1;
    doc.descendants((node, pos) => {
        if (position === -1 && node.isTextblock && node.textContent === text) {
            position = pos + 1 + offset;
        }
    });
    expect(position).toBeGreaterThanOrEqual(0);
    return position;
}

function mappedSelection(
    oldDoc: ProseNode,
    newDoc: ProseNode,
    anchor: number,
    head: number,
    assoc: -1 | 1 = -1,
) {
    const mapped = mapSelectionThroughDocuments(oldDoc, newDoc, { anchor, head }, assoc);
    expect(mapped).not.toBeNull();
    return mapped!;
}

function serializeSimpleDoc(doc: ProseNode): string {
    const blocks: string[] = [];
    doc.forEach((node) => {
        blocks.push(node.content.size === 0 ? "<br />" : node.textContent);
    });
    return blocks.join("\n\n");
}

function parseSimpleMarkdown(markdown: string): ProseNode {
    const trimmed = markdown.trim();
    if (!trimmed) return docOf(paragraph(""));
    return docOf(...trimmed.split(/\n{2,}/).map((block) =>
        paragraph(block === "<br />" ? "" : block)));
}

function createEditorHarness(
    initial: ProseNode,
    anchor: number,
    head: number,
    onParse?: () => void,
) {
    let state = EditorState.create({
        doc: initial,
        selection: TextSelection.create(initial, anchor, head),
    });
    const view = {
        get state() {
            return state;
        },
        isDestroyed: false,
        dispatch(transaction: any) {
            state = state.apply(transaction);
        },
    };
    const ctx = {
        get(key: unknown) {
            if (key === editorViewCtx) return view;
            if (key === editorStateCtx) return state;
            if (key === parserCtx) {
                return (markdown: string) => {
                    onParse?.();
                    return parseSimpleMarkdown(markdown);
                };
            }
            if (key === serializerCtx) return serializeSimpleDoc;
            throw new Error("Unexpected editor context");
        },
    } as unknown as Ctx;
    return { ctx, state: () => state };
}

function applyPlan(doc: ProseNode, next: ProseNode): { plan: DocumentSyncPlan; doc: ProseNode } {
    const plan = planDocumentSync(doc, next);
    expect(plan).not.toBeNull();
    const transform = new Transform(doc);
    applyDocumentSyncSteps(transform, plan!.steps);
    expect(transform.doc.eq(next)).toBe(true);
    return { plan: plan!, doc: transform.doc };
}

function positionIn(doc: ProseNode, index: number, offset: number): number {
    let start = 0;
    doc.forEach((_node, nodeOffset, nodeIndex) => {
        if (nodeIndex === index) start = nodeOffset;
    });
    return start + 1 + offset;
}

function hasLiteralNewline(doc: ProseNode): boolean {
    let found = false;
    doc.descendants((node) => {
        if (node.isText && /[\r\n]/.test(node.text ?? "")) found = true;
    });
    return found;
}

describe("planDocumentSync", () => {
    test("splits the changed textblock instead of inserting a literal newline", () => {
        const current = docOf(
            paragraph("before"),
            paragraph("hello world"),
            paragraph("after"),
        );
        const next = docOf(
            paragraph("before"),
            paragraph("hello"),
            paragraph("world"),
            paragraph("after"),
        );

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("split");
        expect(doc.childCount).toBe(4);
        expect(doc.child(1).textContent).toBe("hello");
        expect(doc.child(2).textContent).toBe("world");
        expect(doc.child(3).textContent).toBe("after");
        expect(hasLiteralNewline(doc)).toBe(false);
    });

    test("maps a caret in the first half before the remote split point", () => {
        const current = docOf(paragraph("hello world"));
        const next = docOf(paragraph("hello"), paragraph("world"));
        const plan = planDocumentSync(current, next);
        expect(plan?.kind).toBe("split");

        const state = EditorState.create({
            doc: current,
            selection: TextSelection.create(current, positionIn(current, 0, 2)),
        });
        const transaction = state.tr;
        applyDocumentSyncSteps(transaction, plan!.steps);

        const $caret = transaction.doc.resolve(transaction.selection.from);
        expect($caret.parent.textContent).toBe("hello");
        expect($caret.parentOffset).toBe(2);
    });

    test("moves a caret in the second half into the new block", () => {
        const current = docOf(paragraph("hello world"));
        const next = docOf(paragraph("hello"), paragraph("world"));
        const plan = planDocumentSync(current, next);
        expect(plan?.kind).toBe("split");

        const state = EditorState.create({
            doc: current,
            selection: TextSelection.create(current, positionIn(current, 0, 8)),
        });
        const transaction = state.tr;
        applyDocumentSyncSteps(transaction, plan!.steps);

        const $caret = transaction.doc.resolve(transaction.selection.from);
        expect($caret.parent.textContent).toBe("world");
        expect($caret.parentOffset).toBe(2);
    });

    test("maps a caret in a following block through a remote middle-Enter split", () => {
        const current = docOf(
            paragraph("before"),
            paragraph("hello world"),
            paragraph("after"),
        );
        const next = docOf(
            paragraph("before"),
            paragraph("hello"),
            paragraph("world"),
            paragraph("after"),
        );
        const plan = planDocumentSync(current, next);
        expect(plan).not.toBeNull();

        const caret = positionIn(current, 2, 2);
        const state = EditorState.create({
            doc: current,
            selection: TextSelection.create(current, caret),
        });
        const transaction = state.tr;
        applyDocumentSyncSteps(transaction, plan!.steps);

        expect(transaction.doc.eq(next)).toBe(true);
        expect(transaction.selection.empty).toBe(true);
        const $caret = transaction.doc.resolve(transaction.selection.from);
        expect($caret.parent.textContent).toBe("after");
        expect($caret.parentOffset).toBe(2);
        expect(transaction.selection.from).toBeLessThan(transaction.doc.content.size);
    });

    test("creates an empty textblock for Enter at the end of a block", () => {
        const current = docOf(
            paragraph("before"),
            paragraph("hello world"),
            paragraph("after"),
        );
        const next = docOf(
            paragraph("before"),
            paragraph("hello world"),
            paragraph(""),
            paragraph("after"),
        );

        const { doc } = applyPlan(current, next);

        expect(doc.childCount).toBe(4);
        expect(doc.child(2).textContent).toBe("");
        expect(hasLiteralNewline(doc)).toBe(false);
    });

    test("splits and inserts a remote prefix into the moved tail", () => {
        const current = docOf(paragraph("Amiddle-end"));
        const next = docOf(paragraph("A"), paragraph("Bmiddle-end"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("split");
        expect(doc.eq(next)).toBe(true);
    });

    test("splits and inserts a remote suffix into the moved tail", () => {
        const current = docOf(paragraph("Amiddle-end"));
        const next = docOf(paragraph("A"), paragraph("middle-endB"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("split");
        expect(doc.eq(next)).toBe(true);
    });

    test("joins two textblocks back into one", () => {
        const current = docOf(paragraph("hello"), paragraph("world"));
        const next = docOf(paragraph("helloworld"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("merge");
        expect(doc.childCount).toBe(1);
        expect(doc.child(0).textContent).toBe("helloworld");
    });

    test("keeps a caret in the second block at its text through a merge", () => {
        const current = docOf(paragraph("hello"), paragraph("world"));
        const next = docOf(paragraph("helloworld"));
        const plan = planDocumentSync(current, next);
        expect(plan?.kind).toBe("merge");

        const state = EditorState.create({
            doc: current,
            selection: TextSelection.create(current, positionIn(current, 1, 3)),
        });
        const transaction = state.tr;
        applyDocumentSyncSteps(transaction, plan!.steps);

        const $caret = transaction.doc.resolve(transaction.selection.from);
        expect($caret.parent.textContent).toBe("helloworld");
        expect($caret.parentOffset).toBe("hello".length + 3);
    });

    test("applies an inline insertion without replacing the textblock", () => {
        const current = docOf(schema.nodes.paragraph!.create(null, [
            schema.text("hello"),
            schema.nodes.hardbreak!.create(),
            schema.text("world"),
        ]));
        const next = docOf(schema.nodes.paragraph!.create(null, [
            schema.text("hello"),
            schema.nodes.hardbreak!.create(),
            schema.text("Aworld"),
        ]));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("inline");
        expect(doc.eq(next)).toBe(true);
    });

    test("maps a caret through an inline insertion at the block start", () => {
        const current = docOf(paragraph("alpha"));
        const next = docOf(paragraph("Aalpha"));
        const plan = planDocumentSync(current, next);
        expect(plan?.kind).toBe("inline");

        const state = EditorState.create({
            doc: current,
            selection: TextSelection.create(current, positionIn(current, 0, 0)),
        });
        const transaction = state.tr;
        applyDocumentSyncSteps(transaction, plan!.steps);

        expect(transaction.selection.empty).toBe(true);
        expect(transaction.doc.resolve(transaction.selection.from).parentOffset).toBe(1);
    });

    test("replaces only the changed top-level block", () => {
        const current = docOf(paragraph("one"), paragraph("two"), paragraph("three"));
        const next = docOf(paragraph("one"), heading("changed"), paragraph("three"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("replace");
        expect(doc.childCount).toBe(3);
        expect(doc.child(0).eq(current.child(0))).toBe(true);
        expect(doc.child(2).eq(current.child(2))).toBe(true);
    });

    test("splits a textblock through a soft line break separator", () => {
        const current = docOf(paragraph("hello\nworld"));
        const next = docOf(paragraph("hello"), paragraph("world"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("split");
        expect(doc.childCount).toBe(2);
        expect(doc.child(0).textContent).toBe("hello");
        expect(doc.child(1).textContent).toBe("world");
        expect(hasLiteralNewline(doc)).toBe(false);
    });

    test("splits a textblock through a hardbreak node separator", () => {
        const current = docOf(schema.nodes.paragraph!.create(null, [
            schema.text("hello"),
            schema.nodes.hardbreak!.create(),
            schema.text("world"),
        ]));
        const next = docOf(paragraph("hello"), paragraph("world"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("split");
        expect(doc.childCount).toBe(2);
        expect(doc.child(0).textContent).toBe("hello");
        expect(doc.child(1).textContent).toBe("world");
        expect(hasLiteralNewline(doc)).toBe(false);
    });

    test("does not mistake an unchanged soft line break for a textblock split", () => {
        const current = docOf(paragraph("hello world"));
        const next = docOf(paragraph("hello\nworld"));

        const { plan } = applyPlan(current, next);

        expect(plan.kind).toBe("replace");
    });

    test("returns null when the documents already match", () => {
        const current = docOf(paragraph("same"));

        expect(planDocumentSync(current, docOf(paragraph("same")))).toBeNull();
    });
});

describe("typing area reconciliation", () => {
    test("keeps a local trailing empty paragraph across remote content", () => {
        const current = docOf(paragraph("A"), paragraph(""));
        const parsed = docOf(paragraph("A"), paragraph("B"));
        const target = reconcileEditorTarget(current, parsed, "A\n\nB", "A");

        expect(target.childCount).toBe(3);
        expect(target.child(2).type.name).toBe("paragraph");
        expect(target.child(2).content.size).toBe(0);
        expect(hasTrailingEmptyParagraph(target)).toBe(true);
    });

    test("adds a typing paragraph after a target that ends empty", () => {
        const current = docOf(paragraph("A"));
        const parsed = docOf(paragraph("A"), paragraph(""));
        const target = reconcileEditorTarget(current, parsed, "A\n\n<br />", "A");

        expect(target.childCount).toBe(3);
        expect(target.child(1).content.size).toBe(0);
        expect(target.child(2).content.size).toBe(0);
    });

    test("keeps a local typing area when a remote target ends empty", () => {
        const current = docOf(paragraph("A"), paragraph(""));
        const parsed = docOf(paragraph("A"), paragraph(""));
        const target = reconcileEditorTarget(current, parsed, "A\n\n<br />", "A");

        expect(target.childCount).toBe(3);
        expect(target.child(1).content.size).toBe(0);
        expect(target.child(2).content.size).toBe(0);
        expect(trailingTypingParagraphPosition(target, "A\n\n<br />")).toBe(
            positionIn(target, 2, 0),
        );
    });

    test("keeps a canonical <br /> empty document representable", () => {
        const current = docOf(paragraph("A"));
        const parsed = docOf(paragraph(""));
        const target = reconcileEditorTarget(current, parsed, "<br />", "A");

        expect(target.childCount).toBe(2);
        expect(target.child(0).content.size).toBe(0);
        expect(target.child(1).content.size).toBe(0);
    });

    test("keeps an actually empty document at one paragraph", () => {
        const current = docOf(paragraph("A"), paragraph(""));
        const parsed = docOf(paragraph(""));
        const target = reconcileEditorTarget(current, parsed, "", "A");

        expect(target.childCount).toBe(1);
        expect(target.child(0).content.size).toBe(0);
    });

    test("gives an empty local document a typing area after remote content", () => {
        const current = docOf(paragraph(""));
        const parsed = docOf(paragraph("A"));
        const target = reconcileEditorTarget(current, parsed, "A", "");

        expect(target.childCount).toBe(2);
        expect(target.child(0).textContent).toBe("A");
        expect(target.child(1).content.size).toBe(0);
    });

    test("preserves multiple local trailing empties when the target has content", () => {
        const current = docOf(paragraph("A"), paragraph(""), paragraph(""));
        const parsed = docOf(paragraph("A"), paragraph(""));
        const target = reconcileEditorTarget(current, parsed, "A\n\n<br />", "A\n\n<br />");

        expect(target.childCount).toBe(3);
        expect(target.child(1).content.size).toBe(0);
        expect(target.child(2).content.size).toBe(0);
    });

    test("classifies a canonical <br /> empty paragraph as content", () => {
        const contentEmpty = docOf(paragraph("A"), paragraph(""));
        expect(hasTrailingEmptyParagraph(contentEmpty)).toBe(true);
        expect(isTrailingTypingParagraph(contentEmpty, "A\n\n<br />")).toBe(false);
        expect(isTrailingTypingParagraph(contentEmpty, "A")).toBe(true);

        const withTyping = docOf(paragraph("A"), paragraph(""), paragraph(""));
        expect(isTrailingTypingParagraph(withTyping, "A\n\n<br />")).toBe(true);
        expect(contentEmptyParagraphIndices(withTyping, "A\n\n<br />")).toEqual([1]);
    });

    test("locates the caret inside the trailing typing paragraph", () => {
        const withTyping = docOf(paragraph("A"), paragraph(""));
        expect(trailingTypingParagraphPosition(withTyping, "A")).toBe(
            positionIn(withTyping, 1, 0),
        );
        expect(trailingTypingParagraphPosition(withTyping, "A\n\n<br />")).toBeNull();
        expect(trailingTypingParagraphPosition(docOf(paragraph("A")), "A")).toBeNull();
    });
});

describe("presence Markdown mapping", () => {
    test("keeps a canonical end caret out of the local trailing typing paragraph", () => {
        const doc = docOf(paragraph("X"), paragraph(""));
        const typing = trailingTypingParagraphPosition(doc, "X")!;

        expect(presenceMarkdownOffsetForEditorPosition(doc, "X", typing)).toBe(1);
        expect(editorPositionForPresenceOffset(doc, "X", 1)).toBe(
            positionIn(doc, 0, 1),
        );
    });

    test("maps content-empty and typing-empty paragraphs distinctly", () => {
        const doc = docOf(paragraph("A"), paragraph(""), paragraph(""));
        const markdown = "A\n\n<br />";
        const contentEmpty = positionIn(doc, 1, 0);
        const typingEmpty = positionIn(doc, 2, 0);
        const markerStart = markdown.indexOf("<br />");

        expect(presenceMarkdownOffsetForEditorPosition(doc, markdown, contentEmpty))
            .toBe(markerStart);
        expect(presenceMarkdownOffsetForEditorPosition(doc, markdown, typingEmpty))
            .toBe(markdown.length);
        expect(editorPositionForPresenceOffset(doc, markdown, markerStart))
            .toBe(contentEmpty);
        expect(editorPositionForPresenceOffset(doc, markdown, markdown.length))
            .toBe(contentEmpty);
    });

    test("maps a last content-empty paragraph to its <br /> marker", () => {
        const doc = docOf(paragraph("A"), paragraph(""));
        const markdown = "A\n\n<br />";
        const contentEmpty = positionIn(doc, 1, 0);
        const markerStart = markdown.indexOf("<br />");

        expect(isTrailingTypingParagraph(doc, markdown)).toBe(false);
        expect(presenceMarkdownOffsetForEditorPosition(doc, markdown, contentEmpty))
            .toBe(markerStart);
        expect(editorPositionForPresenceOffset(doc, markdown, markerStart))
            .toBe(contentEmpty);
    });

    test("finds markers outside fenced and indented code, case-insensitively", () => {
        const markdown = [
            "```",
            "<br />",
            "```",
            "    <br />",
            "<BR />",
        ].join("\n");
        const markers = emptyParagraphMarkers(markdown);

        expect(markers).toHaveLength(1);
        expect(markdown.slice(markers[0]!.start, markers[0]!.end)).toBe("<BR />");
    });

    test("ignores <br /> lines inside a top-level HTML block", () => {
        const markdown = [
            "<div>",
            "<br />",
            "<br />",
            "</div>",
            "",
            "<br />",
        ].join("\n");
        const markers = emptyParagraphMarkers(markdown);

        expect(markers).toHaveLength(1);
        expect(markdown.slice(markers[0]!.start, markers[0]!.end)).toBe("<br />");
    });

    test("maps an empty document caret to its only paragraph", () => {
        const doc = docOf(paragraph(""));
        expect(presenceMarkdownOffsetForEditorPosition(doc, "", 1)).toBe(0);
        expect(editorPositionForPresenceOffset(doc, "", 0)).toBe(1);
    });
});

describe("peer caret widget affinity", () => {
    test("uses left affinity at end, newline, and <br /> boundaries", () => {
        expect(presenceWidgetSide("X", 1)).toBe(-1);
        expect(presenceWidgetSide("X\nY", 1)).toBe(-1);
        expect(presenceWidgetSide("A\n\n<br />", 3)).toBe(-1);
        expect(presenceWidgetSide("XY", 1)).toBe(1);
    });

    test("keeps a left-affine widget at the preceding line end through Enter", () => {
        const doc = docOf(paragraph("X"), paragraph(""));
        const state = EditorState.create({ doc });
        const position = positionIn(doc, 0, 1);
        const widget = Decoration.widget(position, () => {
            throw new Error("widget DOM is not rendered in this test");
        }, { side: presenceWidgetSide("X", 1) });
        const transaction = state.tr.split(position, 1);
        const mapped = DecorationSet.create(doc, [widget]).map(
            transaction.mapping,
            transaction.doc,
        );

        expect(mapped.find()[0]?.from).toBe(position);
    });

    test("keeps a content-empty peer widget in the content block with typing present", () => {
        const doc = docOf(paragraph("A"), paragraph(""), paragraph(""));
        const markdown = "A\n\n<br />";
        const position = editorPositionForPresenceOffset(doc, markdown, markdown.length);
        expect(position).toBe(positionIn(doc, 1, 0));
        expect(presenceWidgetSide(markdown, markdown.length)).toBe(-1);
    });
});

describe("mapSelectionThroughDocuments", () => {
    test("keeps carets in two adjacent paragraphs changed in one batch", () => {
        const current = docOf(paragraph("one"), paragraph("two"), paragraph("three"));
        const next = docOf(paragraph("oneA"), paragraph("Btwo"), paragraph("three"));

        for (const [oldIndex, newText, offset] of [
            [0, "oneA", 2],
            [1, "Btwo", 3],
        ] as const) {
            const caret = positionIn(current, oldIndex, offset);
            const mapped = mappedSelection(current, next, caret, caret);
            const $caret = next.resolve(mapped.anchor);
            expect($caret.parent.textContent).toBe(newText);
            expect($caret.parentOffset).toBe(offset + (newText === "oneA" ? 0 : 1));
        }
    });

    test("pairs changed blocks by content, not position, with trailing empties", () => {
        const current = docOf(paragraph("A"), paragraph("B"));
        const next = docOf(
            paragraph("AC"),
            paragraph("BD"),
            paragraph(""),
            paragraph(""),
        );

        for (const [oldIndex, text] of [[0, "AC"], [1, "BD"]] as const) {
            const caret = positionIn(current, oldIndex, 1);
            const mapped = mappedSelection(current, next, caret, caret);
            const $caret = next.resolve(mapped.anchor);
            expect($caret.parent.textContent).toBe(text);
            expect($caret.parentOffset).toBeLessThanOrEqual(text.length);
        }
    });

    test("pairs one changed block with its content match among extras", () => {
        const current = docOf(paragraph("B"));
        const next = docOf(paragraph("AC"), paragraph("BD"), paragraph(""), paragraph(""));
        const caret = positionIn(current, 0, 1);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("BD");
        expect($caret.parentOffset).toBe(1);
    });

    test("does not pull an end caret into an appended typing paragraph", () => {
        const current = docOf(paragraph("A"));
        const next = docOf(paragraph("BA"), paragraph(""), paragraph(""));
        const caret = positionIn(current, 0, 1);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("BA");
        expect($caret.parentOffset).toBe(2);
    });

    test("does not pull a genuine split end caret into the typing paragraph", () => {
        const current = docOf(paragraph("helloworld"));
        const next = docOf(paragraph("hel"), paragraph("lowor"), paragraph("ld"), paragraph(""));
        const caret = positionIn(current, 0, 10);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("ld");
        expect($caret.parentOffset).toBe(2);
    });

    test("maps a caret into each block of a repeated-Enter split", () => {
        const current = docOf(paragraph("helloworld"));
        const next = docOf(paragraph("hel"), paragraph("lowor"), paragraph("ld"));

        const expectations: Array<[number, string, number]> = [
            [1, "hel", 1],
            [4, "lowor", 1],
            [8, "ld", 0],
        ];
        for (const [offset, text, expectedOffset] of expectations) {
            const caret = positionIn(current, 0, offset);
            const mapped = mappedSelection(current, next, caret, caret);
            const $caret = next.resolve(mapped.anchor);
            expect($caret.parent.textContent).toBe(text);
            expect($caret.parentOffset).toBe(expectedOffset);
        }
    });

    test("uses the replace plan for a repeated split and still maps every caret", () => {
        const current = docOf(paragraph("helloworld"));
        const next = docOf(paragraph("hel"), paragraph("lowor"), paragraph("ld"));
        const plan = planDocumentSync(current, next);
        expect(plan?.kind).toBe("replace");

        const transform = new Transform(current);
        applyDocumentSyncSteps(transform, plan!.steps);
        expect(transform.doc.eq(next)).toBe(true);

        const caret = positionIn(current, 0, 4);
        const mapped = mapSelectionThroughDocuments(current, transform.doc, {
            anchor: caret,
            head: caret,
        });
        expect(transform.doc.resolve(mapped!.anchor).parent.textContent).toBe("lowor");
    });

    test("maps a caret from merged blocks into the merged textblock", () => {
        const current = docOf(paragraph("hello"), paragraph("world"));
        const next = docOf(paragraph("helloworld"));
        const caret = positionIn(current, 1, 2);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("helloworld");
        expect($caret.parentOffset).toBe("hello".length + 2);
    });

    test("maps a changed list caret to a nested textblock, never the doc", () => {
        const current = docOf(
            bulletList(schema.nodes.list_item!.create(null, paragraph("alpha"))),
            paragraph("tail"),
        );
        const next = docOf(
            bulletList(schema.nodes.list_item!.create(null, paragraph("beta"))),
            paragraph("tail"),
        );
        const caret = positionInTextblock(current, "alpha", 2);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.isTextblock).toBe(true);
        expect($caret.parent.textContent).toBe("beta");
        expect(mapped.anchor).toBeLessThan(next.content.size);
    });

    test("maps a changed code block caret inside the code block", () => {
        const current = docOf(codeBlock("alpha"), paragraph("tail"));
        const next = docOf(codeBlock("beta"), paragraph("tail"));
        const caret = positionInTextblock(current, "alpha", 2);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.type.name).toBe("code_block");
        expect($caret.parentOffset).toBe(0);
    });

    test("maps an empty paragraph to the corresponding empty typing block", () => {
        const current = docOf(paragraph("A"), paragraph(""));
        const next = docOf(paragraph("A"), paragraph(""), paragraph(""));
        const caret = trailingTypingParagraphPosition(current, "A")!;
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("");
        expect($caret.parent.isTextblock).toBe(true);
    });

    test("falls back to monotonic pairing for very large changed batches", () => {
        const current = docOf(...Array.from({ length: 1_000 }, (_value, index) =>
            paragraph(`old${index}`)));
        const next = docOf(...Array.from({ length: 1_000 }, (_value, index) =>
            paragraph(`new${index}`)));
        const caret = positionIn(current, 500, 1);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.textContent).toBe("new500");
    });

    test("maps a caret out of a deleted block into the empty document paragraph", () => {
        const current = docOf(paragraph("gone"));
        const next = docOf(paragraph(""));
        const caret = positionIn(current, 0, 2);
        const mapped = mappedSelection(current, next, caret, caret);
        const $caret = next.resolve(mapped.anchor);

        expect($caret.parent.isTextblock).toBe(true);
        expect($caret.parent.textContent).toBe("");
    });

    test("does not expand a non-collapsed selection over a replacement", () => {
        const current = docOf(paragraph("hello"));
        const next = docOf(paragraph("goodbye"));
        const mapped = mappedSelection(
            current,
            next,
            positionIn(current, 0, 1),
            positionIn(current, 0, 4),
        );

        expect(mapped.anchor).toBe(mapped.head);
        expect(next.resolve(mapped.anchor).parent.textContent).toBe("goodbye");
    });

    test("does not expand a selection ending exactly at the replaced text end", () => {
        const current = docOf(paragraph("hello"));
        const next = docOf(paragraph("goodbye"));
        const mapped = mappedSelection(
            current,
            next,
            positionIn(current, 0, 1),
            positionIn(current, 0, 5),
        );

        expect(mapped.anchor).toBe(mapped.head);
        expect(next.resolve(mapped.anchor).parent.textContent).toBe("goodbye");
    });

    test("preserves a whole-block selection across a replacement", () => {
        const current = docOf(paragraph("hello"));
        const next = docOf(paragraph("goodbye"));
        const mapped = mappedSelection(
            current,
            next,
            positionIn(current, 0, 0),
            positionIn(current, 0, 5),
        );
        const $anchor = next.resolve(mapped.anchor);
        const $head = next.resolve(mapped.head);

        expect(mapped.anchor).toBeLessThan(mapped.head);
        expect($anchor.parent.textContent).toBe("goodbye");
        expect($anchor.parentOffset).toBe(0);
        expect($head.parentOffset).toBe("goodbye".length);
    });
});

describe("planFlatTextblockInline", () => {
    test("applies same-count paragraph edits inline instead of one block replace", () => {
        const current = docOf(paragraph("one"), paragraph("two"), paragraph("three"));
        const next = docOf(paragraph("oneA"), paragraph("Btwo"), paragraph("three"));

        const { plan, doc } = applyPlan(current, next);

        expect(plan.kind).toBe("inline");
        expect(doc.eq(next)).toBe(true);
    });
});

describe("caretAssocForMarkdown", () => {
    test("follows the character after the caret", () => {
        expect(caretAssocForMarkdown("alpha beta", 0)).toBe(1);
        expect(caretAssocForMarkdown("alpha beta", 5)).toBe(1);
    });

    test("stays before content inserted at the end of a line", () => {
        expect(caretAssocForMarkdown("alpha\nbeta", 5)).toBe(-1);
        expect(caretAssocForMarkdown("alpha\nbeta", 6)).toBe(1);
        expect(caretAssocForMarkdown("alpha", 5)).toBe(-1);
        expect(caretAssocForMarkdown("alpha", null)).toBe(-1);
    });
});

describe("replaceEditorMarkdownPreservingSelection", () => {
    test("preserves a whole-block selection through an inline plan", () => {
        const current = docOf(paragraph("hello"));
        let parseCount = 0;
        const harness = createEditorHarness(
            current,
            positionIn(current, 0, 0),
            positionIn(current, 0, 5),
            () => { parseCount += 1; },
        );

        const result = replaceEditorMarkdownPreservingSelection(harness.ctx, "goodbye");
        const state = harness.state();

        expect(result).toEqual({ applied: true, normalizationOnly: false });
        expect(parseCount).toBe(1);
        expect(state.doc.textContent).toBe("goodbye");
        expect(state.selection.from).toBe(1);
        expect(state.selection.to).toBe(8);
    });

    test("keeps the collapsed fast path", () => {
        const current = docOf(paragraph("hello"));
        let parseCount = 0;
        const harness = createEditorHarness(
            current,
            positionIn(current, 0, 5),
            positionIn(current, 0, 5),
            () => { parseCount += 1; },
        );

        const result = replaceEditorMarkdownPreservingSelection(harness.ctx, "goodbye");
        const state = harness.state();

        expect(result.applied).toBe(true);
        expect(parseCount).toBe(0);
        expect(state.doc.textContent).toBe("goodbye");
        expect(state.selection.empty).toBe(true);
    });
});

describe("withSuppressedDocumentChange", () => {
    test("mutes the document-change guard only during the synchronous apply", () => {
        const suppress = { current: false };
        let mutedDuringApply = false;

        withSuppressedDocumentChange(suppress, () => {
            mutedDuringApply = suppress.current;
        });

        expect(mutedDuringApply).toBe(true);
        expect(suppress.current).toBe(false);
    });

    test("restores a previous flag when the apply throws", () => {
        const suppress = { current: true };

        expect(() => withSuppressedDocumentChange(suppress, () => {
            throw new Error("transaction failed");
        })).toThrow("transaction failed");
        expect(suppress.current).toBe(true);
    });

    test("leaves a genuine local change outside the guard", () => {
        const suppress = { current: false };
        withSuppressedDocumentChange(suppress, () => {});
        expect(suppress.current).toBe(false);
    });
});

