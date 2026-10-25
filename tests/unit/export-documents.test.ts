import { describe, expect, test } from "bun:test";
import {
    documentToMarkdown,
    getAllSubfolderIds,
    getFolderPath,
    getOriginalFilename,
    sanitizeFilename,
} from "../../src/api/export/documents";
import type { PBDocument, PBFolder } from "../../src/api/export/types";

function folder(id: string, name: string, parent = ""): PBFolder {
    return {
        id,
        name,
        parent,
        author: "user",
        color: "",
        published: false,
        created: "2026-01-01 00:00:00.000Z",
        updated: "2026-01-01 00:00:00.000Z",
        collectionId: "folders",
        collectionName: "folders",
    };
}

function document(overrides: Partial<PBDocument> = {}): PBDocument {
    return {
        id: "doc",
        collectionId: "documents",
        collectionName: "documents",
        title: "My note",
        slug: "my-note",
        content: "# Body",
        attachments: [],
        tags: [],
        published: false,
        author: "user",
        folder: "",
        word_count: 1,
        reading_time: 1,
        created: "2026-01-02T03:04:05.000Z",
        updated: "2026-01-03T04:05:06.000Z",
        ...overrides,
    };
}

describe("sanitizeFilename", () => {
    test("replaces path and filesystem-reserved characters", () => {
        expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    });

    test("collapses whitespace to underscores", () => {
        expect(sanitizeFilename("  My   Note  ")).toBe("My_Note");
    });

    test("trims trailing dots", () => {
        expect(sanitizeFilename("note...")).toBe("note");
    });

    test("falls back to Untitled for empty input", () => {
        expect(sanitizeFilename("")).toBe("Untitled");
        expect(sanitizeFilename("   ")).toBe("Untitled");
        expect(sanitizeFilename("...")).toBe("Untitled");
    });

    test("keeps Unicode letters", () => {
        expect(sanitizeFilename("Résumé 日本")).toBe("Résumé_日本");
    });
});

describe("documentToMarkdown", () => {
    test("writes frontmatter and the body", () => {
        const markdown = documentToMarkdown(
            document({ title: "Release notes", content: "# Hello", tags: ["work", "urgent"] }),
        );

        expect(markdown).toBe(
            [
                "---",
                "title: Release notes",
                "created: 2026-01-02T03:04:05.000Z",
                "updated: 2026-01-03T04:05:06.000Z",
                "tags: [work, urgent]",
                "published: false",
                "---",
                "",
                "# Hello",
            ].join("\n"),
        );
    });

    test("omits the tags line when there are no tags", () => {
        const markdown = documentToMarkdown(document());
        expect(markdown).not.toContain("tags:");
    });

    test("falls back to Untitled for an empty title", () => {
        expect(documentToMarkdown(document({ title: "   " }))).toContain("title: Untitled");
    });
});

describe("getOriginalFilename", () => {
    test("strips PocketBase's random suffix", () => {
        expect(getOriginalFilename("photo_a8f3kd2.png")).toBe("photo.png");
        expect(getOriginalFilename("archive_a1b2c3.tar.gz")).toBe("archive.tar.gz");
        expect(getOriginalFilename("my_note_a8f3kd2.md")).toBe("my_note.md");
    });

    test("leaves names without a recognisable suffix unchanged", () => {
        expect(getOriginalFilename("photo.png")).toBe("photo.png");
        expect(getOriginalFilename("notes")).toBe("notes");
    });
});

describe("folder helpers", () => {
    const folders = [
        folder("root", "Root"),
        folder("child", "Child", "root"),
        folder("grandchild", "Grand Child", "child"),
        folder("sibling", "Sibling", "root"),
        folder("orphan", "Orphan", "missing"),
    ];

    test("collects a folder and all descendants", () => {
        expect(new Set(getAllSubfolderIds("root", folders))).toEqual(
            new Set(["root", "child", "grandchild", "sibling"]),
        );
    });

    test("returns only the folder when it has no children", () => {
        expect(getAllSubfolderIds("grandchild", folders)).toEqual(["grandchild"]);
    });

    test("builds a sanitized path from the root", () => {
        expect(getFolderPath("grandchild", folders)).toBe("Root/Child/Grand_Child");
        expect(getFolderPath("root", folders)).toBe("Root");
    });

    test("stops at a missing parent", () => {
        expect(getFolderPath("orphan", folders)).toBe("Orphan");
        expect(getFolderPath("missing", folders)).toBe("");
    });
});
