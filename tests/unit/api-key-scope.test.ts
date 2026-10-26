import { describe, expect, test } from "bun:test";
import {
    generateApiKeyToken,
    hashApiKey,
    isApiKeyToken,
} from "../../src/api/api-keys/token";
import type { ApiKeyPermission } from "../../src/api/api-keys/types";
import type { ToolContext } from "../../src/api/pocketbase/client";
import {
    computeIncludedFolderIds,
    recordIsLocked,
    visibilityFromFolders,
    workspaceVisibilityConditions,
} from "../../src/api/workspace/privacy";

type Folder = { id: string; parent?: string; is_private?: boolean };

const FOLDERS: Folder[] = [
    { id: "a" },
    { id: "a-child", parent: "a" },
    { id: "a-grandchild", parent: "a-child" },
    { id: "b" },
    { id: "b-child", parent: "b" },
    { id: "private", is_private: true },
    { id: "private-child", parent: "private" },
];

function context(apiKey?: ApiKeyPermission): ToolContext {
    return { authHeader: "token", userId: "user1", apiKey };
}

function key(scope: ApiKeyPermission["scope"], folderIds: string[] = []): ApiKeyPermission {
    return { id: "key1", access: "write", scope, folderIds };
}

function sorted(values: Iterable<string>): string[] {
    return [...values].sort();
}

describe("computeIncludedFolderIds", () => {
    test("includes a root and every descendant", () => {
        expect(sorted(computeIncludedFolderIds(FOLDERS, ["a"]))).toEqual([
            "a",
            "a-child",
            "a-grandchild",
        ]);
    });

    test("unions multiple roots and deduplicates overlap", () => {
        expect(sorted(computeIncludedFolderIds(FOLDERS, ["a", "a-child", "b"]))).toEqual([
            "a",
            "a-child",
            "a-grandchild",
            "b",
            "b-child",
        ]);
    });

    test("ignores roots that are not in the owned folder list", () => {
        expect(computeIncludedFolderIds(FOLDERS, ["missing"]).size).toBe(0);
    });

    test("tolerates parent cycles", () => {
        const cyclic: Folder[] = [
            { id: "a", parent: "b" },
            { id: "b", parent: "a" },
        ];
        expect(sorted(computeIncludedFolderIds(cyclic, ["a"]))).toEqual(["a", "b"]);
    });
});

describe("visibilityFromFolders", () => {
    test("leaves a session owner surface unrestricted", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(), "user");
        expect(visibility.hiddenFolderIds.size).toBe(0);
        expect(visibility.rootAllowed).toBe(true);
        expect(visibility.folderScoped).toBe(false);
    });

    test("hides private subtrees for an AI surface", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(), "ai");
        expect(sorted(visibility.hiddenFolderIds)).toEqual(["private", "private-child"]);
        expect(visibility.rootAllowed).toBe(true);
    });

    test("a workspace key adds no folder restriction", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("workspace")), "user");
        expect(visibility.hiddenFolderIds.size).toBe(0);
        expect(visibility.rootAllowed).toBe(true);
    });

    test("a root key hides every folder but keeps the root", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("root")), "user");
        expect(visibility.hiddenFolderIds.size).toBe(FOLDERS.length);
        expect(visibility.rootAllowed).toBe(true);
        expect(visibility.foldersAllowed).toBe(false);
        expect(visibility.folderScoped).toBe(false);
    });

    test("a folder key hides the root and every folder outside the subtree", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("folders", ["a"])), "user");
        expect(sorted(visibility.hiddenFolderIds)).toEqual([
            "b",
            "b-child",
            "private",
            "private-child",
        ]);
        expect(visibility.rootAllowed).toBe(false);
        expect(visibility.folderScoped).toBe(true);
    });

    test("AI privacy still hides a private folder inside the key scope", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("folders", ["private"])), "ai");
        expect(visibility.hiddenFolderIds.has("private")).toBe(true);
        expect(visibility.hiddenFolderIds.has("private-child")).toBe(true);
        expect(visibility.hiddenFolderIds.has("a")).toBe(true);
        expect(visibility.rootAllowed).toBe(false);
    });

    test("a folder key with a deleted or foreign root grants nothing", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("folders", ["missing"])), "user");
        expect(visibility.hiddenFolderIds.size).toBe(FOLDERS.length);
        expect(visibility.rootAllowed).toBe(false);
    });
});

describe("workspaceVisibilityConditions", () => {
    test("a session owner surface adds no filter", () => {
        expect(workspaceVisibilityConditions(visibilityFromFolders(FOLDERS, context(), "user"), "user"))
            .toEqual([]);
    });

    test("an AI surface always excludes private records", () => {
        const conditions = workspaceVisibilityConditions(visibilityFromFolders(FOLDERS, context(), "ai"), "ai");
        expect(conditions[0]).toBe("is_private=false");
        expect(conditions).toContain('folder!="private"');
        expect(conditions).toContain('folder!="private-child"');
    });

    test("a folder key excludes hidden folders and the empty root folder", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("folders", ["a"])), "user");
        const conditions = workspaceVisibilityConditions(visibility, "user");
        expect(conditions).toContain('folder!="b"');
        expect(conditions).toContain('folder!="b-child"');
        expect(conditions).toContain('folder!=""');
        expect(conditions).not.toContain('folder!="a"');
    });

    test("a root key excludes every folder and keeps the root", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("root")), "user");
        const conditions = workspaceVisibilityConditions(visibility, "user");
        expect(conditions).toContain('folder!="a"');
        expect(conditions).toContain('folder!="b"');
        expect(conditions).not.toContain('folder!=""');
    });
});

describe("recordIsLocked", () => {
    test("a session owner sees private and root records", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(), "user");
        expect(recordIsLocked(visibility, "user", { is_private: true, folder: "" })).toBe(false);
        expect(recordIsLocked(visibility, "user", { folder: "" })).toBe(false);
    });

    test("AI hides private records", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(), "ai");
        expect(recordIsLocked(visibility, "ai", { is_private: true })).toBe(true);
        expect(recordIsLocked(visibility, "ai", { is_private: false, folder: "a" })).toBe(false);
    });

    test("a folder key hides root records and records outside the subtree", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("folders", ["a"])), "user");
        expect(recordIsLocked(visibility, "user", { folder: "" })).toBe(true);
        expect(recordIsLocked(visibility, "user", { folder: "b" })).toBe(true);
        expect(recordIsLocked(visibility, "user", { folder: "a-child" })).toBe(false);
        expect(recordIsLocked(visibility, "user", { is_private: true, folder: "a" })).toBe(false);
    });

    test("a root key allows root records and hides folder records", () => {
        const visibility = visibilityFromFolders(FOLDERS, context(key("root")), "user");
        expect(recordIsLocked(visibility, "user", { folder: "" })).toBe(false);
        expect(recordIsLocked(visibility, "user", { folder: "a" })).toBe(true);
    });
});

describe("API key tokens", () => {
    test("accepts only the nana_ format", () => {
        expect(isApiKeyToken(`nana_${"a".repeat(43)}`)).toBe(true);
        expect(isApiKeyToken(`nana_${"a".repeat(10)}`)).toBe(false);
        expect(isApiKeyToken("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBe(false);
        expect(isApiKeyToken("nana_has spaces in the token")).toBe(false);
    });

    test("generates unique URL-safe secrets", () => {
        const first = generateApiKeyToken();
        const second = generateApiKeyToken();
        expect(first).not.toBe(second);
        expect(isApiKeyToken(first)).toBe(true);
        expect(first).toMatch(/^nana_[A-Za-z0-9_-]+$/);
    });

    test("hashes deterministically and never returns the secret", async () => {
        const token = generateApiKeyToken();
        const first = await hashApiKey(token);
        const second = await hashApiKey(token);
        expect(first).toBe(second);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(first).not.toContain(token);
    });
});
