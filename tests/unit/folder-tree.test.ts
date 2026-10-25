import { describe, expect, test } from "bun:test";
import { buildFolderTree } from "../../src/lib/folders/utils";
import type { Folder } from "../../src/lib/folders/types";

function folder(id: string, name: string, parent = ""): Folder {
    return {
        id,
        name,
        parent,
        author: "user",
        color: "",
        created: "2026-01-01 00:00:00.000Z",
        updated: "2026-01-01 00:00:00.000Z",
        collectionId: "folders",
        collectionName: "folders",
    } as Folder;
}

describe("buildFolderTree", () => {
    test("returns an empty array for no folders", () => {
        expect(buildFolderTree([])).toEqual([]);
    });

    test("nests children under their parents", () => {
        const tree = buildFolderTree([
            folder("root", "Root"),
            folder("child", "Child", "root"),
            folder("grandchild", "Grandchild", "child"),
        ]);

        expect(tree).toHaveLength(1);
        expect(tree[0]?.id).toBe("root");
        expect(tree[0]?.subfolders).toHaveLength(1);
        expect(tree[0]?.subfolders[0]?.id).toBe("child");
        expect(tree[0]?.subfolders[0]?.subfolders[0]?.id).toBe("grandchild");
    });

    test("keeps multiple roots in input order", () => {
        const tree = buildFolderTree([
            folder("a", "A"),
            folder("b", "B"),
            folder("c", "C", "a"),
        ]);

        expect(tree.map((node) => node.id)).toEqual(["a", "b"]);
    });

    test("treats a folder with a missing parent as a root", () => {
        const tree = buildFolderTree([folder("orphan", "Orphan", "missing")]);
        expect(tree.map((node) => node.id)).toEqual(["orphan"]);
    });

    test("does not mutate the input records", () => {
        const input = [folder("root", "Root")];
        const tree = buildFolderTree(input);

        expect(tree[0]).not.toBe(input[0]);
        expect(input[0]).not.toHaveProperty("subfolders");
    });
});
