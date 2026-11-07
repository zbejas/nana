import { describe, expect, test } from "bun:test";
import {
    attachmentDisplayName,
    attachmentExtension,
    attachmentKind,
    attachmentMimeType,
    describeAttachment,
    normalizeAttachmentNames,
} from "../../src/lib/attachments";

describe("attachment metadata", () => {
    test("removes PocketBase's random suffix while keeping the extension", () => {
        expect(attachmentDisplayName("Screenshot 2026-11-07_ab12cd34.png")).toBe(
            "Screenshot 2026-11-07.png",
        );
        expect(attachmentDisplayName("report.pdf")).toBe("report.pdf");
        expect(attachmentDisplayName("")).toBe("Attachment");
        expect(attachmentDisplayName("folder\\\\nested_name123.jpg")).toBe("nested.jpg");
    });

    test("classifies images, PDFs, text, and other files", () => {
        expect(attachmentKind("shot_ab12.png")).toBe("image");
        expect(attachmentKind("shot_ab12.JPEG")).toBe("image");
        expect(attachmentKind("brief_ab12.pdf")).toBe("pdf");
        expect(attachmentKind("notes_ab12.md")).toBe("text");
        expect(attachmentKind("archive_ab12.zip")).toBe("file");
    });

    test("maps extensions to MIME types", () => {
        expect(attachmentMimeType("shot_ab12.webp")).toBe("image/webp");
        expect(attachmentMimeType("brief_ab12.pdf")).toBe("application/pdf");
        expect(attachmentMimeType("notes_ab12.markdown")).toBe("text/markdown");
        expect(attachmentMimeType("archive_ab12.zip")).toBe("application/octet-stream");
    });

    test("describes one stored filename", () => {
        expect(describeAttachment("shot_ab12.png")).toEqual({
            filename: "shot_ab12.png",
            name: "shot.png",
            extension: "png",
            kind: "image",
            mimeType: "image/png",
        });
        expect(attachmentExtension("shot_ab12.png")).toBe("png");
    });

    test("normalizes, trims, and bounds the file-field value", () => {
        expect(
            normalizeAttachmentNames([" a_1.png ", "a_1.png", 7, "", "b_2.pdf"], 2),
        ).toEqual(["a_1.png", "b_2.pdf"]);
        expect(normalizeAttachmentNames("not-an-array")).toEqual([]);
    });
});
