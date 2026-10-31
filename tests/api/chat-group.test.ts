import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectStatus,
    pbCreate,
    pbList,
    pbRecordExists,
    pbRequest,
    postJson,
    readJson,
} from "../helpers/client";
import {
    createConversation,
    createNote,
    createUser,
    getSuperuserToken,
    superuserUpdate,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, BROWSER_API, uniqueSuffix } from "../helpers/setup";

/**
 * Shared-note chat over the real Bun + PocketBase stack.
 *
 * A note conversation is created server-side with the note owner as its author,
 * stays visible to the owner and every person grantee, and is deliberately
 * ignored by public-link flags. The message rules keep the transcript readable
 * to participants only and record the actual sender on each user turn.
 */

interface ConversationDto {
    id: string;
    title: string;
    author: string;
    scope?: "personal" | "note" | "";
    document?: string;
    can_manage?: boolean;
}

interface NoteChatStatusDto {
    noteId: string;
    noteTitle: string;
    enabled: boolean;
    reason: string | null;
    shared: boolean;
    accessRole: "owner" | "view" | "comment" | "edit";
    accessLevel: number;
    canEdit: boolean;
    canManage: boolean;
    conversation: ConversationDto | null;
}

interface ChatMessageDto {
    id?: string;
    role: "user" | "assistant";
    content: string;
    authorId?: string;
    authorLabel?: string;
}

function jsonHeaders(token: string): Record<string, string> {
    return { ...authHeaders(token), "Content-Type": "application/json" };
}

async function shareNote(
    owner: TestUser,
    noteId: string,
    userId: string,
    permission: "view" | "comment" | "edit",
): Promise<string> {
    const response = await bunRequest(`${BROWSER_API}/sharing/links`, {
        method: "POST",
        headers: jsonHeaders(owner.token),
        body: JSON.stringify({
            targetType: "document",
            targetId: noteId,
            userId,
            permission,
        }),
    });
    await expectStatus(response, 200, `share note ${permission}`);
    const body = await readJson<{ id?: string }>(response, `share note ${permission}`);
    if (typeof body.id !== "string" || !body.id) {
        throw new Error("sharing route did not return a share id");
    }
    return body.id;
}

async function revokeShare(owner: TestUser, shareId: string): Promise<void> {
    const response = await bunRequest(`${BROWSER_API}/sharing/links/${encodeURIComponent(shareId)}`, {
        method: "DELETE",
        headers: authHeaders(owner.token),
    });
    await expectStatus(response, 200, "revoke note share");
}

async function noteChatStatus(user: TestUser, noteId: string): Promise<NoteChatStatusDto> {
    const response = await bunRequest(
        `/api/chat/notes/${encodeURIComponent(noteId)}/chat`,
        { headers: authHeaders(user.token) },
    );
    await expectStatus(response, 200, "note chat status");
    return (await readJson<{ status: NoteChatStatusDto }>(response, "note chat status")).status;
}

async function startNoteChat(
    user: TestUser,
    noteId: string,
): Promise<{ status: NoteChatStatusDto; conversation: ConversationDto }> {
    const response = await postJson(
        `/api/chat/notes/${encodeURIComponent(noteId)}/chat`,
        {},
        authHeaders(user.token),
    );
    await expectStatus(response, 200, "start note chat");
    return readJson<{ status: NoteChatStatusDto; conversation: ConversationDto }>(
        response,
        "start note chat",
    );
}

async function conversationMessages(
    user: TestUser,
    conversationId: string,
): Promise<ChatMessageDto[]> {
    const response = await bunRequest(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
        { headers: authHeaders(user.token) },
    );
    await expectStatus(response, 200, "read group conversation");
    const body = await readJson<{ messages: ChatMessageDto[] }>(response, "read group conversation");
    return body.messages;
}

async function sendToConversation(
    token: string,
    body: Record<string, unknown>,
): Promise<Response> {
    return postJson("/api/chat/send", body, { Authorization: token });
}

describe("shared note chat", () => {
    let owner: TestUser;
    let viewer: TestUser;
    let editor: TestUser;
    let outsider: TestUser;

    beforeAll(async () => {
        owner = await createUser("note-chat-owner");
        viewer = await createUser("note-chat-viewer");
        editor = await createUser("note-chat-editor");
        outsider = await createUser("note-chat-outsider");
    });

    test("reports an unshared note as disabled and refuses to start its chat", async () => {
        const note = await createNote(owner, { title: "Unshared note chat" });

        const status = await noteChatStatus(owner, note.id);
        expect(status).toMatchObject({
            noteId: note.id,
            enabled: false,
            reason: "not_shared",
            shared: false,
            accessRole: "owner",
            canEdit: false,
            canManage: true,
            conversation: null,
        });

        const response = await postJson(
            `/api/chat/notes/${encodeURIComponent(note.id)}/chat`,
            {},
            authHeaders(owner.token),
        );
        await expectStatus(response, 409, "start unshared note chat");
        const body = await readJson<{ error?: string; code?: string }>(response, "start unshared note chat");
        expect(body.code).toBe("note_not_shared");
    });

    test("exposes one conversation to the owner and a view grantee", async () => {
        const note = await createNote(owner, { title: `Shared view ${uniqueSuffix()}` });
        await shareNote(owner, note.id, viewer.id, "view");

        const ownerStatus = await noteChatStatus(owner, note.id);
        expect(ownerStatus).toMatchObject({
            noteId: note.id,
            enabled: true,
            reason: null,
            shared: true,
            accessRole: "owner",
            accessLevel: 3,
            canEdit: true,
            canManage: true,
            conversation: null,
        });

        const viewerStatus = await noteChatStatus(viewer, note.id);
        expect(viewerStatus).toMatchObject({
            noteId: note.id,
            enabled: true,
            reason: null,
            shared: true,
            accessRole: "view",
            accessLevel: 1,
            canEdit: false,
            canManage: false,
            conversation: null,
        });

        const ownerStart = await startNoteChat(owner, note.id);
        expect(ownerStart.status.canManage).toBe(true);
        expect(ownerStart.conversation).toMatchObject({
            author: owner.id,
            scope: "note",
            document: note.id,
            can_manage: true,
        });
        expect(ownerStart.status.conversation?.id).toBe(ownerStart.conversation.id);

        const viewerStart = await startNoteChat(viewer, note.id);
        expect(viewerStart.conversation.id).toBe(ownerStart.conversation.id);
        expect(viewerStart.conversation).toMatchObject({
            author: owner.id,
            scope: "note",
            document: note.id,
            can_manage: false,
        });
        expect(viewerStart.status.canManage).toBe(false);
        expect(viewerStart.status.conversation?.id).toBe(ownerStart.conversation.id);

        const viewerAfter = await noteChatStatus(viewer, note.id);
        expect(viewerAfter.conversation?.id).toBe(ownerStart.conversation.id);
        expect(viewerAfter.conversation?.can_manage).toBe(false);
    });

    test("lets an edit grantee participate with write access but not manage the chat", async () => {
        const note = await createNote(owner, { title: `Shared edit ${uniqueSuffix()}` });
        await shareNote(owner, note.id, editor.id, "edit");

        const status = await noteChatStatus(editor, note.id);
        expect(status).toMatchObject({
            enabled: true,
            shared: true,
            accessRole: "edit",
            accessLevel: 3,
            canEdit: true,
            canManage: false,
        });

        const started = await startNoteChat(editor, note.id);
        expect(started.conversation.author).toBe(owner.id);
        expect(started.conversation.can_manage).toBe(false);
        expect(started.status.canEdit).toBe(true);
        expect(started.status.canManage).toBe(false);
    });

    test("does not enable note chat from a public link alone", async () => {
        const note = await createNote(owner, { title: `Public only ${uniqueSuffix()}` });
        await superuserUpdate("documents", note.id, {
            is_public: true,
            public_share_token: `public-chat-${uniqueSuffix()}`,
        });

        const ownerStatus = await noteChatStatus(owner, note.id);
        expect(ownerStatus).toMatchObject({
            enabled: false,
            reason: "not_shared",
            shared: false,
            conversation: null,
        });

        const outsiderStatus = await bunRequest(
            `/api/chat/notes/${encodeURIComponent(note.id)}/chat`,
            { headers: authHeaders(outsider.token) },
        );
        await expectStatus(outsiderStatus, 404, "public-only note chat status");

        const start = await postJson(
            `/api/chat/notes/${encodeURIComponent(note.id)}/chat`,
            {},
            authHeaders(owner.token),
        );
        await expectStatus(start, 409, "public-only note chat start");
        expect((await readJson<{ code?: string }>(start, "public-only note chat start")).code)
            .toBe("note_not_shared");
    });

    test("keeps the history for the owner and hides it from the grantee after unshare", async () => {
        const note = await createNote(owner, { title: `Unshared again ${uniqueSuffix()}` });
        const shareId = await shareNote(owner, note.id, viewer.id, "view");
        const started = await startNoteChat(viewer, note.id);

        await revokeShare(owner, shareId);

        const ownerStatus = await noteChatStatus(owner, note.id);
        expect(ownerStatus).toMatchObject({
            enabled: false,
            reason: "not_shared",
            shared: false,
            canManage: true,
        });
        expect(ownerStatus.conversation?.id).toBe(started.conversation.id);

        const viewerStatus = await bunRequest(
            `/api/chat/notes/${encodeURIComponent(note.id)}/chat`,
            { headers: authHeaders(viewer.token) },
        );
        await expectStatus(viewerStatus, 404, "grantee status after unshare");

        const send = await sendToConversation(owner.token, {
            conversationId: started.conversation.id,
            message: "Can we still talk here?",
        });
        await expectStatus(send, 409, "send after unshare");
        expect((await readJson<{ code?: string }>(send, "send after unshare")).code)
            .toBe("note_not_shared");
    });

    test("rejects regeneration and attachments in a shared note chat", async () => {
        const note = await createNote(owner, { title: `Group validation ${uniqueSuffix()}` });
        await shareNote(owner, note.id, editor.id, "edit");
        const started = await startNoteChat(owner, note.id);

        const regenerate = await sendToConversation(owner.token, {
            conversationId: started.conversation.id,
            message: "Try that again",
            regenerate: true,
        });
        await expectStatus(regenerate, 400, "group regenerate");
        expect((await readJson<{ code?: string }>(regenerate, "group regenerate")).code)
            .toBe("group_regenerate_unsupported");

        const attachment = await sendToConversation(owner.token, {
            conversationId: started.conversation.id,
            message: "Look at this file",
            attachmentIds: ["attachment123"],
        });
        await expectStatus(attachment, 400, "group attachments");
        expect((await readJson<{ code?: string }>(attachment, "group attachments")).code)
            .toBe("group_attachments_unsupported");
    });

    test("closes a shared note chat when the note is trashed", async () => {
        const note = await createNote(owner, { title: `Trashed group chat ${uniqueSuffix()}` });
        await shareNote(owner, note.id, editor.id, "edit");
        const started = await startNoteChat(owner, note.id);

        const trash = await bunRequest(`${BROWSER_API}/trash/move-document`, {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({ documentId: note.id }),
        });
        await expectStatus(trash, 200, "trash shared note");

        const send = await sendToConversation(owner.token, {
            conversationId: started.conversation.id,
            message: "Still there?",
        });
        await expectStatus(send, 409, "send after trash");
        expect((await readJson<{ code?: string }>(send, "send after trash")).code)
            .toBe("note_trashed");
    });

    test("records the group sender and hides the transcript from outsiders", async () => {
        const note = await createNote(owner, { title: `Group transcript ${uniqueSuffix()}` });
        await shareNote(owner, note.id, editor.id, "edit");
        const started = await startNoteChat(owner, note.id);

        const granteeMessage = await pbCreate<ChatMessageDto>(editor.token, "messages", {
            conversation: started.conversation.id,
            role: "user",
            content: "Hello from the editor",
            author: editor.id,
            author_label: "Editor Person",
            position: 0,
        });
        await pbCreate<ChatMessageDto>(owner.token, "messages", {
            conversation: started.conversation.id,
            role: "assistant",
            content: "Answer without a user author",
            position: 1,
        });

        const asOwner = await conversationMessages(owner, started.conversation.id);
        expect(asOwner).toHaveLength(2);
        expect(asOwner[0]).toMatchObject({
            role: "user",
            content: "Hello from the editor",
            authorId: editor.id,
            authorLabel: "Editor Person",
        });
        expect(asOwner[1]).toMatchObject({
            role: "assistant",
            content: "Answer without a user author",
        });
        expect(asOwner[1]?.authorId).toBeUndefined();

        const asGrantee = await conversationMessages(editor, started.conversation.id);
        expect(asGrantee[0]).toMatchObject({
            authorId: editor.id,
            authorLabel: "Editor Person",
        });

        const outsiderConversation = await bunRequest(
            `/api/chat/conversations/${encodeURIComponent(started.conversation.id)}`,
            { headers: authHeaders(outsider.token) },
        );
        await expectStatus(outsiderConversation, 404, "outsider group conversation");
        expect(await pbRecordExists(outsider.token, "messages", granteeMessage.id)).toBe(false);
        const outsiderMessages = await pbList<ChatMessageDto>(outsider.token, "messages", {
            filter: `conversation="${started.conversation.id}"`,
        });
        expect(outsiderMessages.totalItems).toBe(0);

        const forged = await pbRequest("/collections/messages/records", {
            method: "POST",
            headers: jsonHeaders(editor.token),
            body: JSON.stringify({
                conversation: started.conversation.id,
                role: "user",
                content: "Forged sender",
                author: owner.id,
                author_label: "The owner",
                position: 2,
            }),
        });
        expect(forged.ok).toBe(false);
        expect([400, 403, 404]).toContain(forged.status);
    });

    test("keeps personal conversations author-only", async () => {
        const personal = await createConversation(owner, {
            title: `Personal only ${uniqueSuffix()}`,
            messages: [{ role: "user", content: "private thought" }],
        });

        const hidden = await bunRequest(
            `/api/chat/conversations/${encodeURIComponent(personal.id)}`,
            { headers: authHeaders(editor.token) },
        );
        await expectStatus(hidden, 404, "personal conversation for another grantee");

        const messages = await pbList<ChatMessageDto>(editor.token, "messages", {
            filter: `conversation="${personal.id}"`,
        });
        expect(messages.totalItems).toBe(0);
    });

    test("enforces one note conversation with the unique document index", async () => {
        const note = await createNote(owner, { title: `Unique note chat ${uniqueSuffix()}` });
        await shareNote(owner, note.id, viewer.id, "view");
        const started = await startNoteChat(owner, note.id);

        const superuserToken = await getSuperuserToken();
        const duplicate = await pbRequest("/collections/conversations/records", {
            method: "POST",
            headers: jsonHeaders(superuserToken),
            body: JSON.stringify({
                title: "Duplicate note conversation",
                author: owner.id,
                scope: "note",
                document: note.id,
            }),
        });
        expect(duplicate.ok).toBe(false);
        expect([400, 403]).toContain(duplicate.status);

        const conversations = await pbList<ConversationDto>(superuserToken, "conversations", {
            filter: `document="${note.id}" && scope="note"`,
        });
        expect(conversations.items.map((conversation) => conversation.id)).toEqual([
            started.conversation.id,
        ]);
    });
});
