import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    BASE_URL,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
    signupUser,
} from "../../helpers/setup";

const PUBLIC_API = `${BASE_URL}/pb/api/public`;

describe("Public Share Routes", () => {
    let superuserToken: string;
    let userToken: string;
    let userId: string;

    let docCounter = 0;
    let folderCounter = 0;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Ensure at least one user exists (for signup guard)
        const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
            headers: { Authorization: superuserToken },
        });
        const checkData = await checkRes.json();
        if (checkData.items.length === 0) {
            await signupUser({ email: "first@test.local", password: "testPassword123!" });
        }

        // Create test user if not exists
        const email = "public-share-test@test.local";
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='${email}')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = await listRes.json();
        if (listData.items.length === 0) {
            await createTestUser(superuserToken, {
                email,
                password: "testPassword123!",
                name: "Public Share Test User",
            });
        }

        const auth = await authenticateUser(email, "testPassword123!");
        userToken = auth.token;
        userId = auth.record.id;
    });

    // --- Helpers ---

    function uniqueToken(): string {
        return `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async function createDocument(title: string, content: string, folder?: string): Promise<any> {
        docCounter++;
        const slug = `pub-share-doc-${Date.now()}-${docCounter}`;
        const body: any = { title, slug, content, author: userId };
        if (folder) body.folder = folder;

        const res = await fetch(`${PB_API}/collections/documents/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify(body),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function patchRecord(
        collection: string,
        id: string,
        data: Record<string, any>,
    ): Promise<any> {
        const res = await fetch(`${PB_API}/collections/${collection}/records/${id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: superuserToken,
            },
            body: JSON.stringify(data),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function createFolder(name: string, parentId?: string): Promise<any> {
        folderCounter++;
        const body: any = { name, author: userId };
        if (parentId) body.parent = parentId;

        const res = await fetch(`${PB_API}/collections/folders/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify(body),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    // ──────────────────────────────────────────
    // Document Shares
    // ──────────────────────────────────────────

    describe("GET /api/public/documents/{shareToken}", () => {
        test("returns 404 for non-existent share token", async () => {
            const res = await fetch(`${PUBLIC_API}/documents/does-not-exist-token`);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBeDefined();
        });

        test("returns 404 for document with is_public=false", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Not Public", "hidden content");
            await patchRecord("documents", doc.id, {
                is_public: false,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for document with is_private=true even if is_public=true", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Private Override", "private content");
            await patchRecord("documents", doc.id, {
                is_public: true,
                is_private: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for expired share token", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Expired Doc", "expired content");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(404);

            // Verify the share was auto-disabled
            const recordRes = await fetch(
                `${PB_API}/collections/documents/records/${doc.id}`,
                { headers: { Authorization: superuserToken } },
            );
            const record = await recordRes.json();
            expect(record.is_public).toBe(false);
            expect(record.public_share_token).toBe("");
        });

        test("returns document data for valid public share", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Public Doc", "public content here");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: false,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.type).toBe("document");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author).toBeDefined();
            expect(data.author.id).toBe(userId);
            expect(data.author.name).toBeTruthy();
            expect(data.document).toBeDefined();
            expect(data.document.id).toBe(doc.id);
            expect(data.document.title).toBe("Public Doc");
            expect(data.document.content).toBe("public content here");
        });

        test("response includes correct document fields", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Field Check", "checking all fields");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            const d = data.document;
            expect(d).toHaveProperty("id");
            expect(d).toHaveProperty("title");
            expect(d).toHaveProperty("slug");
            expect(d).toHaveProperty("content");
            expect(d).toHaveProperty("attachments");
            expect(d).toHaveProperty("tags");
            expect(d).toHaveProperty("author");
            expect(d).toHaveProperty("folder");
            expect(d).toHaveProperty("word_count");
            expect(d).toHaveProperty("reading_time");
            expect(d).toHaveProperty("created");
            expect(d).toHaveProperty("updated");
        });

        test("expiresAt is null when no expiry set", async () => {
            const token = uniqueToken();
            const doc = await createDocument("No Expiry", "no expiry content");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.expiresAt).toBeNull();
        });

        test("expiresAt is returned when future expiry set", async () => {
            const token = uniqueToken();
            const doc = await createDocument("Future Expiry", "future expiry content");
            const futureDate = "2099-12-31 23:59:59.000Z";
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
                public_expires_at: futureDate,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.expiresAt).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────
    // Document Attachment Access
    // ──────────────────────────────────────────

    describe("GET /api/public/documents/{shareToken}/files/{filename}", () => {
        test("returns 404 when share_attachments is false", async () => {
            const token = uniqueToken();
            const doc = await createDocument("No Attachments", "no attachments");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: false,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}/files/test.png`);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBeDefined();
        });

        test("returns 404 for non-existent filename", async () => {
            const token = uniqueToken();
            const doc = await createDocument("With Attachments", "has attachments");
            await patchRecord("documents", doc.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: true,
            });

            const res = await fetch(`${PUBLIC_API}/documents/${token}/files/nonexistent.png`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for non-existent share token", async () => {
            const res = await fetch(`${PUBLIC_API}/documents/fake-token/files/test.png`);
            expect(res.status).toBe(404);
        });
    });

    // ──────────────────────────────────────────
    // Folder Shares
    // ──────────────────────────────────────────

    describe("GET /api/public/folders/{shareToken}", () => {
        test("returns 404 for non-existent folder share token", async () => {
            const res = await fetch(`${PUBLIC_API}/folders/does-not-exist-token`);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBeDefined();
        });

        test("returns 404 for folder with is_public=false", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Not Public Folder");
            await patchRecord("folders", folder.id, {
                is_public: false,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for folder with is_private=true", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Private Folder");
            await patchRecord("folders", folder.id, {
                is_public: true,
                is_private: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for expired folder share", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Expired Folder");
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                public_expires_at: "2020-01-01 00:00:00.000Z",
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(404);

            // Verify auto-disable
            const recordRes = await fetch(
                `${PB_API}/collections/folders/records/${folder.id}`,
                { headers: { Authorization: superuserToken } },
            );
            const record = await recordRes.json();
            expect(record.is_public).toBe(false);
            expect(record.public_share_token).toBe("");
        });

        test("returns folder data with documents for valid public share", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Public Folder");
            const doc1 = await createDocument("Folder Doc 1", "content 1", folder.id);
            const doc2 = await createDocument("Folder Doc 2", "content 2", folder.id);
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: false,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.type).toBe("folder");
            expect(data.shareToken).toBe(token);
            expect(data.shareAttachments).toBe(false);
            expect(data.author).toBeDefined();
            expect(data.author.id).toBe(userId);
            expect(data.rootFolder).toBeDefined();
            expect(data.rootFolder.id).toBe(folder.id);
            expect(data.rootFolder.name).toBe("Public Folder");
            expect(data.documents).toBeArray();
            expect(data.documents.length).toBeGreaterThanOrEqual(2);

            const docIds = data.documents.map((d: any) => d.id);
            expect(docIds).toContain(doc1.id);
            expect(docIds).toContain(doc2.id);
        });

        test("response includes correct folder fields", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Field Check Folder");
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            const f = data.rootFolder;
            expect(f).toHaveProperty("id");
            expect(f).toHaveProperty("name");
            expect(f).toHaveProperty("parent");
            expect(f).toHaveProperty("author");
            expect(f).toHaveProperty("color");
            expect(f).toHaveProperty("created");
            expect(f).toHaveProperty("updated");

            expect(data).toHaveProperty("folders");
            expect(data).toHaveProperty("documents");
            expect(data).toHaveProperty("entryDocumentId");
        });

        test("excludes private documents from folder share", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Folder With Private Doc");
            const publicDoc = await createDocument("Visible Doc", "visible", folder.id);
            const privateDoc = await createDocument("Hidden Doc", "hidden", folder.id);

            // Mark one document as private
            await patchRecord("documents", privateDoc.id, { is_private: true });
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            const docIds = data.documents.map((d: any) => d.id);
            expect(docIds).toContain(publicDoc.id);
            expect(docIds).not.toContain(privateDoc.id);
        });

        test("excludes private subfolders from folder share", async () => {
            const token = uniqueToken();
            const rootFolder = await createFolder("Root With Subfolder");
            const publicChild = await createFolder("Public Child", rootFolder.id);
            const privateChild = await createFolder("Private Child", rootFolder.id);

            await patchRecord("folders", privateChild.id, { is_private: true });
            await patchRecord("folders", rootFolder.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            const folderIds = data.folders.map((f: any) => f.id);
            expect(folderIds).toContain(rootFolder.id);
            expect(folderIds).toContain(publicChild.id);
            expect(folderIds).not.toContain(privateChild.id);
        });

        test("includes nested subfolders and their documents", async () => {
            const token = uniqueToken();
            const root = await createFolder("Nested Root");
            const child = await createFolder("Nested Child", root.id);
            const childDoc = await createDocument("Nested Doc", "nested content", child.id);

            await patchRecord("folders", root.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            const folderIds = data.folders.map((f: any) => f.id);
            expect(folderIds).toContain(root.id);
            expect(folderIds).toContain(child.id);

            const docIds = data.documents.map((d: any) => d.id);
            expect(docIds).toContain(childDoc.id);
        });

        test("entryDocumentId is null when folder has no documents", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Empty Folder");
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}`);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.entryDocumentId).toBeNull();
        });
    });

    // ──────────────────────────────────────────
    // Folder Attachment Access
    // ──────────────────────────────────────────

    describe("GET /api/public/folders/{shareToken}/files/{documentId}/{filename}", () => {
        test("returns 404 when share_attachments is false", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Folder No Attach");
            const doc = await createDocument("Doc In Folder", "content", folder.id);
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: false,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}/files/${doc.id}/test.png`);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBeDefined();
        });

        test("returns 404 for non-existent filename", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Folder Attach Check");
            const doc = await createDocument("Doc For Attach", "content", folder.id);
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: true,
            });

            const res = await fetch(
                `${PUBLIC_API}/folders/${token}/files/${doc.id}/nonexistent.png`,
            );
            expect(res.status).toBe(404);
        });

        test("returns 404 for non-existent share token", async () => {
            const res = await fetch(`${PUBLIC_API}/folders/fake-token/files/fakeid/test.png`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for private document within shared folder", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Folder Private Doc Attach");
            const doc = await createDocument("Private Doc Attach", "content", folder.id);
            await patchRecord("documents", doc.id, { is_private: true });
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: true,
            });

            const res = await fetch(`${PUBLIC_API}/folders/${token}/files/${doc.id}/test.png`);
            expect(res.status).toBe(404);
        });

        test("returns 404 for document not in folder's descendant tree", async () => {
            const token = uniqueToken();
            const folder = await createFolder("Scoped Folder");
            const outsideDoc = await createDocument("Outside Doc", "not in folder");
            await patchRecord("folders", folder.id, {
                is_public: true,
                public_share_token: token,
                share_attachments: true,
            });

            const res = await fetch(
                `${PUBLIC_API}/folders/${token}/files/${outsideDoc.id}/test.png`,
            );
            expect(res.status).toBe(404);
        });
    });
});
