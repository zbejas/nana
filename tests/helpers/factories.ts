/**
 * Fixture factories for integration tests.
 *
 * Every test file creates its own users and records. The database is fresh for
 * each suite run, but files run in the same database, so fixed emails and
 * shared records would make tests order-dependent. Factories always use unique
 * emails/slugs and return ready-to-use credentials.
 */

import {
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
    TEST_PASSWORD,
    uniqueEmail,
    uniqueSuffix,
    type AuthRecord,
} from "./setup";
import { pbCreate, pbDelete, pbRequest, pbUpdate, readJson, expectStatus } from "./client";

let superuserTokenPromise: Promise<string> | undefined;

/** Cached per test file; PocketBase tokens are valid for the suite run. */
export function getSuperuserToken(): Promise<string> {
    superuserTokenPromise ??= authenticateSuperuser();
    return superuserTokenPromise;
}

export interface TestUser extends AuthRecord {
    password: string;
    token: string;
}

export interface CreateUserOptions {
    name?: string;
    admin?: boolean;
    verified?: boolean;
}

/**
 * Create an isolated user, authenticating as them. Admins are verified by
 * default because admin-granting requires a verified account.
 */
export async function createUser(prefix: string, options: CreateUserOptions = {}): Promise<TestUser> {
    const email = uniqueEmail(prefix);
    const password = TEST_PASSWORD;
    const admin = options.admin ?? false;
    const verified = options.verified ?? admin;

    const superuserToken = await getSuperuserToken();
    const created = await createTestUser(superuserToken, {
        email,
        password,
        name: options.name ?? `${prefix} ${uniqueSuffix()}`,
        admin,
        verified,
    });

    if (created.verified !== verified) {
        await pbUpdate(superuserToken, "users", created.id, { verified });
    }

    const session = await authenticateUser(email, password);
    return {
        ...session.record,
        password,
        token: session.token,
    };
}

export async function createAdmin(prefix = "admin"): Promise<TestUser> {
    return createUser(prefix, { admin: true, verified: true });
}

export async function createUnverifiedAdmin(prefix = "unverified-admin"): Promise<TestUser> {
    return createUser(prefix, { admin: true, verified: false });
}

export interface TestRecord {
    id: string;
    [key: string]: unknown;
}

export interface CreateNoteOptions {
    title?: string;
    content?: string;
    tags?: string[];
    folder?: string;
    is_private?: boolean;
    published?: boolean;
    public_share_token?: string;
    public_expires_at?: string;
    share_attachments?: boolean;
    [key: string]: unknown;
}

export async function createNote(user: TestUser, options: CreateNoteOptions = {}): Promise<TestRecord> {
    const title = options.title ?? `Note ${uniqueSuffix()}`;
    const slug = `note-${uniqueSuffix()}`.toLowerCase();
    const { folder, ...rest } = options;

    return pbCreate<TestRecord>(user.token, "documents", {
        title,
        slug,
        content: `# ${title}\n\nFixture note body.`,
        tags: [],
        author: user.id,
        ...(folder ? { folder } : {}),
        ...rest,
    });
}

export async function createNoteWithAttachment(
    user: TestUser,
    filename: string,
    bytes: Uint8Array,
    contentType = "text/plain",
    options: CreateNoteOptions = {},
): Promise<TestRecord> {
    const title = options.title ?? `Attachment note ${uniqueSuffix()}`;
    const form = new FormData();
    form.set("title", title);
    form.set("slug", `attachment-${uniqueSuffix()}`);
    form.set("content", options.content ?? "# Attachment\n\nFixture attachment body.");
    form.set("author", user.id);
    if (options.tags?.length) {
        for (const tag of options.tags) form.append("tags", tag);
    }
    if (options.folder) form.set("folder", options.folder);
    form.set("attachments", new File([bytes], filename, { type: contentType }));

    const res = await pbRequest("/collections/documents/records", {
        method: "POST",
        headers: { Authorization: user.token },
        body: form,
    });
    await expectStatus(res, 200, "create document with attachment");
    return readJson<TestRecord>(res, "create document with attachment");
}

export interface CreateFolderOptions {
    name?: string;
    parent?: string;
    is_private?: boolean;
    [key: string]: unknown;
}

export async function createFolder(user: TestUser, options: CreateFolderOptions = {}): Promise<TestRecord> {
    const { parent, ...rest } = options;
    return pbCreate<TestRecord>(user.token, "folders", {
        name: options.name ?? `Folder ${uniqueSuffix()}`,
        author: user.id,
        ...(parent ? { parent } : {}),
        ...rest,
    });
}

export interface CreateBoardOptions {
    name?: string;
    description?: string;
    archived?: boolean;
    [key: string]: unknown;
}

export async function createBoard(user: TestUser, options: CreateBoardOptions = {}): Promise<TestRecord> {
    return pbCreate<TestRecord>(user.token, "boards", {
        name: options.name ?? `Board ${uniqueSuffix()}`,
        description: options.description ?? "",
        archived: options.archived ?? false,
        author: user.id,
        ...options,
    });
}

export interface CreateTaskOptions {
    title?: string;
    description?: string;
    status?: "backlog" | "next" | "progress" | "done";
    priority?: "low" | "medium" | "high" | "urgent";
    board_order?: number;
    labels?: string[];
    due_date?: string;
    document?: string;
    [key: string]: unknown;
}

export async function createTask(
    user: TestUser,
    boardId: string,
    options: CreateTaskOptions = {},
): Promise<TestRecord> {
    const { document, ...rest } = options;
    return pbCreate<TestRecord>(user.token, "tasks", {
        title: options.title ?? `Task ${uniqueSuffix()}`,
        description: options.description ?? "",
        status: options.status ?? "backlog",
        board_order: options.board_order ?? 0,
        labels: options.labels ?? [],
        board: boardId,
        ...(document ? { document } : {}),
        ...rest,
    });
}

/** Update a record as the superuser (used for share flags and verification). */
export async function superuserUpdate(
    collection: string,
    id: string,
    body: Record<string, unknown>,
): Promise<TestRecord> {
    const token = await getSuperuserToken();
    return pbUpdate<TestRecord>(token, collection, id, body);
}

export async function superuserDelete(collection: string, id: string): Promise<void> {
    const token = await getSuperuserToken();
    await pbDelete(token, collection, id);
}

/** Publish a note so the document hook creates a version. */
export async function publishNote(user: TestUser, noteId: string, content?: string): Promise<TestRecord> {
    return pbUpdate<TestRecord>(user.token, "documents", noteId, {
        ...(content === undefined ? {} : { content }),
        published: true,
    });
}

export interface CreateConversationOptions {
    title?: string;
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function createConversation(
    user: TestUser,
    options: CreateConversationOptions = {},
): Promise<TestRecord> {
    const conversation = await pbCreate<TestRecord>(user.token, "conversations", {
        title: options.title ?? `Conversation ${uniqueSuffix()}`,
        author: user.id,
    });

    const messages = options.messages ?? [{ role: "user", content: "Hello" }];
    for (let position = 0; position < messages.length; position++) {
        const message = messages[position]!;
        await pbCreate<TestRecord>(user.token, "messages", {
            conversation: conversation.id,
            role: message.role,
            content: message.content,
            position,
        });
    }

    return conversation;
}
