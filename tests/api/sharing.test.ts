import { beforeAll, describe, expect, test } from "bun:test";
import {
    bunRequest,
    expectStatus,
    readJson,
} from "../helpers/client";
import {
    createBoard,
    createNote,
    createUser,
    type TestRecord,
    type TestUser,
} from "../helpers/factories";
import { authHeaders, BROWSER_API, uniqueSuffix } from "../helpers/setup";

/**
 * The browser facade owns the only public user-sharing path. The proxy forwards
 * the session JWT to PocketBase, never exposes /api/sharing directly, rejects
 * API keys, and maps upstream failures without echoing the upstream body.
 */

interface ShareResponse {
    id: string;
    targetType: string;
    targetId: string;
    permission: string;
    level: number;
    sharedBy: { id: string; name: string; avatar: string; email?: string };
    user: { id: string; name: string; avatar: string; email?: string };
}

interface SharedResponse {
    items: Array<{
        id: string;
        shareId: string;
        type: string;
        permission: string;
        sharedBy: { id: string; name: string; email?: string; admin?: boolean };
        target: { id: string };
    }>;
}

interface CreatedKey {
    token: string;
}

function api(path: string): string {
    return `${BROWSER_API}${path}`;
}

function jsonHeaders(token: string): Record<string, string> {
    return { ...authHeaders(token), "Content-Type": "application/json" };
}

async function createSessionKey(token: string): Promise<string> {
    const res = await bunRequest(api("/api-keys"), {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify({
            name: `sharing-key-${uniqueSuffix()}`,
            access: "write",
            scope: "workspace",
            folderIds: [],
        }),
    });
    await expectStatus(res, 201, "create api key");
    return (await readJson<CreatedKey>(res, "create api key")).token;
}

describe("/api/v1/sharing proxy", () => {
    let owner: TestUser;
    let viewer: TestUser;
    let outsider: TestUser;
    let note: TestRecord;
    let shareId: string;

    beforeAll(async () => {
        owner = await createUser("proxy-sharing-owner");
        viewer = await createUser("proxy-sharing-viewer");
        outsider = await createUser("proxy-sharing-outsider");
        note = await createNote(owner);
    });

    test("requires a session JWT", async () => {
        const missing = await bunRequest(api("/sharing/shared"));
        await expectStatus(missing, 401, "missing token");
        expect((await readJson<{ message: string }>(missing)).message).toContain("authorization");

        const garbage = await bunRequest(api("/sharing/shared"), {
            headers: authHeaders("not-a-jwt"),
        });
        await expectStatus(garbage, 401, "invalid token");

        const apiKey = await createSessionKey(owner.token);
        const keyed = await bunRequest(api("/sharing/shared"), {
            headers: authHeaders(apiKey),
        });
        await expectStatus(keyed, 401, "api key rejected");
    });

    test("forwards share management and the shared-with-me list", async () => {
        const created = await bunRequest(api("/sharing/links"), {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                targetType: "document",
                targetId: note.id,
                userId: viewer.id,
                permission: "comment",
            }),
        });
        await expectStatus(created, 200, "create share through facade");
        const share = await readJson<ShareResponse>(created);
        expect(share.id).toBeTruthy();
        shareId = share.id;
        expect(share.targetType).toBe("document");
        expect(share.targetId).toBe(note.id);
        expect(share.permission).toBe("comment");
        expect(share.sharedBy.id).toBe(owner.id);
        expect(share.sharedBy.email).toBeUndefined();

        const shared = await bunRequest(api("/sharing/shared"), {
            headers: authHeaders(viewer.token),
        });
        await expectStatus(shared, 200, "shared list through facade");
        const body = await readJson<SharedResponse>(shared);
        const item = body.items.find((entry) => entry.target.id === note.id);
        expect(item).toBeTruthy();
        expect(item!.shareId).toBe(share.id);
        expect(item!.permission).toBe("comment");
        expect(item!.sharedBy.id).toBe(owner.id);
        expect(item!.sharedBy.email).toBeUndefined();
        expect(item!.sharedBy.admin).toBeUndefined();

        const users = await bunRequest(api(`/sharing/users?q=${encodeURIComponent(viewer.email)}`), {
            headers: authHeaders(owner.token),
        });
        await expectStatus(users, 200, "user directory through facade");
        const directory = await readJson<{ items: Array<{ id: string; email?: string; admin?: boolean }> }>(users);
        const found = directory.items.find((entry) => entry.id === viewer.id);
        expect(found).toBeTruthy();
        expect(found!.email).toBe(viewer.email);
        expect(found!.admin).toBeUndefined();
    });

    test("maps upstream errors without echoing the upstream body", async () => {
        const invalid = await bunRequest(api("/sharing/links"), {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                targetType: "document",
                targetId: note.id,
                userId: outsider.id,
                permission: "owner",
            }),
        });
        await expectStatus(invalid, 400, "invalid permission through facade");
        const invalidBody = await readJson<{ message: string }>(invalid);
        expect(invalidBody.message).toBe("Invalid sharing request.");
        expect(invalidBody.message).not.toContain("Permission must be");

        const forbidden = await bunRequest(api("/sharing/links"), {
            method: "POST",
            headers: jsonHeaders(outsider.token),
            body: JSON.stringify({
                targetType: "document",
                targetId: note.id,
                userId: viewer.id,
                permission: "view",
            }),
        });
        await expectStatus(forbidden, 403, "outsider share through facade");
        expect((await readJson<{ message: string }>(forbidden)).message).toBe(
            "You do not have permission to do that.",
        );

        const missing = await bunRequest(api("/sharing/folders/does-not-exist"), {
            headers: authHeaders(owner.token),
        });
        await expectStatus(missing, 404, "missing shared folder through facade");
        expect((await readJson<{ message: string }>(missing)).message).toBe("Not found.");
    });

    test("forwards comment round trips", async () => {
        const created = await bunRequest(api("/sharing/comments"), {
            method: "POST",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({
                targetType: "document",
                targetId: note.id,
                body: "  Proxy comment  ",
            }),
        });
        await expectStatus(created, 200, "comment through facade");
        const comment = await readJson<{ id: string; body: string }>(created);
        expect(comment.body).toBe("Proxy comment");

        const listed = await bunRequest(
            api(`/sharing/comments?targetType=document&targetId=${note.id}`),
            { headers: authHeaders(viewer.token) },
        );
        await expectStatus(listed, 200, "comments list through facade");
        const body = await readJson<{ items: Array<{ id: string }>; canComment: boolean }>(listed);
        expect(body.items.some((item) => item.id === comment.id)).toBe(true);
        expect(body.canComment).toBe(true);
    });

    test("lets an edit grantee create and update tasks through the browser facade", async () => {
        const board = await createBoard(owner);
        const otherBoard = await createBoard(owner);
        const shared = await bunRequest(api("/sharing/links"), {
            method: "POST",
            headers: jsonHeaders(owner.token),
            body: JSON.stringify({
                targetType: "board",
                targetId: board.id,
                userId: viewer.id,
                permission: "edit",
            }),
        });
        await expectStatus(shared, 200, "share board with editor");

        const created = await bunRequest(api("/records/tasks"), {
            method: "POST",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({
                title: "Grantee facade task",
                status: "backlog",
                board: board.id,
                assignee: owner.id,
            }),
        });
        await expectStatus(created, 200, "grantee creates task through facade");
        const task = await readJson<TestRecord>(created, "grantee task");

        const updated = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({ title: "Grantee edited", status: "next", assignee: viewer.id }),
        });
        await expectStatus(updated, 200, "grantee updates task through facade");

        const moved = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({ board: otherBoard.id }),
        });
        await expectStatus(moved, 400, "facade rejects a board move");

        const badStatus = await bunRequest(api("/records/tasks"), {
            method: "POST",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({
                title: "Bad slug",
                status: "Not A Slug!",
                board: board.id,
            }),
        });
        await expectStatus(badStatus, 400, "facade rejects an invalid column slug");

        const reserved = await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "PATCH",
            headers: jsonHeaders(viewer.token),
            body: JSON.stringify({ status: "planned" }),
        });
        await expectStatus(reserved, 200, "virtual backlog status through facade");

        // A task is created on the shared board; clean up as the owner.
        await bunRequest(api(`/records/tasks/${task.id}`), {
            method: "DELETE",
            headers: authHeaders(owner.token),
        });
    });

    test("revokes a share through the facade", async () => {
        const removed = await bunRequest(api(`/sharing/links/${shareId}`), {
            method: "DELETE",
            headers: authHeaders(owner.token),
        });
        await expectStatus(removed, 200, "revoke share through facade");

        const shared = await bunRequest(api("/sharing/shared"), {
            headers: authHeaders(viewer.token),
        });
        await expectStatus(shared, 200, "shared list after revoke");
        const body = await readJson<SharedResponse>(shared);
        expect(body.items.some((item) => item.target.id === note.id)).toBe(false);
    });

    test("does not expose the PocketBase /api/sharing path from the Bun origin", async () => {
        const direct = await bunRequest("/api/sharing/shared", {
            headers: authHeaders(owner.token),
        });
        const text = await direct.text();
        // The SPA fallback may serve HTML for unknown paths, but it must never
        // proxy the sharing payload. The real endpoint is /api/v1/sharing.
        expect(text).not.toContain('"items"');
        expect(direct.headers.get("Content-Type") ?? "").not.toContain("application/json");
    });
});
