import { describe, expect, test } from "bun:test";
import { Schema, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { Transform } from "@milkdown/kit/prose/transform";
import {
    applyDocumentSyncSteps,
    caretAssocForMarkdown,
    planDocumentSync,
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

function docOf(...nodes: ProseNode[]): ProseNode {
    return schema.nodes.doc!.create(null, nodes);
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

