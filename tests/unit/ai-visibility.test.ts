import { describe, expect, test } from "bun:test";
import { aiVisibilityConditions, computeHiddenFolderIds } from "../../src/api/workspace/privacy";

type Folder = { id: string; parent?: string; is_private?: boolean };

function ids(folders: Folder[]): string[] {
    return [...computeHiddenFolderIds(folders)].sort();
}

describe("computeHiddenFolderIds", () => {
    test("returns an empty set for no folders", () => {
        expect(computeHiddenFolderIds([]).size).toBe(0);
    });

    test("returns an empty set when nothing is private", () => {
        expect(ids([
            { id: "root" },
            { id: "child", parent: "root" },
            { id: "grandchild", parent: "child" },
        ])).toEqual([]);
    });

    test("hides a directly private folder only", () => {
        expect(ids([
            { id: "private", is_private: true },
            { id: "public" },
        ])).toEqual(["private"]);
    });

    test("hides every descendant of a private folder", () => {
        expect(ids([
            { id: "private", is_private: true },
            { id: "child", parent: "private" },
            { id: "grandchild", parent: "child" },
            { id: "great-grandchild", parent: "grandchild" },
        ])).toEqual(["child", "grandchild", "great-grandchild", "private"]);
    });

    test("keeps siblings and unrelated trees visible", () => {
        expect(ids([
            { id: "root" },
            { id: "private", parent: "root", is_private: true },
            { id: "hidden-child", parent: "private" },
            { id: "sibling", parent: "root" },
            { id: "other-root" },
            { id: "other-child", parent: "other-root" },
        ])).toEqual(["hidden-child", "private"]);
    });

    test("handles multiple private roots in one tree list", () => {
        expect(ids([
            { id: "a", is_private: true },
            { id: "a-child", parent: "a" },
            { id: "b", is_private: true },
            { id: "b-child", parent: "b" },
            { id: "b-grandchild", parent: "b-child" },
        ])).toEqual(["a", "a-child", "b", "b-child", "b-grandchild"]);
    });

    test("tolerates parent cycles without looping", () => {
        expect(ids([
            { id: "private", parent: "loop", is_private: true },
            { id: "loop", parent: "private" },
        ])).toEqual(["loop", "private"]);
    });
});

describe("aiVisibilityConditions", () => {
    test("always excludes private records", () => {
        expect(aiVisibilityConditions({ hiddenFolderIds: new Set() })).toEqual(["is_private=false"]);
    });

    test("adds one folder exclusion per hidden id", () => {
        expect(aiVisibilityConditions({
            hiddenFolderIds: new Set(["a", "b"]),
        })).toEqual([
            "is_private=false",
            'folder!="a"',
            'folder!="b"',
        ]);
    });

    test("escapes filter metacharacters in folder ids", () => {
        expect(aiVisibilityConditions({
            hiddenFolderIds: new Set(['bad"id']),
        })).toEqual([
            "is_private=false",
            'folder!="bad\\"id"',
        ]);
    });
});
