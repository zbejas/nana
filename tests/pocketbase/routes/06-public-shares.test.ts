import { beforeAll, describe, expect, test } from "bun:test";
import {
    expectJsonError,
    expectStatus,
    pbRequest,
    readJson,
} from "../../helpers/client";
import {
    createFolder,
    createNote,
    createNoteWithAttachment,
    createUser,
    superuserUpdate,
    type TestUser,
} from "../../helpers/factories";
import { uniqueSuffix } from "../../helpers/setup";

const PUBLIC_API = "/public";

describe("Public share routes", () => {
    let user: TestUser;

    beforeAll(async () => {
        user = await createUser("public-share");
    });

    function uniqueToken(): string {
        return `share-${uniqueSuffix()}`;
    }

    async function shareDocument(
        noteId: string,
        token: string,
        flags: Record<string, unknown> = {},
    ) {
        return superuserUpdate("documents", noteId, {
            is_public: true,
            public_share_token: token,
            ...flags,
        });
    }

    async function shareFolder(
        folderId: string,
        token: string,
        flags: Record<string, unknown> = {},
    ) {
        return superuserUpdate("folders", folderId, {
            is_public: true,
            public_share_token: token,
            ...flags,
        });
    }

    describe("documents", () => {
        test("returns 404 for an unknown token", async () => {
            await expectJsonError(
                await pbRequest(`${PUBLIC_API}/documents/does-not-exist-token`),
                404,
            );
        });

        test("returns 404 when is_public is false", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await superuserUpdate("documents", note.id, {
                is_public: false,
                public_share_token: token,
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("returns 404 when is_private overrides a public flag", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await superuserUpdate("documents", note.id, {
                is_public: true,
                is_private: true,
                public_share_token: token,
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);
        });

        test("returns 404 for an expired share and disables it", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, {
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });

            await expectStatus(await pbRequest(`${PUBLIC_API}/documents/${token}`), 404);

            const stored = await pbRequest(`/collections/documents/records/${note.id}`, {
                headers: { Authorization: user.token },
            });
            const record = await readJson<{ is_public: boolean; public_share_token: string }>(stored);
            expect(record.is_public).toBe(false);
            expect(record.public_share_token).toBe("");
        });

        test("returns the document and author for a valid share", async () => {
            const token = uniqueToken();
            const note = await createNote(user, {
                title: "Public Doc",
                content: "public content here",
            });
            await shareDocument(note.id, token, { share_attachments: false });

            const res = await pbRequest(`${PUBLIC_API}/documents/${token}`);
            await expectStatus(res, 200);
            const data = await readJson<{
                type: string;
                shareToken: string;
                shareAttachments: boolean;
                author: { id: string; name: string };
                document: Record<string, unknown>;
                expiresAt: string | null;
            }>(res);

            expect(data.type).toBe("document");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author.id).toBe(user.id);
            expect(data.author.name).toBeTruthy();
            expect(data.document.id).toBe(note.id);
            expect(data.document.title).toBe("Public Doc");
            expect(data.document.content).toBe("public content here");
            expect(data.expiresAt).toBeNull();
        });

        test("exposes the documented document fields", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token);

            const data = await readJson<{ document: Record<string, unknown> }>(
                await pbRequest(`${PUBLIC_API}/documents/${token}`),
            );

            expect(Object.keys(data.document).sort()).toEqual(
                [
                    "id",
                    "title",
                    "slug",
                    "content",
                    "attachments",
                    "tags",
                    "author",
                    "folder",
                    "word_count",
                    "reading_time",
                    "created",
                    "updated",
                ].sort(),
            );
        });

        test("returns a future expiry", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, {
                public_expires_at: "2099-12-31 23:59:59.000Z",
            });

            const data = await readJson<{ expiresAt: string | null }>(
                await pbRequest(`${PUBLIC_API}/documents/${token}`),
            );
            expect(data.expiresAt).toBeTruthy();
        });
    });

    describe("document attachments", () => {
        test("serves an attachment when sharing is enabled", async () => {
            const token = uniqueToken();
            const body = new TextEncoder().encode("public attachment");
            const note = await createNoteWithAttachment(user, "public.txt", body);
            const storedName = (note.attachments as string[])[0]!;
            await shareDocument(note.id, token, { share_attachments: true });

            const res = await pbRequest(
                `${PUBLIC_API}/documents/${token}/files/${encodeURIComponent(storedName)}`,
            );
            await expectStatus(res, 200, "public attachment");
            expect(await res.text()).toBe("public attachment");
        });

        test("returns 404 when attachment sharing is disabled", async () => {
            const token = uniqueToken();
            const note = await createNoteWithAttachment(user, "private.txt", new Uint8Array([1]));
            const storedName = (note.attachments as string[])[0]!;
            await shareDocument(note.id, token, { share_attachments: false });

            await expectJsonError(
                await pbRequest(
                    `${PUBLIC_API}/documents/${token}/files/${encodeURIComponent(storedName)}`,
                ),
                404,
            );
        });

        test("returns 404 for an unknown filename or token", async () => {
            const token = uniqueToken();
            const note = await createNote(user);
            await shareDocument(note.id, token, { share_attachments: true });

            await expectStatus(
                await pbRequest(`${PUBLIC_API}/documents/${token}/files/nonexistent.png`),
                404,
            );
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/documents/fake-token/files/test.png`),
                404,
            );
        });
    });

    describe("folders", () => {
        test("returns 404 for unknown, private, or expired folders", async () => {
            await expectJsonError(await pbRequest(`${PUBLIC_API}/folders/does-not-exist-token`), 404);

            const privateToken = uniqueToken();
            const privateFolder = await createFolder(user);
            await superuserUpdate("folders", privateFolder.id, {
                is_public: true,
                is_private: true,
                public_share_token: privateToken,
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${privateToken}`), 404);

            const expiredToken = uniqueToken();
            const expiredFolder = await createFolder(user);
            await shareFolder(expiredFolder.id, expiredToken, {
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });
            await expectStatus(await pbRequest(`${PUBLIC_API}/folders/${expiredToken}`), 404);

            const stored = await readJson<{ is_public: boolean; public_share_token: string }>(
                await pbRequest(`/collections/folders/records/${expiredFolder.id}`, {
                    headers: { Authorization: user.token },
                }),
            );
            expect(stored.is_public).toBe(false);
            expect(stored.public_share_token).toBe("");
        });

        test("returns the folder tree and its documents", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Public Folder" });
            const child = await createFolder(user, { name: "Public Child", parent: folder.id });
            const rootDoc = await createNote(user, { title: "Root doc", folder: folder.id });
            const childDoc = await createNote(user, { title: "Child doc", folder: child.id });
            await shareFolder(folder.id, token, { share_attachments: false });

            const res = await pbRequest(`${PUBLIC_API}/folders/${token}`);
            await expectStatus(res, 200);
            const data = await readJson<{
                type: string;
                shareToken: string;
                shareAttachments: boolean;
                author: { id: string };
                rootFolder: { id: string; name: string };
                folders: Array<{ id: string }>;
                documents: Array<{ id: string }>;
                entryDocumentId: string | null;
                expiresAt: string | null;
            }>(res);

            expect(data.type).toBe("folder");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author.id).toBe(user.id);
            expect(data.rootFolder.id).toBe(folder.id);
            expect(data.rootFolder.name).toBe("Public Folder");
            expect(data.folders.map((item) => item.id)).toEqual(
                expect.arrayContaining([folder.id, child.id]),
            );
            expect(data.documents.map((item) => item.id)).toEqual(
                expect.arrayContaining([rootDoc.id, childDoc.id]),
            );
            expect(data.entryDocumentId).toBeTruthy();
            expect(data.expiresAt).toBeNull();
        });

        test("exposes the documented folder fields", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            await shareFolder(folder.id, token);

            const data = await readJson<{ rootFolder: Record<string, unknown>; folders: unknown[]; documents: unknown[]; entryDocumentId: unknown }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );

            expect(Object.keys(data.rootFolder).sort()).toEqual(
                ["id", "name", "parent", "author", "color", "created", "updated"].sort(),
            );
            expect(Array.isArray(data.folders)).toBe(true);
            expect(Array.isArray(data.documents)).toBe(true);
            expect(data).toHaveProperty("entryDocumentId");
        });

        test("excludes private documents and private subfolders", async () => {
            const token = uniqueToken();
            const root = await createFolder(user, { name: "Root" });
            const publicChild = await createFolder(user, { name: "Public child", parent: root.id });
            const privateChild = await createFolder(user, { name: "Private child", parent: root.id });
            const publicDoc = await createNote(user, { folder: root.id });
            const privateDoc = await createNote(user, { folder: publicChild.id });

            await superuserUpdate("folders", privateChild.id, { is_private: true });
            await superuserUpdate("documents", privateDoc.id, { is_private: true });
            await shareFolder(root.id, token);

            const data = await readJson<{
                folders: Array<{ id: string }>;
                documents: Array<{ id: string }>;
            }>(await pbRequest(`${PUBLIC_API}/folders/${token}`));

            expect(data.folders.map((item) => item.id)).toContain(publicChild.id);
            expect(data.folders.map((item) => item.id)).not.toContain(privateChild.id);
            expect(data.documents.map((item) => item.id)).toContain(publicDoc.id);
            expect(data.documents.map((item) => item.id)).not.toContain(privateDoc.id);
        });

        test("excludes documents outside the shared subtree", async () => {
            const token = uniqueToken();
            const shared = await createFolder(user, { name: "Shared" });
            const outside = await createFolder(user, { name: "Outside" });
            const outsideDoc = await createNote(user, { folder: outside.id });
            await shareFolder(shared.id, token);

            const data = await readJson<{ documents: Array<{ id: string }> }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );
            expect(data.documents.map((item) => item.id)).not.toContain(outsideDoc.id);
        });

        test("entryDocumentId is null for an empty folder", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            await shareFolder(folder.id, token);

            const data = await readJson<{ entryDocumentId: string | null }>(
                await pbRequest(`${PUBLIC_API}/folders/${token}`),
            );
            expect(data.entryDocumentId).toBeNull();
        });
    });

    describe("folder attachments", () => {
        test("serves a document attachment inside the shared tree", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user, { name: "Attachment folder" });
            const body = new TextEncoder().encode("folder attachment");
            const note = await createNoteWithAttachment(user, "inside.txt", body, "text/plain", {
                folder: folder.id,
            });
            const storedName = (note.attachments as string[])[0]!;
            await shareFolder(folder.id, token, { share_attachments: true });

            const res = await pbRequest(
                `${PUBLIC_API}/folders/${token}/files/${note.id}/${encodeURIComponent(storedName)}`,
            );
            await expectStatus(res, 200, "folder attachment");
            expect(await res.text()).toBe("folder attachment");
        });

        test("rejects disabled sharing, unknown files, private docs, and outside docs", async () => {
            const token = uniqueToken();
            const folder = await createFolder(user);
            const outside = await createFolder(user);
            const doc = await createNoteWithAttachment(user, "hidden.txt", new Uint8Array([1]), "text/plain", {
                folder: folder.id,
            });
            const outsideDoc = await createNote(user, { folder: outside.id });
            const storedName = (doc.attachments as string[])[0]!;

            await shareFolder(folder.id, token, { share_attachments: false });
            await expectStatus(
                await pbRequest(
                    `${PUBLIC_API}/folders/${token}/files/${doc.id}/${encodeURIComponent(storedName)}`,
                ),
                404,
            );

            await shareFolder(folder.id, token, { share_attachments: true });
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/${token}/files/${doc.id}/nonexistent.png`),
                404,
            );
            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/fake-token/files/${doc.id}/test.png`),
                404,
            );

            await superuserUpdate("documents", doc.id, { is_private: true });
            await expectStatus(
                await pbRequest(
                    `${PUBLIC_API}/folders/${token}/files/${doc.id}/${encodeURIComponent(storedName)}`,
                ),
                404,
            );

            await expectStatus(
                await pbRequest(`${PUBLIC_API}/folders/${token}/files/${outsideDoc.id}/test.png`),
                404,
            );
        });
    });
});
