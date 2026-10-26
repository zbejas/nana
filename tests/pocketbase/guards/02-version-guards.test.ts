import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbGetRecord, pbList, pbRequest } from "../../helpers/client";
import {
    createNote,
    createUser,
    getSuperuserToken,
    publishNote,
    type TestUser,
} from "../../helpers/factories";

describe("Document version guards", () => {
    let user: TestUser;
    let other: TestUser;
    let superuserToken: string;
    let noteId: string;
    let versionId: string;

    beforeAll(async () => {
        user = await createUser("version-guards");
        other = await createUser("version-guards-other");
        superuserToken = await getSuperuserToken();

        const note = await createNote(user, { title: "Versioned note", content: "version one" });
        noteId = note.id;
        await publishNote(user, note.id, "version two");

        const versions = await pbList<{ id: string; content: string }>(
            user.token,
            "document_versions",
            { filter: `document='${noteId}'`, perPage: 1 },
        );
        expect(versions.items).toHaveLength(1);
        versionId = versions.items[0]!.id;
    });

    test("regular user cannot create document versions directly", async () => {
        const res = await pbRequest("/collections/document_versions/records", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({
                document: noteId,
                title: "Fake version",
                content: "Should not be created",
            }),
        });

        expect(res.ok).toBe(false);
        expect([400, 403, 404]).toContain(res.status);
    });

    test("regular user cannot update a document version", async () => {
        const res = await pbRequest(`/collections/document_versions/records/${versionId}`, {
            method: "PATCH",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Tampered" }),
        });

        // The update rule is empty, so PocketBase may hide the record before the
        // request guard runs. Both outcomes deny the write.
        expect([400, 403, 404]).toContain(res.status);

        const stored = await pbGetRecord<{ content: string }>(
            superuserToken,
            "document_versions",
            versionId,
        );
        expect(stored.content).toBe("version one");
    });

    test("regular user cannot delete a document version", async () => {
        const res = await pbRequest(`/collections/document_versions/records/${versionId}`, {
            method: "DELETE",
            headers: { Authorization: user.token },
        });

        expect(res.ok).toBe(false);
        expect([400, 403, 404]).toContain(res.status);
        expect(
            await pbGetRecord<{ id: string }>(superuserToken, "document_versions", versionId),
        ).toHaveProperty("id");
    });

    test("unauthenticated users cannot create document versions", async () => {
        const res = await pbRequest("/collections/document_versions/records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                document: noteId,
                content: "Unauthenticated attempt",
            }),
        });

        expect(res.ok).toBe(false);
        expect([400, 401, 403, 404]).toContain(res.status);
    });

    test("another user cannot list or read the versions", async () => {
        const list = await pbList<{ id: string }>(other.token, "document_versions", {
            filter: `document='${noteId}'`,
        });
        expect(list.items).toEqual([]);

        const res = await pbRequest(`/collections/document_versions/records/${versionId}`, {
            headers: { Authorization: other.token },
        });
        await expectStatus(res, 404, "read another user's version");
    });
});
