import { describe, test, expect, beforeAll } from "bun:test";
import { PB_API, authenticateSuperuser, authenticateUser, signupUser } from "../../helpers/setup";

describe("Document Hooks", () => {
    let superuserToken: string;
    let userToken: string;
    let userId: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Check if test user exists, create if not
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='doctest@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = await listRes.json();
        if (listData.items.length === 0) {
            // Ensure at least one user exists first (signup guard)
            const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
                headers: { Authorization: superuserToken },
            });
            const checkData = await checkRes.json();
            if (checkData.items.length === 0) {
                await signupUser({ email: "first@test.local", password: "testPassword123!" });
            }
            await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: superuserToken },
                body: JSON.stringify({
                    email: "doctest@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    name: "Doc Test User",
                }),
            });
        }

        const auth = await authenticateUser("doctest@test.local", "testPassword123!");
        userToken = auth.token;
        userId = auth.record.id;
    });

    let docCounter = 0;

    async function createDocument(title: string, content: string): Promise<any> {
        docCounter++;
        const slug = `test-doc-${Date.now()}-${docCounter}`;
        const res = await fetch(`${PB_API}/collections/documents/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify({ title, slug, content, author: userId }),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function updateDocument(docId: string, fields: Record<string, any>): Promise<any> {
        const res = await fetch(`${PB_API}/collections/documents/records/${docId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify(fields),
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function getDocument(docId: string): Promise<any> {
        const res = await fetch(`${PB_API}/collections/documents/records/${docId}`, {
            headers: { Authorization: userToken },
        });
        expect(res.ok).toBe(true);
        return res.json();
    }

    async function getVersions(docId: string): Promise<any[]> {
        const res = await fetch(
            `${PB_API}/collections/document_versions/records?filter=(document='${docId}')&sort=-version_number`,
            { headers: { Authorization: superuserToken } },
        );
        expect(res.ok).toBe(true);
        const data = await res.json();
        return data.items;
    }

    describe("calculate_stats hook", () => {
        test("sets word_count and reading_time on create", async () => {
            const doc = await createDocument("Stats Test", "Hello world foo bar baz");
            expect(doc.word_count).toBe(5);
            expect(doc.reading_time).toBe(1);
        });

        test("sets word_count=0 and reading_time=0 for empty content", async () => {
            const doc = await createDocument("Empty Doc", "");
            expect(doc.word_count).toBe(0);
            expect(doc.reading_time).toBe(0);
        });

        test("updates word_count and reading_time on update", async () => {
            const doc = await createDocument("Update Stats", "one two three");
            expect(doc.word_count).toBe(3);

            // Generate a long content string (201 words → reading_time = 2)
            const longContent = Array.from({ length: 201 }, (_, i) => `word${i}`).join(" ");
            const updated = await updateDocument(doc.id, { content: longContent });
            expect(updated.word_count).toBe(201);
            expect(updated.reading_time).toBe(2);
        });

        test("handles whitespace-only content as zero words", async () => {
            const doc = await createDocument("Whitespace Doc", "   \n\t  ");
            expect(doc.word_count).toBe(0);
            expect(doc.reading_time).toBe(0);
        });
    });

    describe("create_version hook", () => {
        test("creates a version with old content when published=true", async () => {
            const doc = await createDocument("Version Test", "Version 1 content");

            // Update with published=true
            const updated = await updateDocument(doc.id, {
                content: "Version 2 content",
                published: true,
            });

            // published should be reset to false
            expect(updated.published).toBe(false);

            // A version should exist with the OLD content
            const versions = await getVersions(doc.id);
            expect(versions.length).toBe(1);
            expect(versions[0].document).toBe(doc.id);
            expect(versions[0].content).toBe("Version 1 content");
            expect(versions[0].version_number).toBe(1);
        });

        test("increments version_number on subsequent publishes", async () => {
            const doc = await createDocument("Multi Version", "Content v1");

            // First publish
            await updateDocument(doc.id, { content: "Content v2", published: true });

            // Second publish
            await updateDocument(doc.id, { content: "Content v3", published: true });

            const versions = await getVersions(doc.id);
            expect(versions.length).toBe(2);
            // Sorted by -version_number, so newest first
            expect(versions[0].version_number).toBe(2);
            expect(versions[0].content).toBe("Content v2");
            expect(versions[1].version_number).toBe(1);
            expect(versions[1].content).toBe("Content v1");
        });

        test("does not create a version when published is not set", async () => {
            const doc = await createDocument("No Publish", "Original content");

            // Update without published flag
            await updateDocument(doc.id, { content: "Updated content" });

            const versions = await getVersions(doc.id);
            expect(versions.length).toBe(0);
        });

        test("version has correct change_summary and created_by", async () => {
            const doc = await createDocument("Meta Test", "Some content");

            await updateDocument(doc.id, { content: "New content", published: true });

            const versions = await getVersions(doc.id);
            expect(versions.length).toBe(1);
            expect(versions[0].created_by).toBe(userId);
            expect(versions[0].change_summary).toMatch(/^Published on /);
        });
    });
});
