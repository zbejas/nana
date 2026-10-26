import { beforeAll, describe, expect, test } from "bun:test";
import { pbDelete, pbList, pbRecordExists, pbRequest, readJson } from "../../helpers/client";
import { createNote, createUser, getSuperuserToken, publishNote, type TestUser } from "../../helpers/factories";

describe("Document hooks", () => {
    let user: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        user = await createUser("document-hooks");
        superuserToken = await getSuperuserToken();
    });

    async function getVersions(noteId: string, token = user.token) {
        const page = await pbList<{
            id: string;
            document: string;
            content: string;
            version_number: number;
            change_summary: string;
            source_created_at: string;
        }>(token, "document_versions", {
            filter: `document='${noteId}'`,
            sort: "-version_number",
        });
        return page.items;
    }

    describe("calculate_stats", () => {
        test("counts words and reading time on create", async () => {
            const note = await createNote(user, {
                title: "Stats test",
                content: "Hello world foo bar baz",
            });

            expect(note.word_count).toBe(5);
            expect(note.reading_time).toBe(1);
        });

        test("treats empty and whitespace-only content as zero", async () => {
            const empty = await createNote(user, { title: "Empty", content: "" });
            expect(empty.word_count).toBe(0);
            expect(empty.reading_time).toBe(0);

            const whitespace = await createNote(user, {
                title: "Whitespace",
                content: "   \n\t  ",
            });
            expect(whitespace.word_count).toBe(0);
            expect(whitespace.reading_time).toBe(0);
        });

        test("rounds reading time up at the 200-word boundary", async () => {
            const exactly200 = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
            const note200 = await createNote(user, { title: "200 words", content: exactly200 });
            expect(note200.word_count).toBe(200);
            expect(note200.reading_time).toBe(1);

            const exactly201 = `${exactly200} word200`;
            const note201 = await createNote(user, { title: "201 words", content: exactly201 });
            expect(note201.word_count).toBe(201);
            expect(note201.reading_time).toBe(2);
        });

        test("recalculates stats on update", async () => {
            const note = await createNote(user, { title: "Update stats", content: "one two three" });
            expect(note.word_count).toBe(3);

            const updated = await pbRequest(`/collections/documents/records/${note.id}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ content: "one two" }),
            });
            const data = await readJson<{ word_count: number; reading_time: number }>(updated);
            expect(data.word_count).toBe(2);
            expect(data.reading_time).toBe(1);
        });
    });

    describe("create_version", () => {
        test("publishing stores the previous content and resets the flag", async () => {
            const note = await createNote(user, {
                title: "Version test",
                content: "Version 1 content",
            });

            const updated = await publishNote(user, note.id, "Version 2 content");
            expect(updated.published).toBe(false);

            const versions = await getVersions(note.id);
            expect(versions).toHaveLength(1);
            expect(versions[0]?.document).toBe(note.id);
            expect(versions[0]?.content).toBe("Version 1 content");
            expect(versions[0]?.version_number).toBe(1);
            expect(versions[0]?.change_summary).toMatch(/^Published on \d{4}\.\d{2}\.\d{2}/);
            expect(versions[0]?.source_created_at).toBeTruthy();
        });

        test("increments version numbers for successive publishes", async () => {
            const note = await createNote(user, { title: "Multi version", content: "Content v1" });

            await publishNote(user, note.id, "Content v2");
            await publishNote(user, note.id, "Content v3");

            const versions = await getVersions(note.id);
            expect(versions).toHaveLength(2);
            expect(versions[0]?.version_number).toBe(2);
            expect(versions[0]?.content).toBe("Content v2");
            expect(versions[1]?.version_number).toBe(1);
            expect(versions[1]?.content).toBe("Content v1");
        });

        test("does not create a version for an ordinary update", async () => {
            const note = await createNote(user, { title: "No publish", content: "Original content" });

            await pbRequest(`/collections/documents/records/${note.id}`, {
                method: "PATCH",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ content: "Updated content" }),
            });

            expect(await getVersions(note.id)).toEqual([]);
        });

        test("creating a document with published=true does not create a version", async () => {
            const note = await createNote(user, {
                title: "Published on create",
                content: "First content",
                published: true,
            });

            expect(await getVersions(note.id)).toEqual([]);
        });

        test("deleting a document cascades its versions", async () => {
            const note = await createNote(user, { title: "Cascade", content: "v1" });
            await publishNote(user, note.id, "v2");
            const versions = await getVersions(note.id);
            expect(versions).toHaveLength(1);

            // Owner deletes go through the trash route; the superuser path
            // exercises the relation cascade directly.
            await pbDelete(superuserToken, "documents", note.id);

            const res = await pbRequest(`/collections/document_versions/records/${versions[0]!.id}`, {
                headers: { Authorization: superuserToken },
            });
            expect(res.status).toBe(404);

            // The document itself is gone too.
            expect(await pbRecordExists(superuserToken, "documents", note.id)).toBe(false);
        });
    });
});
