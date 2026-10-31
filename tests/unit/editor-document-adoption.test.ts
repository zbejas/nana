import { describe, expect, test } from "bun:test";
import { adoptEditorDocument } from "../../src/lib/documents/drafts";
import type { Document } from "../../src/lib/documents/types";

function savedDocument(overrides: Partial<Document> = {}): Document {
    return {
        id: "document-b",
        title: "Saved title",
        content: "Saved body",
        tags: ["saved"],
        ...overrides,
    } as Document;
}

describe("adoptEditorDocument", () => {
    test("adopts the saved record for a new note with no typing during the first save", () => {
        const saved = savedDocument({
            title: "Untitled",
            content: "Body from the create request",
            tags: ["draft"],
        });

        const adoption = adoptEditorDocument({
            mode: "promotion",
            document: saved,
            current: {
                title: "",
                content: "Body from the create request",
                tags: ["draft"],
            },
        });

        expect(adoption.title).toBe("Untitled");
        expect(adoption.content).toBe("Body from the create request");
        expect(adoption.tags).toEqual(["draft"]);
        expect(adoption.contentDirty).toBe(false);
        expect(adoption.preservedDraft).toBe(false);
    });

    test("keeps text typed while the first save was in flight and stays dirty", () => {
        const saved = savedDocument({ content: "Body at save start" });

        const adoption = adoptEditorDocument({
            mode: "promotion",
            document: saved,
            current: {
                title: "Saved title",
                content: "Body at save start plus typing during the save",
                tags: ["saved"],
            },
        });

        expect(adoption.content).toBe("Body at save start plus typing during the save");
        expect(adoption.contentDirty).toBe(true);
        expect(adoption.preservedDraft).toBe(true);
    });

    test("preserves title and tag changes made while the first save was in flight", () => {
        const saved = savedDocument({
            title: "Title at save start",
            content: "Unchanged body",
            tags: ["saved"],
        });

        const adoption = adoptEditorDocument({
            mode: "promotion",
            document: saved,
            current: {
                title: "Title typed during the save",
                content: "Unchanged body",
                tags: ["typed", "during-save"],
            },
        });

        expect(adoption.title).toBe("Title typed during the save");
        expect(adoption.tags).toEqual(["typed", "during-save"]);
        expect(adoption.content).toBe("Unchanged body");
        expect(adoption.contentDirty).toBe(false);
        expect(adoption.preservedDraft).toBe(true);
    });

    test("uses normal saved-record adoption for an existing document", () => {
        const saved = savedDocument({
            title: "Opened note",
            content: "Opened body",
            tags: ["opened"],
        });

        const adoption = adoptEditorDocument({
            mode: "document",
            document: saved,
            current: { title: "", content: "", tags: [] },
        });

        expect(adoption.title).toBe("Opened note");
        expect(adoption.content).toBe("Opened body");
        expect(adoption.tags).toEqual(["opened"]);
        expect(adoption.contentDirty).toBe(false);
        expect(adoption.preservedDraft).toBe(false);
    });

    test("starts a blank new note without inheriting the previous note", () => {
        const adoption = adoptEditorDocument({
            mode: "blank",
            document: null,
            current: {
                title: "Note A title",
                content: "Note A body",
                tags: ["a"],
            },
            initialTitle: "Version of A",
            initialContent: "Seeded version body",
        });

        expect(adoption.title).toBe("Version of A");
        expect(adoption.content).toBe("Seeded version body");
        expect(adoption.tags).toEqual([]);
        expect(adoption.contentDirty).toBe(false);
        expect(adoption.preservedDraft).toBe(false);
    });

    test("never adopts note A's state when switching to note B", () => {
        const noteB = savedDocument({
            id: "document-b",
            title: "Note B",
            content: "Note B body",
            tags: ["b"],
        });

        const adoption = adoptEditorDocument({
            mode: "document",
            document: noteB,
            current: {
                title: "Note A title",
                content: "Note A body with unsaved edits",
                tags: ["a"],
            },
        });

        expect(adoption.title).toBe("Note B");
        expect(adoption.content).toBe("Note B body");
        expect(adoption.tags).toEqual(["b"]);
        expect(adoption.contentDirty).toBe(false);
        expect(adoption.preservedDraft).toBe(false);
    });
});
