import { describe, expect, test } from "bun:test";
import { listBoardsInputSchema, readBoardInputSchema } from "../../src/api/chat/tools/boards";
import { queryString } from "../../src/api/chat/tools/http";
import { listNotesInputSchema, readNoteInputSchema } from "../../src/api/chat/tools/notes";

describe("listNotesInputSchema", () => {
    test("applies defaults", () => {
        const parsed = listNotesInputSchema.parse({});
        expect(parsed).toEqual({ page: 1, perPage: 20, sort: "updated" });
    });

    test("rejects page and perPage outside the allowed range", () => {
        expect(listNotesInputSchema.safeParse({ page: 0 }).success).toBe(false);
        expect(listNotesInputSchema.safeParse({ page: 1001 }).success).toBe(false);
        expect(listNotesInputSchema.safeParse({ perPage: 0 }).success).toBe(false);
        expect(listNotesInputSchema.safeParse({ perPage: 51 }).success).toBe(false);
    });

    test("rejects oversized search text and unknown sort keys", () => {
        expect(listNotesInputSchema.safeParse({ query: "x".repeat(201) }).success).toBe(false);
        expect(listNotesInputSchema.safeParse({ tag: "x".repeat(61) }).success).toBe(false);
        expect(listNotesInputSchema.safeParse({ sort: "relevance" }).success).toBe(false);
    });
});

describe("readNoteInputSchema", () => {
    test("applies the default line window", () => {
        expect(readNoteInputSchema.parse({ noteId: "abc123" })).toEqual({
            noteId: "abc123",
            offset: 1,
            limit: 300,
        });
    });

    test("rejects an empty id and out-of-range bounds", () => {
        expect(readNoteInputSchema.safeParse({ noteId: "" }).success).toBe(false);
        expect(readNoteInputSchema.safeParse({ noteId: "a", offset: 0 }).success).toBe(false);
        expect(readNoteInputSchema.safeParse({ noteId: "a", limit: 601 }).success).toBe(false);
    });
});

describe("board input schemas", () => {
    test("list_boards defaults to active boards", () => {
        expect(listBoardsInputSchema.parse({})).toEqual({
            includeArchived: false,
            page: 1,
            perPage: 20,
        });
    });

    test("read_board only accepts known columns", () => {
        expect(readBoardInputSchema.parse({ boardId: "abc123" }).column).toBeUndefined();
        expect(readBoardInputSchema.safeParse({ boardId: "abc123", column: "done" }).success).toBe(true);
        expect(readBoardInputSchema.safeParse({ boardId: "abc123", column: "archived" }).success).toBe(false);
    });
});

describe("queryString", () => {
    test("returns an empty string when there is nothing to encode", () => {
        expect(queryString({})).toBe("");
        expect(queryString({ a: undefined })).toBe("");
    });

    test("encodes values and skips undefined entries", () => {
        expect(queryString({ filter: 'author="a b"', page: 2, flag: true, missing: undefined })).toBe(
            "?filter=author%3D%22a+b%22&page=2&flag=true",
        );
    });
});
