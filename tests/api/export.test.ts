import { beforeAll, describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { bunRequest, expectJsonError, expectStatus, postJson, readJson } from "../helpers/client";
import {
    createFolder,
    createNote,
    createNoteWithAttachment,
    createUser,
    type TestUser,
} from "../helpers/factories";

describe("POST /api/export", () => {
    let user: TestUser;
    let other: TestUser;

    beforeAll(async () => {
        user = await createUser("export-user");
        other = await createUser("export-other");
    });

    function exportRequest(token: string | null, body: unknown): Promise<Response> {
        return postJson("/api/export", body, token ? { Authorization: token } : {});
    }

    test("requires authentication", async () => {
        await expectJsonError(await exportRequest(null, { documentIds: ["test"] }), 401);
    });

    test("rejects GET", async () => {
        await expectStatus(
            await bunRequest("/api/export", {
                method: "GET",
                headers: { Authorization: user.token },
            }),
            405,
        );
    });

    test("requires at least one document or folder", async () => {
        await expectJsonError(await exportRequest(user.token, {}), 400);
        await expectJsonError(
            await exportRequest(user.token, { documentIds: [], folderIds: [] }),
            400,
        );
    });

    test("rejects invalid JSON", async () => {
        const res = await bunRequest("/api/export", {
            method: "POST",
            headers: { Authorization: user.token, "Content-Type": "application/json" },
            body: "{not-json",
        });
        await expectJsonError(res, 400, "Invalid JSON");
    });

    test("returns Markdown with frontmatter for one document", async () => {
        const note = await createNote(user, {
            title: "Export Test Document",
            content: "# Hello\n\nThis is a test document for export.",
            tags: ["work", "export"],
        });

        const res = await exportRequest(user.token, { documentIds: [note.id] });
        await expectStatus(res, 200);

        expect(res.headers.get("Content-Type")).toContain("text/markdown");
        expect(res.headers.get("Content-Disposition")).toContain("attachment");
        expect(res.headers.get("Content-Disposition")).toContain(
            'filename="Export_Test_Document.md"',
        );

        const body = await res.text();
        expect(body).toContain("---");
        expect(body).toContain("title: Export Test Document");
        expect(body).toContain("tags: [work, export]");
        expect(body).toContain("# Hello");
        expect(body).toContain("This is a test document for export.");
    });

    test("returns 404 when no requested document is visible", async () => {
        await expectJsonError(
            await exportRequest(user.token, { documentIds: ["nonexistent123456"] }),
            404,
        );
    });

    test("never exports another user's document", async () => {
        const secret = await createNote(other, {
            title: "Secret",
            content: "not yours",
        });

        await expectJsonError(await exportRequest(user.token, { documentIds: [secret.id] }), 404);
    });

    test("preserves folder hierarchy in a ZIP", async () => {
        const rootName = "Export Root";
        const childName = "Child Folder";
        const root = await createFolder(user, { name: rootName });
        const child = await createFolder(user, { name: childName, parent: root.id });
        const rootDoc = await createNote(user, {
            title: "Root Doc",
            content: "Root folder export body.",
            folder: root.id,
        });
        const childDoc = await createNote(user, {
            title: "Child Doc",
            content: "Child folder export body.",
            folder: child.id,
        });

        const res = await exportRequest(user.token, { folderIds: [root.id] });
        await expectStatus(res, 200);
        expect(res.headers.get("Content-Type")).toContain("application/zip");
        expect(res.headers.get("Content-Disposition")).toContain('filename="Export_Root.zip"');

        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        expect(zip.file("Export_Root/Root_Doc.md")).toBeDefined();
        expect(zip.file("Export_Root/Child_Folder/Child_Doc.md")).toBeDefined();

        const rootMarkdown = await zip.file("Export_Root/Root_Doc.md")!.async("text");
        expect(rootMarkdown).toContain("title: Root Doc");
        expect(rootMarkdown).toContain("Root folder export body.");

        const childMarkdown = await zip.file("Export_Root/Child_Folder/Child_Doc.md")!.async("text");
        expect(childMarkdown).toContain("title: Child Doc");
        expect(childMarkdown).toContain("Child folder export body.");

        // Sanity check that the docs were created where expected.
        expect(rootDoc.folder).toBe(root.id);
        expect(childDoc.folder).toBe(child.id);
    });

    test("includes attachments beside their document", async () => {
        const folder = await createFolder(user, { name: "Attachments" });
        const bytes = new TextEncoder().encode("attachment export body");
        const note = await createNoteWithAttachment(
            user,
            "inside.txt",
            bytes,
            "text/plain",
            { title: "Attachment Note", folder: folder.id },
        );

        const res = await exportRequest(user.token, { folderIds: [folder.id] });
        await expectStatus(res, 200);

        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const attachment = zip.file("Attachments/Attachment_Note_attachments/inside.txt");
        expect(attachment).toBeDefined();
        expect(await attachment!.async("text")).toBe("attachment export body");

        const storedName = (note.attachments as string[])[0];
        expect(storedName).toBeTruthy();
    });

    test("zips a selection and sanitizes the requested name", async () => {
        const first = await createNote(user, { title: "First", content: "one" });
        const second = await createNote(user, { title: "Second", content: "two" });

        const res = await exportRequest(user.token, {
            documentIds: [first.id, second.id],
            zipName: "My Export/../",
        });
        await expectStatus(res, 200);

        const disposition = res.headers.get("Content-Disposition") ?? "";
        expect(disposition).toContain(".zip");
        expect(disposition).not.toContain("../");
        expect(disposition).not.toContain("/");

        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        expect(zip.file("First.md")).toBeDefined();
        expect(zip.file("Second.md")).toBeDefined();
    });

    test("deduplicates documents with the same title", async () => {
        const first = await createNote(user, { title: "Same name", content: "one" });
        const second = await createNote(user, { title: "Same name", content: "two" });

        const res = await exportRequest(user.token, { documentIds: [first.id, second.id] });
        await expectStatus(res, 200);

        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        expect(zip.file("Same_name.md")).toBeDefined();
        expect(zip.file("Same_name_2.md")).toBeDefined();
    });

    test("returns 404 for an empty folder", async () => {
        const folder = await createFolder(user, { name: "Empty export" });
        await expectJsonError(await exportRequest(user.token, { folderIds: [folder.id] }), 404);
    });

    test("returns JSON errors without leaking internals", async () => {
        const res = await exportRequest(user.token, { documentIds: ["nonexistent123456"] });
        const data = await readJson<{ error: string }>(res);
        expect(data.error).toBe("No documents found to export");
    });
});
