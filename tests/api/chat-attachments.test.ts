import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    pbList,
    pbRecordExists,
    pbUpdate,
    readJson,
} from "../helpers/client";
import {
    createConversation,
    createUser,
    getSuperuserToken,
    type TestUser,
} from "../helpers/factories";
import {
    appendMessage,
    getConversationMessages,
} from "../../src/api/chat/pocketbase";
import {
    ChatAttachmentError,
    bindAttachmentsToMessage,
    resolveAttachments,
} from "../../src/api/chat/attachments";
import type { ChatAttachmentRef } from "../../src/api/chat/types";

interface SettingsRecord {
    id: string;
    value: Record<string, unknown>;
}

const activeLimits = {
    enabled: true,
    maxFiles: 5,
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 25 * 1024 * 1024,
    maxTextChars: 100_000,
};

function upload(token: string | undefined, file: File): Promise<Response> {
    const form = new FormData();
    form.set("file", file);
    return bunRequest("/api/chat/attachments", {
        method: "POST",
        headers: token ? { Authorization: token } : {},
        body: form,
    });
}

function textFile(name = "notes.txt", body = "attachment body"): File {
    return new File([body], name, { type: "text/plain" });
}

function tinyPdf(text = "Hello Nana attachment"): File {
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
    return new File([out], "report.pdf", { type: "application/pdf" });
}

async function expectRejected(
    action: () => Promise<unknown>,
    status: number,
): Promise<ChatAttachmentError> {
    try {
        await action();
    } catch (error) {
        expect(error).toBeInstanceOf(ChatAttachmentError);
        const failure = error as ChatAttachmentError;
        expect(failure.status).toBe(status);
        return failure;
    }
    throw new Error(`expected a ${status} attachment failure`);
}

describe("Chat attachments API", () => {
    let user: TestUser;
    let other: TestUser;
    let settings: SettingsRecord;
    let originalValue: Record<string, unknown>;

    beforeAll(async () => {
        user = await createUser("api-chat-attachments");
        other = await createUser("api-chat-attachments-other");

        const token = await getSuperuserToken();
        const page = await pbList<SettingsRecord>(token, "settings", {
            filter: 'key="ai_config"',
            perPage: 1,
        });
        settings = page.items[0]!;
        originalValue = structuredClone(settings.value);
    });

    afterAll(async () => {
        if (!settings) return;
        const token = await getSuperuserToken();
        await pbUpdate(token, "settings", settings.id, { value: originalValue });
    });

    async function setAttachmentSettings(overrides: Record<string, unknown>): Promise<void> {
        const token = await getSuperuserToken();
        settings.value = {
            ...settings.value,
            attachments: { ...activeLimits, ...overrides },
        };
        await pbUpdate(token, "settings", settings.id, { value: settings.value });
    }

    test("requires authentication", async () => {
        await expectStatus(await upload(undefined, textFile()), 401);
        await expectStatus(
            await bunRequest("/api/chat/attachments/nonexistent123456", { method: "DELETE" }),
            401,
        );
    });

    test("rejects uploads while attachments are disabled", async () => {
        await setAttachmentSettings({ enabled: false });
        const body = await expectJsonError(await upload(user.token, textFile()), 403);
        expect(body).toHaveProperty("error");
        await setAttachmentSettings({ enabled: true });
    });

    test("rejects unsupported, SVG, and oversized files", async () => {
        await setAttachmentSettings({ enabled: true, maxFileBytes: 1024, maxTotalBytes: 25 * 1024 * 1024 });

        await expectJsonError(
            await upload(user.token, new File(["<svg></svg>"], "shape.svg", { type: "image/svg+xml" })),
            415,
        );
        await expectJsonError(
            await upload(user.token, new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "archive.zip", { type: "application/zip" })),
            415,
        );
        await expectJsonError(
            await upload(user.token, new File(["x".repeat(2048)], "large.txt", { type: "text/plain" })),
            413,
        );

        await setAttachmentSettings(activeLimits);
    });

    test("uploads text with only a safe ref in the response", async () => {
        await setAttachmentSettings(activeLimits);
        const res = await upload(user.token, textFile("../../notes.txt", "secret attachment body"));
        await expectStatus(res, 201);
        const data = await readJson<{ attachment: ChatAttachmentRef }>(res);

        expect(data.attachment.kind).toBe("text");
        expect(data.attachment.name).toBe("notes.txt");
        expect(data.attachment.mimeType).toBe("text/plain");
        expect(data.attachment.size).toBeGreaterThan(0);
        expect(data.attachment).not.toHaveProperty("text");
        expect(data.attachment).not.toHaveProperty("file");
        expect(JSON.stringify(data)).not.toContain("secret attachment body");

        const stored = await pbList<Record<string, unknown>>(user.token, "chat_attachments", {
            filter: `id="${data.attachment.id}"`,
            perPage: 1,
        });
        expect(stored.items).toHaveLength(1);
        expect(stored.items[0]?.author).toBe(user.id);
        expect(stored.items[0]?.text).toBe("secret attachment body");

        const otherList = await pbList(other.token, "chat_attachments", { perPage: 1 });
        expect(otherList.totalItems).toBe(0);

        // The generic record facade must not expose the attachment collection.
        await expectStatus(
            await bunRequest("/api/v1/records/chat_attachments", {
                headers: { Authorization: user.token },
            }),
            404,
        );
    });

    test("uploads a PDF and stores server-extracted text", async () => {
        await setAttachmentSettings(activeLimits);
        const res = await upload(user.token, tinyPdf());
        await expectStatus(res, 201);
        const data = await readJson<{ attachment: ChatAttachmentRef }>(res);
        expect(data.attachment.kind).toBe("pdf");
        expect(data.attachment.mimeType).toBe("application/pdf");

        const stored = await pbList<Record<string, unknown>>(user.token, "chat_attachments", {
            filter: `id="${data.attachment.id}"`,
            perPage: 1,
        });
        expect(String(stored.items[0]?.text ?? "")).toContain("Hello Nana attachment");
        expect(JSON.stringify(data)).not.toContain("Hello Nana attachment");

        await bunRequest(`/api/chat/attachments/${data.attachment.id}`, {
            method: "DELETE",
            headers: { Authorization: user.token },
        });
    });

    test("deletes only the caller's draft rows through the route", async () => {
        await setAttachmentSettings(activeLimits);
        const first = await readJson<{ attachment: ChatAttachmentRef }>(
            await upload(user.token, textFile("draft.txt")),
        );

        await expectStatus(
            await bunRequest(`/api/chat/attachments/${first.attachment.id}`, {
                method: "DELETE",
                headers: { Authorization: other.token },
            }),
            404,
        );

        await expectStatus(
            await bunRequest(`/api/chat/attachments/${first.attachment.id}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            }),
            204,
        );
        expect(await pbRecordExists(user.token, "chat_attachments", first.attachment.id)).toBe(false);
    });

    test("resolves owner drafts, persists safe refs, binds, and refuses bound deletes", async () => {
        await setAttachmentSettings(activeLimits);
        const uploaded = await readJson<{ attachment: ChatAttachmentRef }>(
            await upload(user.token, textFile("history.txt", "text for the model")),
        );

        const records = await resolveAttachments(
            user.token,
            user.id,
            [uploaded.attachment.id],
            activeLimits,
        );
        expect(records[0]?.text).toBe("text for the model");

        await expectRejected(
            () => resolveAttachments(other.token, other.id, [uploaded.attachment.id], activeLimits),
            404,
        );

        const conversation = await createConversation(user, { title: "Attachment history", messages: [] });
        const saved = await appendMessage(user.token, conversation.id, {
            role: "user",
            content: "",
            attachments: [uploaded.attachment],
        });
        await bindAttachmentsToMessage(
            user.token,
            user.id,
            [uploaded.attachment.id],
            conversation.id,
            saved.id,
        );

        const messages = await getConversationMessages(user.token, conversation.id);
        expect(messages[0]?.attachments).toEqual([uploaded.attachment]);
        expect(JSON.stringify(messages)).not.toContain("text for the model");

        await expectRejected(
            () => resolveAttachments(user.token, user.id, [uploaded.attachment.id], activeLimits),
            400,
        );

        await expectStatus(
            await bunRequest(`/api/chat/attachments/${uploaded.attachment.id}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            }),
            409,
        );
    });

    test("accepts an attachment-only send shape and rejects an empty turn", async () => {
        await setAttachmentSettings(activeLimits);

        await expectJsonError(
            await bunRequest("/api/chat/send", {
                method: "POST",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ message: "" }),
            }),
            400,
        );

        await expectJsonError(
            await bunRequest("/api/chat/send", {
                method: "POST",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ message: "", attachmentIds: ["bad id"] }),
            }),
            400,
        );

        const uploaded = await readJson<{ attachment: ChatAttachmentRef }>(
            await upload(user.token, textFile("send.txt")),
        );

        // No model is configured in the integration stack, so a valid
        // attachment-only turn reaches the model check and returns 503.
        await expectJsonError(
            await bunRequest("/api/chat/send", {
                method: "POST",
                headers: { Authorization: user.token, "Content-Type": "application/json" },
                body: JSON.stringify({ message: "", attachmentIds: [uploaded.attachment.id] }),
            }),
            503,
        );

        // Leave no draft behind for later test files.
        await bunRequest(`/api/chat/attachments/${uploaded.attachment.id}`, {
            method: "DELETE",
            headers: { Authorization: user.token },
        });
    });
});
