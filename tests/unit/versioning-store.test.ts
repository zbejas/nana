import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitVersionStore } from "../../src/api/versioning/store";
import { withNoteLock } from "../../src/api/versioning/lock";
import type { NoteSnapshot } from "../../src/api/versioning/types";

let root = "";

function snapshot(content: string, overrides: Partial<NoteSnapshot["metadata"]> = {}): NoteSnapshot {
    return {
        content,
        metadata: {
            title: "Versioned note",
            tags: ["one", "two"],
            folder: "",
            is_private: false,
            ...overrides,
        },
    };
}

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "nana-versioning-"));
});

afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
});

describe("GitVersionStore", () => {
    test("creates the first commit and treats identical content as a no-op", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-first";

        const first = await store.commit(noteId, snapshot("# First\n"), "Saved version");
        expect(first.created).toBe(true);
        expect(first.version.document).toBe(noteId);
        expect(first.version.version_number).toBe(1);
        expect(first.version.change_summary).toBe("Saved version");
        expect(first.version.id).toMatch(/^[0-9a-f]{40}$/);
        expect(first.version.created).toBe(first.version.source_created_at);

        // Same values, different object insertion order: metadata is compared
        // through the canonical JSON document, not object identity.
        const same = await store.commit(noteId, {
            content: "# First\n",
            metadata: {
                is_private: false,
                folder: "",
                tags: ["one", "two"],
                title: "Versioned note",
            },
        }, "Saved version");

        expect(same.created).toBe(false);
        expect(same.version.id).toBe(first.version.id);
        expect(same.version.version_number).toBe(1);
    });

    test("creates a new commit when content or metadata changes", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-changes";

        const first = await store.commit(noteId, snapshot("# One\n"), "Saved version");
        const contentChange = await store.commit(noteId, snapshot("# Two\n"), "Saved version");
        const metadataChange = await store.commit(
            noteId,
            snapshot("# Two\n", { tags: ["one", "two", "three"] }),
            "Saved version",
        );

        expect(contentChange.created).toBe(true);
        expect(contentChange.version.version_number).toBe(2);
        expect(metadataChange.created).toBe(true);
        expect(metadataChange.version.version_number).toBe(3);
        expect(metadataChange.version.id).not.toBe(first.version.id);
    });

    test("lists newest first with pagination and returns detail without leaking content into lists", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-pages";

        const one = await store.commit(noteId, snapshot("body one"), "Saved version");
        const two = await store.commit(noteId, snapshot("body two"), "Saved version");
        const three = await store.commit(noteId, snapshot("body three"), "Saved version");

        const firstPage = await store.listVersions(noteId, 1, 2);
        expect(firstPage.page).toBe(1);
        expect(firstPage.perPage).toBe(2);
        expect(firstPage.totalItems).toBe(3);
        expect(firstPage.totalPages).toBe(2);
        expect(firstPage.items.map((item) => item.version_number)).toEqual([3, 2]);
        expect(firstPage.items.map((item) => item.id)).toEqual([three.version.id, two.version.id]);
        expect("content" in firstPage.items[0]!).toBe(false);

        const secondPage = await store.listVersions(noteId, 2, 2);
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.id).toBe(one.version.id);
        expect(secondPage.items[0]?.version_number).toBe(1);

        const detail = await store.getVersion(noteId, one.version.id);
        expect(detail?.content).toBe("body one");
        expect(detail?.metadata.tags).toEqual(["one", "two"]);
        expect(detail?.version_number).toBe(1);
    });

    test("clamps invalid pagination and keeps empty histories empty", async () => {
        const store = new GitVersionStore(root);

        const empty = await store.listVersions("note-empty", 0, 0);
        expect(empty.items).toEqual([]);
        expect(empty.page).toBe(1);
        expect(empty.perPage).toBe(1);
        expect(empty.totalItems).toBe(0);
        expect(empty.totalPages).toBe(0);

        await store.commit("note-clamped", snapshot("body"), "Saved version");
        const clamped = await store.listVersions("note-clamped", 1, 500);
        expect(clamped.perPage).toBe(100);
    });

    test("stores an empty note body", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-empty-body";

        const saved = await store.commit(noteId, snapshot(""), "Saved version");
        expect(saved.created).toBe(true);
        expect(saved.version.version_number).toBe(1);

        const detail = await store.getVersion(noteId, saved.version.id);
        expect(detail?.content).toBe("");
    });

    test("records a pre-restore commit without changing the selected version", async () => {        const store = new GitVersionStore(root);
        const noteId = "note-restore";

        const first = await store.commit(noteId, snapshot("before restore"), "Saved version");
        const second = await store.commit(noteId, snapshot("saved work"), "Saved version");
        const saved = await store.commit(
            noteId,
            snapshot("unsaved work"),
            `Saved before restoring Version ${first.version.version_number}`,
        );

        expect(saved.created).toBe(true);
        expect(saved.version.version_number).toBe(3);
        expect(saved.version.change_summary).toBe("Saved before restoring Version 1");

        const selected = await store.getVersion(noteId, first.version.id);
        expect(selected?.content).toBe("before restore");
        expect(selected?.version_number).toBe(1);

        const head = await store.getVersion(noteId, saved.version.id);
        expect(head?.content).toBe("unsaved work");
        expect(head?.version_number).toBe(3);
        expect(second.version.id).not.toBe(saved.version.id);
    });

    test("returns null for versions outside the repository and invalid ids", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-invalid";
        const otherNoteId = "note-other";

        await store.commit(noteId, snapshot("mine"), "Saved version");
        const other = await store.commit(otherNoteId, snapshot("other"), "Saved version");

        expect(await store.getVersion(noteId, other.version.id)).toBeNull();
        expect(await store.getVersion(noteId, "not-a-commit")).toBeNull();
        expect(await store.getVersion("note-without-repo", "a".repeat(40))).toBeNull();
        await expect(store.commit("../escape", snapshot("bad"), "Saved version")).rejects.toThrow();
    });

    test("deletes the repository after a permanent delete", async () => {
        const store = new GitVersionStore(root);
        const noteId = "note-delete";

        await store.commit(noteId, snapshot("delete me"), "Saved version");
        expect(existsSync(join(root, `${noteId}.git`))).toBe(true);

        await store.deleteRepo(noteId);
        expect(existsSync(join(root, `${noteId}.git`))).toBe(false);
        expect((await store.listVersions(noteId, 1, 20)).items).toEqual([]);
    });

    test("serializes work for the same note", async () => {
        const order: string[] = [];

        const first = withNoteLock("note-lock", async () => {
            order.push("first-start");
            await Bun.sleep(10);
            order.push("first-end");
        });
        const second = withNoteLock("note-lock", async () => {
            order.push("second-start");
            order.push("second-end");
        });

        await Promise.all([first, second]);
        expect(order).toEqual([
            "first-start",
            "first-end",
            "second-start",
            "second-end",
        ]);
    });
});
