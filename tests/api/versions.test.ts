import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bunRequest, expectStatus, pbGetRecord, readJson } from "../helpers/client";
import { createFolder, createNote, createUser, type TestRecord, type TestUser } from "../helpers/factories";
import { authHeaders, BROWSER_API, uniqueSuffix } from "../helpers/setup";

/**
 * Git-backed note versions over the browser facade.
 *
 * The API treats commit ids as opaque version ids. These tests exercise the
 * exact contract the editor uses: save after a normal document save, list,
 * read, restore, stale revisions, owner scoping, and repository cleanup after
 * a permanent delete.
 */

interface NoteRecord extends TestRecord {
    content: string;
    title: string;
    tags?: string[];
    revision: number;
}

interface VersionDto {
    id: string;
    document: string;
    version_number: number;
    change_summary: string;
    source_created_at: string;
    created: string;
}

interface VersionDetailDto extends VersionDto {
    content: string;
    metadata: {
        title: string;
        tags: string[];
        folder: string;
        is_private: boolean;
    };
}

let user: TestUser;
let other: TestUser;

const api = (path: string) => `${BROWSER_API}${path}`;
const jsonHeaders = (token: string) => authHeaders(token, true);
const versionPath = (documentId: string) =>
    api(`/documents/${encodeURIComponent(documentId)}/versions`);

function versioningRoot(): string {
    const configured = process.env.NANA_VERSIONING_DIR;
    return configured
        ? resolve(process.cwd(), configured)
        : resolve(process.cwd(), "pocketbase/pb_data/versioning");
}

function repoPath(documentId: string): string {
    return resolve(versioningRoot(), `${documentId}.git`);
}

async function createVersionedNote(): Promise<NoteRecord> {
    const created = await createNote(user, {
        title: `Versioned note ${uniqueSuffix()}`,
        content: "# Version one\n\nFirst body.",
        tags: ["alpha"],
    });
    return pbGetRecord<NoteRecord>(user.token, "documents", created.id);
}

async function saveVersion(
    actor: TestUser,
    note: NoteRecord,
    revision = note.revision,
): Promise<Response> {
    return bunRequest(versionPath(note.id), {
        method: "POST",
        headers: jsonHeaders(actor.token),
        body: JSON.stringify({ expectedRevision: revision }),
    });
}

async function updateNote(note: NoteRecord, changes: Record<string, unknown>): Promise<NoteRecord> {
    const response = await bunRequest(api(`/records/documents/${encodeURIComponent(note.id)}`), {
        method: "PATCH",
        headers: jsonHeaders(user.token),
        body: JSON.stringify({ ...changes, revision: note.revision }),
    });
    await expectStatus(response, 200, "update document");
    return readJson<NoteRecord>(response, "update document");
}

async function updateContent(note: NoteRecord, content: string): Promise<NoteRecord> {
    return updateNote(note, { content });
}

async function readVersions(
    actor: TestUser,
    note: NoteRecord,
    page = 1,
    perPage = 20,
): Promise<{
    items: VersionDto[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
}> {
    const response = await bunRequest(
        `${versionPath(note.id)}?page=${page}&perPage=${perPage}`,
        { headers: authHeaders(actor.token) },
    );
    await expectStatus(response, 200, "list versions");
    return readJson<{
        items: VersionDto[];
        page: number;
        perPage: number;
        totalItems: number;
        totalPages: number;
    }>(response, "list versions");
}

beforeAll(async () => {
    user = await createUser("versions-user");
    other = await createUser("versions-other");
});

describe("browser version history", () => {
    test("saves the current note, deduplicates, lists, and reads one version", async () => {
        const note = await createVersionedNote();

        const firstResponse = await saveVersion(user, note);
        await expectStatus(firstResponse, 200, "save first version");
        const first = await readJson<{ created: boolean; version: VersionDto }>(
            firstResponse,
            "save first version",
        );
        expect(first.created).toBe(true);
        expect(first.version.document).toBe(note.id);
        expect(first.version.version_number).toBe(1);
        expect(first.version.change_summary).toBe("Saved version");
        expect(first.version.id).toMatch(/^[0-9a-f]{40}$/);
        expect("content" in first.version).toBe(false);

        const repeatedResponse = await saveVersion(user, note);
        await expectStatus(repeatedResponse, 200, "repeat save");
        const repeated = await readJson<{ created: boolean; version: VersionDto }>(
            repeatedResponse,
            "repeat save",
        );
        expect(repeated.created).toBe(false);
        expect(repeated.version.id).toBe(first.version.id);

        const updated = await updateContent(note, "# Version two\n\nSecond body.");
        const secondResponse = await saveVersion(user, updated);
        await expectStatus(secondResponse, 200, "save second version");
        const second = await readJson<{ created: boolean; version: VersionDto }>(
            secondResponse,
            "save second version",
        );
        expect(second.created).toBe(true);
        expect(second.version.version_number).toBe(2);

        const list = await readVersions(user, note, 1, 1);
        expect(list.page).toBe(1);
        expect(list.perPage).toBe(1);
        expect(list.totalItems).toBe(2);
        expect(list.totalPages).toBe(2);
        expect(list.items[0]?.version_number).toBe(2);
        expect(list.items[0]?.id).toBe(second.version.id);
        expect((list.items[0] as unknown as { content?: unknown }).content).toBeUndefined();

        const clampedResponse = await bunRequest(
            `${versionPath(note.id)}?page=0&perPage=500`,
            { headers: authHeaders(user.token) },
        );
        await expectStatus(clampedResponse, 200, "clamp pagination");
        const clamped = await readJson<{
            page: number;
            perPage: number;
            totalItems: number;
        }>(clampedResponse, "clamp pagination");
        expect(clamped.page).toBe(1);
        expect(clamped.perPage).toBe(100);
        expect(clamped.totalItems).toBe(2);

        const detailResponse = await bunRequest(
            `${versionPath(note.id)}/${first.version.id}`,
            { headers: authHeaders(user.token) },
        );
        await expectStatus(detailResponse, 200, "read first version");
        const detail = await readJson<VersionDetailDto>(detailResponse, "read first version");
        expect(detail.version_number).toBe(1);
        expect(detail.content).toBe(note.content);
        expect(detail.metadata.title).toBe(note.title);
        expect(detail.metadata.tags).toEqual(["alpha"]);

        const invalid = await bunRequest(`${versionPath(note.id)}/not-a-version`, {
            headers: authHeaders(user.token),
        });
        await expectStatus(invalid, 404, "invalid version id");

        const missing = await bunRequest(`${versionPath(note.id)}/${"a".repeat(40)}`, {
            headers: authHeaders(user.token),
        });
        await expectStatus(missing, 404, "unknown version id");
    });

    test("restores the body after committing the current state", async () => {
        const note = await createVersionedNote();

        const firstResponse = await saveVersion(user, note);
        await expectStatus(firstResponse, 200, "save first version");
        const first = await readJson<{ version: VersionDto }>(firstResponse);
        const updated = await updateContent(note, "# Version two\n\nCurrent work.");
        const secondResponse = await saveVersion(user, updated);
        await expectStatus(secondResponse, 200, "save second version");

        // Leave an unsaved editor change so restore must precommit it. The
        // metadata change also proves restore writes only the body.
        const unsaved = await updateNote(updated, {
            content: "# Version three\n\nUnsaved work.",
            title: `${updated.title} renamed`,
            tags: ["renamed"],
        });

        const restoreResponse = await bunRequest(
            `${versionPath(note.id)}/${first.version.id}/restore`,
            {
                method: "POST",
                headers: jsonHeaders(user.token),
                body: JSON.stringify({ expectedRevision: unsaved.revision }),
            },
        );
        await expectStatus(restoreResponse, 200, "restore first version");
        const restored = await readJson<{ document: NoteRecord }>(
            restoreResponse,
            "restore first version",
        );
        expect(restored.document.content).toBe(note.content);

        // Metadata is not part of a restore.
        const restoredRecord = await pbGetRecord<NoteRecord>(user.token, "documents", note.id);
        expect(restoredRecord.title).toBe(unsaved.title);
        expect(restoredRecord.tags).toEqual(["renamed"]);

        // The pre-restore snapshot is a version; the restored body is not.
        const list = await readVersions(user, note);
        expect(list.totalItems).toBe(3);
        expect(list.items[0]?.version_number).toBe(3);
        expect(list.items[0]?.change_summary).toBe("Saved before restoring Version 1");

        const preRestoreResponse = await bunRequest(
            `${versionPath(note.id)}/${list.items[0]!.id}`,
            { headers: authHeaders(user.token) },
        );
        await expectStatus(preRestoreResponse, 200, "read pre-restore version");
        const preRestore = await readJson<VersionDetailDto>(preRestoreResponse);
        expect(preRestore.content).toBe(unsaved.content);
        expect(preRestore.metadata.title).toBe(unsaved.title);
        expect(preRestore.metadata.tags).toEqual(["renamed"]);

        const selectedResponse = await bunRequest(
            `${versionPath(note.id)}/${first.version.id}`,
            { headers: authHeaders(user.token) },
        );
        await expectStatus(selectedResponse, 200, "read selected version");
        const selected = await readJson<VersionDetailDto>(selectedResponse);
        expect(selected.version_number).toBe(1);
        expect(selected.content).toBe(note.content);
    });

    test("rejects a stale revision without creating a commit", async () => {
        const note = await createVersionedNote();

        const staleSave = await saveVersion(user, note, note.revision + 1);
        await expectStatus(staleSave, 409, "stale save");

        const staleRestore = await bunRequest(
            `${versionPath(note.id)}/${"b".repeat(40)}/restore`,
            {
                method: "POST",
                headers: jsonHeaders(user.token),
                body: JSON.stringify({ expectedRevision: note.revision + 1 }),
            },
        );
        await expectStatus(staleRestore, 409, "stale restore");

        const list = await readVersions(user, note);
        expect(list.totalItems).toBe(0);
    });

    test("hides versions from anyone but the owner", async () => {
        const note = await createVersionedNote();
        const savedResponse = await saveVersion(user, note);
        await expectStatus(savedResponse, 200, "save owner version");
        const saved = await readJson<{ version: VersionDto }>(savedResponse);

        const list = await bunRequest(versionPath(note.id), { headers: authHeaders(other.token) });
        await expectStatus(list, 404, "foreign version list");

        const detail = await bunRequest(`${versionPath(note.id)}/${saved.version.id}`, {
            headers: authHeaders(other.token),
        });
        await expectStatus(detail, 404, "foreign version detail");

        const save = await saveVersion(other, note);
        await expectStatus(save, 404, "foreign save");

        const restore = await bunRequest(
            `${versionPath(note.id)}/${saved.version.id}/restore`,
            {
                method: "POST",
                headers: jsonHeaders(other.token),
                body: JSON.stringify({ expectedRevision: note.revision }),
            },
        );
        await expectStatus(restore, 404, "foreign restore");
    });

    test("keeps the repository in trash and removes it on permanent delete", async () => {
        const note = await createVersionedNote();
        const saved = await saveVersion(user, note);
        await expectStatus(saved, 200, "save before delete");
        expect(existsSync(repoPath(note.id))).toBe(true);

        const trash = await bunRequest(api("/trash/move-document"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ documentId: note.id }),
        });
        await expectStatus(trash, 200, "move note to trash");
        const trashBody = await readJson<{ trashDocumentId: string }>(trash);
        expect(existsSync(repoPath(note.id))).toBe(true);

        const hidden = await bunRequest(versionPath(note.id), {
            headers: authHeaders(user.token),
        });
        await expectStatus(hidden, 404, "versions for a trashed note");

        const remove = await bunRequest(api("/trash/permanent-delete-document"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ trashDocumentId: trashBody.trashDocumentId }),
        });
        await expectStatus(remove, 200, "permanent delete note");
        expect(existsSync(repoPath(note.id))).toBe(false);
    });

    test("removes repositories for every note in a permanently deleted folder tree", async () => {
        const root = await createFolder(user, { name: `Versions root ${uniqueSuffix()}` });
        const child = await createFolder(user, {
            name: `Versions child ${uniqueSuffix()}`,
            parent: root.id,
        });
        const note = await createNote(user, {
            title: `Nested versioned note ${uniqueSuffix()}`,
            content: "# Nested\n\nFolder body.",
            folder: child.id,
        });
        const loaded = await pbGetRecord<NoteRecord>(user.token, "documents", note.id);

        const saved = await saveVersion(user, loaded);
        await expectStatus(saved, 200, "save nested version");
        expect(existsSync(repoPath(note.id))).toBe(true);

        const trash = await bunRequest(api("/trash/move-folder"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ folderId: root.id }),
        });
        await expectStatus(trash, 200, "move folder to trash");
        const trashBody = await readJson<{ trashFolderId: string }>(trash);
        expect(existsSync(repoPath(note.id))).toBe(true);

        const remove = await bunRequest(api("/trash/permanent-delete-folder"), {
            method: "POST",
            headers: jsonHeaders(user.token),
            body: JSON.stringify({ trashFolderId: trashBody.trashFolderId }),
        });
        await expectStatus(remove, 200, "permanent delete folder");
        expect(existsSync(repoPath(note.id))).toBe(false);
    });
});
