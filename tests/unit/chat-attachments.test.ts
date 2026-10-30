import { describe, expect, test } from "bun:test";
import {
    ChatAttachmentError,
    assertAttachmentLimits,
    assertModelSupportsAttachments,
    attachmentTextBlock,
    detectAttachment,
    extractAttachmentText,
    sanitizeAttachmentName,
} from "../../src/api/chat/attachments";
import { sanitizeAttachmentRef } from "../../src/api/chat/types";
import { DEFAULT_AI_ATTACHMENT_SETTINGS, type AIModelCapabilities } from "../../src/lib/ai/types";

const encoder = new TextEncoder();

function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
}

function tinyPdf(text = "Hello Nana attachment"): Uint8Array {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${text.length + 32} >>\nstream\nBT\n/F1 18 Tf\n72 72 Td\n(${text}) Tj\nET\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return encoder.encode(out);
}

const capabilities = (overrides: Partial<AIModelCapabilities> = {}): AIModelCapabilities => ({
    vision: true,
    files: true,
    tools: true,
    reasoning: false,
    ...overrides,
});

describe("attachment byte detection", () => {
    test("classifies supported image signatures", () => {
        expect(detectAttachment(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0), "image/png", "shot.png")).toEqual({
            kind: "image",
            mimeType: "image/png",
            name: "shot.png",
        });
        expect(detectAttachment(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg", "photo.jpg").mimeType).toBe("image/jpeg");
        expect(detectAttachment(encoder.encode("GIF89a...."), "image/gif", "anim.gif").mimeType).toBe("image/gif");
        expect(detectAttachment(
            encoder.encode("RIFF1234WEBP...."),
            "image/webp",
            "image.webp",
        ).mimeType).toBe("image/webp");
    });

    test("classifies a PDF from its magic bytes", () => {
        const detected = detectAttachment(tinyPdf(), "application/pdf", "report.pdf");
        expect(detected.kind).toBe("pdf");
        expect(detected.mimeType).toBe("application/pdf");
    });

    test("classifies text and Markdown without trusting the file name alone", () => {
        expect(detectAttachment(encoder.encode("plain text"), "text/plain", "notes.txt")).toEqual({
            kind: "text",
            mimeType: "text/plain",
            name: "notes.txt",
        });
        expect(detectAttachment(encoder.encode("# heading"), "text/markdown", "notes.md").mimeType).toBe("text/markdown");
        expect(detectAttachment(encoder.encode("# heading"), "", "notes.md").mimeType).toBe("text/markdown");
    });

    test("rejects SVG even when it is declared or disguised as text", () => {
        for (const [declared, name, body] of [
            ["image/svg+xml", "image.svg", "<svg></svg>"],
            ["text/plain", "image.svg", "<svg></svg>"],
            ["text/plain", "image.txt", '<?xml version="1.0"?><svg></svg>'],
        ] as const) {
            expect(() => detectAttachment(encoder.encode(body), declared, name)).toThrow(ChatAttachmentError);
        }
    });

    test("rejects binary, empty, and mismatched files", () => {
        expect(() => detectAttachment(new Uint8Array(), "text/plain", "empty.txt")).toThrow(ChatAttachmentError);
        expect(() => detectAttachment(bytes(0x50, 0x4b, 0x03, 0x04), "application/zip", "archive.zip")).toThrow(ChatAttachmentError);
        expect(() => detectAttachment(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "application/pdf", "fake.pdf")).toThrow(ChatAttachmentError);
        expect(() => detectAttachment(encoder.encode("bad\u0000text"), "text/plain", "bad.txt")).toThrow(ChatAttachmentError);
    });

    test("strips paths and control characters from stored names", () => {
        expect(sanitizeAttachmentName("../../private/report.pdf")).toBe("report.pdf");
        expect(sanitizeAttachmentName("a\u0000b\nc.md")).toBe("a b c.md");
        expect(sanitizeAttachmentName("   ")).toBe("Attachment");
    });
});

describe("attachment text extraction", () => {
    test("truncates text to the configured character cap", async () => {
        const text = await extractAttachmentText("text", "text/plain", encoder.encode("abcdefghij"), 4);
        expect(text).toBe("abcd");
    });

    test("extracts text from a tiny PDF without network access", async () => {
        const text = await extractAttachmentText("pdf", "application/pdf", tinyPdf(), 100_000);
        expect(text).toContain("Hello Nana attachment");
    });

    test("keeps an empty extraction for an unreadable PDF", async () => {
        const text = await extractAttachmentText("pdf", "application/pdf", encoder.encode("%PDF-1.7 not really"), 1000);
        expect(text).toBe("");
    });

    test("wraps text in a named, sanitized data block", () => {
        expect(attachmentTextBlock('re"port.pdf', "body")).toBe(
            '<attachment name="re_port.pdf">\nbody\n</attachment>',
        );
    });
});

describe("attachment limits and model capabilities", () => {
    const limits = { ...DEFAULT_AI_ATTACHMENT_SETTINGS, enabled: true, maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 15 };

    test("accepts records inside the file, count, and total limits", () => {
        expect(() => assertAttachmentLimits([{ size: 5 }, { size: 5 }], limits)).not.toThrow();
    });

    test("rejects too many files", () => {
        expect(() => assertAttachmentLimits([{ size: 1 }, { size: 1 }, { size: 1 }], limits)).toThrow(ChatAttachmentError);
        try {
            assertAttachmentLimits([{ size: 1 }, { size: 1 }, { size: 1 }], limits);
        } catch (error) {
            expect((error as ChatAttachmentError).status).toBe(400);
        }
    });

    test("rejects a per-file or total size overflow", () => {
        try {
            assertAttachmentLimits([{ size: 11 }], limits);
            throw new Error("expected a size failure");
        } catch (error) {
            expect((error as ChatAttachmentError).status).toBe(413);
        }

        try {
            assertAttachmentLimits([{ size: 10 }, { size: 10 }], limits);
            throw new Error("expected a total failure");
        } catch (error) {
            expect((error as ChatAttachmentError).status).toBe(413);
        }
    });

    test("requires vision for images", () => {
        expect(() => assertModelSupportsAttachments(
            [{ kind: "image", name: "shot.png" }],
            capabilities({ vision: false }),
        )).toThrow(ChatAttachmentError);
    });

    test("falls back to extracted PDF text and rejects a PDF with none", () => {
        expect(() => assertModelSupportsAttachments(
            [{ kind: "pdf", name: "scan.pdf", text: "" }],
            capabilities({ files: false }),
        )).toThrow(ChatAttachmentError);

        expect(() => assertModelSupportsAttachments(
            [{ kind: "pdf", name: "report.pdf", text: "extracted" }],
            capabilities({ files: false }),
        )).not.toThrow();

        expect(() => assertModelSupportsAttachments(
            [{ kind: "pdf", name: "scan.pdf", text: "" }],
            capabilities({ files: true }),
        )).not.toThrow();
    });

    test("text attachments do not require extra model capability", () => {
        expect(() => assertModelSupportsAttachments(
            [{ kind: "text", name: "notes.md", text: "hello" }],
            capabilities({ vision: false, files: false }),
        )).not.toThrow();
    });
});

describe("sanitized attachment refs", () => {
    test("drops extracted text, file names, and unknown fields", () => {
        const ref = sanitizeAttachmentRef({
            id: "abc123",
            name: "  Report\u0000  ",
            mime_type: "application/pdf",
            size: 42,
            kind: "pdf",
            text: "secret extracted text",
            file: "stored_random_name.pdf",
            extra: true,
        });

        expect(ref).toEqual({
            id: "abc123",
            name: "Report",
            mimeType: "application/pdf",
            size: 42,
            kind: "pdf",
        });
        expect(JSON.stringify(ref)).not.toContain("secret");
        expect(JSON.stringify(ref)).not.toContain("stored_random");
    });

    test("rejects invalid ids, kinds, and MIME values", () => {
        expect(sanitizeAttachmentRef({ id: "bad id", name: "x", mimeType: "text/plain", size: 1, kind: "text" })).toBeNull();
        expect(sanitizeAttachmentRef({ id: "abc", name: "x", mimeType: "text/plain", size: 1, kind: "video" })).toBeNull();
        expect(sanitizeAttachmentRef({ id: "abc", name: "x", mimeType: "", size: 1, kind: "text" })).toBeNull();
        expect(sanitizeAttachmentRef({ id: "abc", name: "x", mimeType: "text/plain", size: -1, kind: "text" })).toBeNull();
    });
});
