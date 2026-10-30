import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectJsonError,
    expectStatus,
    postJson,
    readJson,
} from "../helpers/client";
import { createConversation, createUser, type TestUser } from "../helpers/factories";
import {
    appendMessage,
    getConversationMessages,
    trimLastExchange,
} from "../../src/api/chat/pocketbase";

describe("Chat API", () => {
    let user: TestUser;
    let other: TestUser;

    beforeAll(async () => {
        user = await createUser("api-chat");
        other = await createUser("api-chat-other");
    });

    describe("POST /api/chat/send", () => {
        test("requires authentication", async () => {
            await expectJsonError(
                await postJson("/api/chat/send", { message: "hello" }),
                401,
            );
        });

        test("rejects invalid JSON and empty messages", async () => {
            await expectJsonError(
                await bunRequest("/api/chat/send", {
                    method: "POST",
                    headers: { Authorization: user.token, "Content-Type": "application/json" },
                    body: "{not-json",
                }),
                400,
                "Invalid JSON",
            );

            await expectJsonError(
                await postJson("/api/chat/send", {}, { Authorization: user.token }),
                400,
                "Message is required",
            );
            await expectJsonError(
                await postJson("/api/chat/send", { message: "   " }, { Authorization: user.token }),
                400,
                "Message is required",
            );
        });

        test("validates mode and context before touching the provider", async () => {
            await expectJsonError(
                await postJson(
                    "/api/chat/send",
                    { message: "hello", mode: "write" },
                    { Authorization: user.token },
                ),
                400,
                "ask or edit",
            );

            await expectJsonError(
                await postJson(
                    "/api/chat/send",
                    { message: "hello", context: { type: "document" } },
                    { Authorization: user.token },
                ),
                400,
            );

            await expectJsonError(
                await postJson(
                    "/api/chat/send",
                    { message: "hello", context: { type: "document", id: 'bad"id' } },
                    { Authorization: user.token },
                ),
                400,
            );

            await expectJsonError(
                await postJson(
                    "/api/chat/send",
                    { message: "hello", context: { type: "document", id: "nonexistent123456" } },
                    { Authorization: user.token },
                ),
                404,
            );
        });

        test("returns 503 when no provider is configured", async () => {
            const res = await postJson(
                "/api/chat/send",
                { message: "hello" },
                { Authorization: user.token },
            );

            const body = await expectJsonError(res, 503);
            expect(body.error?.toLowerCase()).toContain("provider");
        });
    });

    describe("conversations", () => {
        test("requires authentication", async () => {
            await expectStatus(await bunRequest("/api/chat/conversations"), 401);
            await expectStatus(
                await bunRequest("/api/chat/conversations/abc123", {
                    method: "DELETE",
                }),
                401,
            );
        });

        test("lists only the caller's conversations", async () => {
            const mine = await createConversation(user, { title: "Mine" });
            const theirs = await createConversation(other, { title: "Theirs" });

            const res = await bunRequest("/api/chat/conversations", {
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 200);
            const data = await readJson<Array<{ id: string; title: string }>>(res);

            const ids = data.map((conversation) => conversation.id);
            expect(ids).toContain(mine.id);
            expect(ids).not.toContain(theirs.id);
        });

        test("returns a conversation and its messages", async () => {
            const conversation = await createConversation(user, {
                title: "History",
                messages: [
                    { role: "user", content: "hello" },
                    { role: "assistant", content: "hi" },
                ],
            });

            const res = await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 200);
            const data = await readJson<{
                conversation: { id: string; title: string };
                messages: Array<{ role: string; content: string }>;
            }>(res);

            expect(data.conversation.id).toBe(conversation.id);
            expect(data.conversation.title).toBe("History");
            expect(data.messages).toEqual([
                { role: "user", content: "hello" },
                { role: "assistant", content: "hi" },
            ]);
        });

        test("appends, reads, and trims messages as separate records", async () => {
            const conversation = await createConversation(user, {
                title: "Append flow",
                messages: [
                    { role: "user", content: "one" },
                    { role: "assistant", content: "two" },
                ],
            });

            const appended = await appendMessage(user.token, conversation.id, {
                role: "user",
                content: "three",
            });
            expect(appended.position).toBe(2);

            const messages = await getConversationMessages(user.token, conversation.id);
            expect(messages.map((message) => message.content)).toEqual(["one", "two", "three"]);

            await trimLastExchange(user.token, conversation.id);
            const trimmed = await getConversationMessages(user.token, conversation.id);
            expect(trimmed.map((message) => message.content)).toEqual(["one", "two"]);
        });

        test("hides another user's conversation behind a 404", async () => {
            const conversation = await createConversation(other, { title: "Private" });

            await expectJsonError(
                await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                    headers: { Authorization: user.token },
                }),
                404,
            );
            await expectJsonError(
                await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                    method: "DELETE",
                    headers: { Authorization: user.token },
                }),
                404,
            );
        });

        test("returns 404 for an unknown conversation", async () => {
            await expectJsonError(
                await bunRequest("/api/chat/conversations/nonexistent123456", {
                    headers: { Authorization: user.token },
                }),
                404,
            );
        });

        test("renames a conversation and validates the title", async () => {
            const conversation = await createConversation(user, { title: "Old title" });

            const res = await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                method: "PATCH",
                headers: {
                    Authorization: user.token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ title: "  New title  " }),
            });
            await expectStatus(res, 200);
            const data = await readJson<{ conversation: { title: string } }>(res);
            expect(data.conversation.title).toBe("New title");

            await expectJsonError(
                await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                    method: "PATCH",
                    headers: {
                        Authorization: user.token,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ title: "   " }),
                }),
                400,
            );

            const theirs = await createConversation(other, { title: "Other" });
            await expectJsonError(
                await bunRequest(`/api/chat/conversations/${theirs.id}`, {
                    method: "PATCH",
                    headers: {
                        Authorization: user.token,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ title: "Nope" }),
                }),
                404,
            );
        });

        test("deletes a conversation", async () => {
            const conversation = await createConversation(user, { title: "Delete me" });

            const res = await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                method: "DELETE",
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 204);

            await expectJsonError(
                await bunRequest(`/api/chat/conversations/${conversation.id}`, {
                    headers: { Authorization: user.token },
                }),
                404,
            );
        });

        test("rejects unsupported methods on the collection route", async () => {
            const res = await postJson(
                "/api/chat/conversations",
                {},
                { Authorization: user.token },
            );
            await expectStatus(res, 404);
        });

        test("serializes context, sources, and stopped flags", async () => {
            const conversation = await createConversation(user, {
                title: "Metadata",
                messages: [],
            });

            await appendMessage(user.token, conversation.id, {
                role: "user",
                content: "what is this?",
                context: { type: "document", id: "note123", title: "Plan" },
            });
            await appendMessage(user.token, conversation.id, {
                role: "assistant",
                content: "A partial answer",
                sources: [{ type: "document", id: "note123", title: "Plan" }],
                stopped: true,
            });

            const messages = await getConversationMessages(user.token, conversation.id);
            expect(messages[0]?.context).toEqual({
                type: "document",
                id: "note123",
                title: "Plan",
            });
            expect(messages[1]?.sources).toEqual([
                { type: "document", id: "note123", title: "Plan" },
            ]);
            expect(messages[1]?.stopped).toBe(true);
        });
    });

    describe("GET /api/chat/status", () => {
        test("requires authentication", async () => {
            await expectStatus(await bunRequest("/api/chat/status"), 401);
        });

        test("reports provider status without secrets", async () => {
            const res = await bunRequest("/api/chat/status", {
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 200);
            const data = await readJson<{
                configured: boolean;
                model: string | null;
                provider: string | null;
                local: boolean;
            }>(res);

            expect(typeof data.configured).toBe("boolean");
            expect(data.model === null || typeof data.model === "string").toBe(true);
            expect(data.provider === null || typeof data.provider === "string").toBe(true);
            expect(typeof data.local).toBe("boolean");
            expect(data).not.toHaveProperty("apiKey");
        });
    });

    describe("edit cards and undo routes", () => {
        test("require authentication", async () => {
            await expectStatus(
                await bunRequest("/api/chat/conversations/nonexistent123456/edits"),
                401,
            );
            await expectStatus(
                await bunRequest("/api/chat/edits/nonexistent123456/undo", { method: "POST" }),
                401,
            );
        });

        test("return 404 for an unknown conversation or edit", async () => {
            await expectJsonError(
                await bunRequest("/api/chat/conversations/nonexistent123456/edits", {
                    headers: { Authorization: user.token },
                }),
                404,
            );
            await expectJsonError(
                await bunRequest("/api/chat/edits/nonexistent123456/undo", {
                    method: "POST",
                    headers: { Authorization: user.token },
                }),
                404,
            );
        });

        test("returns an empty edit list for a conversation with no writes", async () => {
            const conversation = await createConversation(user, { title: "No writes" });
            const res = await bunRequest(`/api/chat/conversations/${conversation.id}/edits`, {
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 200);
            const data = await readJson<{ edits: unknown[] }>(res);
            expect(data.edits).toEqual([]);
        });
    });
});
