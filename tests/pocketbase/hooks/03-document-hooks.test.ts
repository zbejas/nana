import { beforeAll, describe, expect, test } from "bun:test";
import { pbRequest, readJson } from "../../helpers/client";
import { createNote, createUser, type TestUser } from "../../helpers/factories";

describe("Document hooks", () => {
    let user: TestUser;

    beforeAll(async () => {
        user = await createUser("document-hooks");
    });

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
});
