import { t } from "elysia";
import type { TSchema } from "@sinclair/typebox";
import { API_KEY_ACCESS_VALUES, API_KEY_SCOPE_VALUES } from "../api-keys/types";
import { TASK_PRIORITIES, TASK_STATUSES } from "../workspace/types";

const recordId = t.String({
    minLength: 1,
    maxLength: 64,
    pattern: "^[A-Za-z0-9]{1,64}$",
    description: "PocketBase record id.",
    examples: ["a1b2c3d4e5f6g7h8"],
});

const dateTime = t.String({
    description: "PocketBase date-time string.",
    examples: ["2026-10-25 12:00:00.000Z"],
});

function nullableString(description: string, examples: string[] = []) {
    return t.Union([t.String({ description, examples }), t.Null()], {
        description,
        examples,
    });
}

// Empty string clears a relation, so it is accepted wherever a relation id is
// optional. Non-empty values still have to look like PocketBase ids.
const clearableId = (description: string) =>
    t.String({
        maxLength: 64,
        pattern: "^([A-Za-z0-9]{1,64})?$",
        description: `${description} Send an empty string to clear the relation.`,
        examples: ["a1b2c3d4e5f6g7h8"],
    });

const nullableClearableId = (description: string) =>
    t.Union([clearableId(description), t.Null()], { description });

// Keep these as literal unions, not `t.UnionEnum`: UnionEnum attaches a default
// for the first value, which Elysia applies to omitted optional query/body
// fields (silently filtering task lists and resetting task updates).
export const TaskStatusSchema = t.Union(
    TASK_STATUSES.map((status) => t.Literal(status)),
    {
        description: "Board column.",
        examples: ["next"],
    },
);
export const TaskPrioritySchema = t.Union(
    ["", ...TASK_PRIORITIES].map((priority) => t.Literal(priority)),
    {
        description: "Task priority. An empty string means unset.",
        examples: ["high"],
    },
);
const NoteSortSchema = t.Union(
    (["updated", "created", "title"] as const).map((sort) => t.Literal(sort)),
    {
        description: "Sort order. `updated` and `created` are newest first; `title` is A–Z.",
        examples: ["updated"],
    },
);

// ── Response DTOs ────────────────────────────────────────────────────

export const FolderDtoSchema = t.Object({
    id: t.String({ description: "Folder id.", examples: ["folder123"] }),
    name: t.String({ description: "Display name.", examples: ["Product"] }),
    parentId: nullableString("Parent folder id, or null at the workspace root.", ["folder000"]),
    isPrivate: t.Boolean({
        description: "Hidden from chat and MCP, including every descendant. The owner still sees it here.",
        examples: [false],
    }),
    isPublic: t.Boolean({
        description: "A public share token is active (subject to `publicExpiresAt`).",
        examples: [false],
    }),
    created: dateTime,
    updated: dateTime,
}, {
    description: "A folder in the caller's workspace.",
    examples: [{
        id: "folder123",
        name: "Product",
        parentId: null,
        isPrivate: false,
        isPublic: false,
        created: "2026-10-20 09:15:00.000Z",
        updated: "2026-10-24 16:40:00.000Z",
    }],
});

export const NoteSummaryDtoSchema = t.Object({
    id: t.String({ description: "Note id.", examples: ["note123"] }),
    title: t.String({ description: "Note title. Defaults to `Untitled`.", examples: ["Weekly review"] }),
    tags: t.Array(t.String({ description: "Tag.", examples: ["planning"] }), {
        description: "Up to 20 tags.",
        examples: [["planning", "product"]],
    }),
    folderId: nullableString("Containing folder id, or null at the workspace root.", ["folder123"]),
    isPrivate: t.Boolean({
        description: "Hidden from chat and MCP. The owner still sees it here.",
        examples: [false],
    }),
    isPublic: t.Boolean({
        description: "A public share token is active (subject to `publicExpiresAt`).",
        examples: [false],
    }),
    published: t.Boolean({
        description: "When true on update, PocketBase snapshots the previous content into version history and resets the flag.",
        examples: [false],
    }),
    wordCount: t.Number({ description: "Computed word count.", examples: [412] }),
    readingTime: t.Number({ description: "Estimated reading time in minutes.", examples: [3] }),
    created: dateTime,
    updated: dateTime,
}, {
    description: "Note metadata returned by list endpoints. `content` is intentionally omitted.",
    examples: [{
        id: "note123",
        title: "Weekly review",
        tags: ["planning"],
        folderId: "folder123",
        isPrivate: false,
        isPublic: false,
        published: false,
        wordCount: 412,
        readingTime: 3,
        created: "2026-10-20 09:15:00.000Z",
        updated: "2026-10-24 16:40:00.000Z",
    }],
});

export const NoteDtoSchema = t.Object({
    id: t.String({ description: "Note id.", examples: ["note123"] }),
    title: t.String({ description: "Note title.", examples: ["Weekly review"] }),
    tags: t.Array(t.String({ description: "Tag.", examples: ["planning"] }), {
        description: "Up to 20 tags.",
        examples: [["planning", "product"]],
    }),
    folderId: nullableString("Containing folder id, or null at the workspace root.", ["folder123"]),
    isPrivate: t.Boolean({
        description: "Hidden from chat and MCP. The owner still sees it here.",
        examples: [false],
    }),
    isPublic: t.Boolean({
        description: "A public share token is active (subject to `publicExpiresAt`).",
        examples: [false],
    }),
    published: t.Boolean({
        description: "Publishing snapshot flag. PocketBase resets it after creating a version.",
        examples: [false],
    }),
    wordCount: t.Number({ description: "Computed word count.", examples: [412] }),
    readingTime: t.Number({ description: "Estimated reading time in minutes.", examples: [3] }),
    created: dateTime,
    updated: dateTime,
    slug: t.String({ description: "Slug generated from the title.", examples: ["weekly-review"] }),
    content: t.String({
        description: "Sanitized Markdown/HTML content. List endpoints never include this field.",
        examples: ["# Weekly review\n\nWhat moved, what stalled, and what is next."],
    }),
}, {
    description: "A full note, including its sanitized content.",
    examples: [{
        id: "note123",
        title: "Weekly review",
        tags: ["planning"],
        folderId: "folder123",
        isPrivate: false,
        isPublic: false,
        published: false,
        wordCount: 412,
        readingTime: 3,
        created: "2026-10-20 09:15:00.000Z",
        updated: "2026-10-24 16:40:00.000Z",
        slug: "weekly-review",
        content: "# Weekly review\n\nWhat moved, what stalled, and what is next.",
    }],
});

export const BoardDtoSchema = t.Object({
    id: t.String({ description: "Board id.", examples: ["board123"] }),
    name: t.String({ description: "Board name.", examples: ["Release"] }),
    description: t.String({
        description: "Optional plain-text description.",
        examples: ["Ship the next version"],
    }),
    archived: t.Boolean({
        description: "Archived boards are read-only for tasks and must be archived before permanent delete.",
        examples: [false],
    }),
    folderId: nullableString("Containing folder id, or null at the workspace root.", ["folder123"]),
    isPrivate: t.Boolean({
        description: "Hidden from chat and MCP. The owner still sees it here.",
        examples: [false],
    }),
    created: dateTime,
    updated: dateTime,
}, {
    description: "An author-scoped board.",
    examples: [{
        id: "board123",
        name: "Release",
        description: "Ship the next version",
        archived: false,
        folderId: "folder123",
        isPrivate: false,
        created: "2026-10-20 09:15:00.000Z",
        updated: "2026-10-24 16:40:00.000Z",
    }],
});

export const TaskDtoSchema = t.Object({
    id: t.String({ description: "Task id.", examples: ["task123"] }),
    title: t.String({ description: "Task title.", examples: ["Draft release notes"] }),
    description: t.String({
        description: "Markdown body. Empty string when unset.",
        examples: ["Summarize the user-facing changes."],
    }),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    dueDate: nullableString("Due date-time, or null when unset.", ["2026-12-01 12:00:00.000Z"]),
    boardOrder: t.Number({
        description: "Order within the column. Lower values appear first.",
        examples: [0],
    }),
    labels: t.Array(t.String({ description: "Label.", examples: ["release"] }), {
        description: "Up to 20 labels.",
        examples: [["release"]],
    }),
    noteId: nullableString("Linked note id, or null when unset.", ["note123"]),
    boardId: t.String({ description: "Owning board id.", examples: ["board123"] }),
    created: dateTime,
    updated: dateTime,
}, {
    description: "A task on a board.",
    examples: [{
        id: "task123",
        title: "Draft release notes",
        description: "Summarize the user-facing changes.",
        status: "next",
        priority: "high",
        dueDate: "2026-12-01 12:00:00.000Z",
        boardOrder: 0,
        labels: ["release"],
        noteId: "note123",
        boardId: "board123",
        created: "2026-10-20 09:15:00.000Z",
        updated: "2026-10-24 16:40:00.000Z",
    }],
});

function listOf<T extends TSchema>(item: T) {
    return t.Object({
        items: t.Array(item),
        page: t.Number({ description: "1-based page number.", examples: [1] }),
        perPage: t.Number({ description: "Page size. Capped at 50.", examples: [20] }),
        totalItems: t.Number({ description: "Total matching records.", examples: [42] }),
        totalPages: t.Number({ description: "Total pages at this page size.", examples: [3] }),
    });
}

export const FolderListSchema = t.Array(FolderDtoSchema, {
    description: "All folders owned by the caller, sorted by name.",
});
export const NoteListSchema = listOf(NoteSummaryDtoSchema);
export const BoardListSchema = listOf(BoardDtoSchema);
export const TaskListSchema = listOf(TaskDtoSchema);
export const DeleteNoteResultSchema = t.Object({
    trashDocumentId: t.String({
        description: "Id of the trashed note. The soft-delete keeps the document id; use it to restore or permanently delete the note.",
        examples: ["note123"],
    }),
}, {
    description: "The note was moved to trash.",
});
export const ErrorSchema = t.Object({
    error: t.String({
        description: "Human-readable error message.",
        examples: ["Not found."],
    }),
}, {
    description: "Error envelope used by every API failure.",
});

// ── Path params ──────────────────────────────────────────────────────

export const IdParamsSchema = t.Object({ id: recordId });

// ── Query strings ────────────────────────────────────────────────────

export const ListNotesQuerySchema = t.Object({
    query: t.Optional(t.String({
        maxLength: 200,
        description: "Search titles and tags. Note bodies are not searched.",
        examples: ["release"],
    })),
    tag: t.Optional(t.String({
        maxLength: 60,
        description: "Only notes carrying this tag.",
        examples: ["planning"],
    })),
    folderId: t.Optional(t.String({
        maxLength: 64,
        description: "Only notes in this folder. Send an empty value for root notes.",
        examples: ["folder123"],
    })),
    page: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 1_000_000,
        description: "1-based page number.",
        examples: [1],
    })),
    perPage: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        description: "Page size, up to 50.",
        examples: [20],
    })),
    sort: t.Optional(NoteSortSchema),
});

export const ListBoardsQuerySchema = t.Object({
    includeArchived: t.Optional(t.BooleanString({
        description: "Include archived boards.",
        examples: [false],
    })),
    folderId: t.Optional(t.String({
        maxLength: 64,
        description: "Only boards in this folder. Send an empty value for root boards.",
        examples: ["folder123"],
    })),
    page: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 1_000_000,
        description: "1-based page number.",
        examples: [1],
    })),
    perPage: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        description: "Page size, up to 50.",
        examples: [20],
    })),
});

export const ListTasksQuerySchema = t.Object({
    status: t.Optional(TaskStatusSchema),
    page: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 1_000_000,
        description: "1-based page number.",
        examples: [1],
    })),
    perPage: t.Optional(t.Numeric({
        minimum: 1,
        maximum: 50,
        description: "Page size, up to 50.",
        examples: [50],
    })),
});

// ── Request bodies ───────────────────────────────────────────────────

export const CreateFolderBodySchema = t.Object({
    name: t.String({
        minLength: 1,
        maxLength: 200,
        description: "Folder name.",
        examples: ["Product"],
    }),
    parentId: t.Optional(nullableClearableId("Parent folder id, or null at the workspace root.")),
    isPrivate: t.Optional(t.Boolean({
        description: "Hide the folder and its subtree from chat and MCP.",
        examples: [false],
    })),
}, {
    description: "Create a folder at the root or under an owned parent.",
    examples: [{ name: "Product", parentId: null, isPrivate: false }],
});

export const CreateNoteBodySchema = t.Object({
    title: t.Optional(t.String({
        maxLength: 200,
        description: "Note title. Defaults to `Untitled`.",
        examples: ["Weekly review"],
    })),
    content: t.Optional(t.String({
        description: "Markdown/HTML content. Sanitized before storage.",
        examples: ["# Weekly review\n\nWhat moved, what stalled, and what is next."],
    })),
    tags: t.Optional(t.Array(t.String({ maxLength: 60, examples: ["planning"] }), {
        maxItems: 20,
        description: "Up to 20 tags.",
        examples: [["planning", "product"]],
    })),
    folderId: t.Optional(nullableClearableId("Folder id, or null at the workspace root.")),
    isPrivate: t.Optional(t.Boolean({
        description: "Hide the note from chat and MCP.",
        examples: [false],
    })),
}, {
    description: "Create a note. Every field is optional.",
    examples: [{
        title: "Weekly review",
        content: "# Weekly review\n\nWhat moved, what stalled, and what is next.",
        tags: ["planning", "product"],
        folderId: null,
        isPrivate: false,
    }],
});

export const UpdateNoteBodySchema = t.Object({
    title: t.Optional(t.String({
        maxLength: 200,
        description: "New title.",
        examples: ["Weekly review — week 43"],
    })),
    content: t.Optional(t.String({
        description: "New Markdown/HTML content. Sanitized before storage.",
        examples: ["# Weekly review\n\nUpdated notes."],
    })),
    tags: t.Optional(t.Array(t.String({ maxLength: 60, examples: ["planning"] }), {
        maxItems: 20,
        description: "Replacement tag list.",
        examples: [["planning"]],
    })),
    folderId: t.Optional(nullableClearableId("Move the note to this folder, or to the root with an empty value.")),
    isPrivate: t.Optional(t.Boolean({
        description: "Hide the note from chat and MCP.",
        examples: [true],
    })),
}, {
    description: "Partial note update. Omitted fields stay unchanged.",
});

export const CreateBoardBodySchema = t.Object({
    name: t.String({
        minLength: 1,
        maxLength: 120,
        description: "Board name.",
        examples: ["Release"],
    }),
    description: t.Optional(t.String({
        maxLength: 500,
        description: "Optional plain-text description.",
        examples: ["Ship the next version"],
    })),
    folderId: t.Optional(nullableClearableId("Folder id, or null at the workspace root.")),
    isPrivate: t.Optional(t.Boolean({
        description: "Hide the board from chat and MCP.",
        examples: [false],
    })),
}, {
    description: "Create a board.",
    examples: [{ name: "Release", description: "Ship the next version", folderId: null, isPrivate: false }],
});

export const UpdateBoardBodySchema = t.Object({
    name: t.Optional(t.String({
        minLength: 1,
        maxLength: 120,
        description: "New board name.",
        examples: ["Release 1.0"],
    })),
    description: t.Optional(t.String({
        maxLength: 500,
        description: "New plain-text description.",
        examples: ["Ship version 1.0"],
    })),
    archived: t.Optional(t.Boolean({
        description: "Archive or restore the board. Only archived boards can be permanently deleted.",
        examples: [true],
    })),
    folderId: t.Optional(nullableClearableId("Move the board to this folder, or to the root with an empty value.")),
    isPrivate: t.Optional(t.Boolean({
        description: "Hide the board from chat and MCP.",
        examples: [true],
    })),
}, {
    description: "Partial board update.",
});

export const CreateTaskBodySchema = t.Object({
    title: t.String({
        minLength: 1,
        maxLength: 240,
        description: "Task title.",
        examples: ["Draft release notes"],
    }),
    description: t.Optional(t.String({
        description: "Markdown body.",
        examples: ["Summarize the user-facing changes."],
    })),
    status: t.Optional(TaskStatusSchema),
    priority: t.Optional(TaskPrioritySchema),
    dueDate: t.Optional(t.String({
        maxLength: 40,
        description: "Due date-time string.",
        examples: ["2026-12-01 12:00:00.000Z"],
    })),
    boardOrder: t.Optional(t.Number({
        minimum: 0,
        description: "Order within the column.",
        examples: [0],
    })),
    labels: t.Optional(t.Array(t.String({ maxLength: 60, examples: ["release"] }), {
        maxItems: 20,
        description: "Up to 20 labels.",
        examples: [["release"]],
    })),
    noteId: t.Optional(nullableClearableId("Optional linked note id.")),
}, {
    description: "Create a task on the board in the path.",
    examples: [{
        title: "Draft release notes",
        description: "Summarize the user-facing changes.",
        status: "next",
        priority: "high",
        dueDate: "2026-12-01 12:00:00.000Z",
        boardOrder: 0,
        labels: ["release"],
        noteId: "note123",
    }],
});

export const UpdateTaskBodySchema = t.Object({
    title: t.Optional(t.String({
        minLength: 1,
        maxLength: 240,
        description: "New task title.",
        examples: ["Draft release notes"],
    })),
    description: t.Optional(t.String({
        description: "New Markdown body.",
        examples: ["Summarize the user-facing changes."],
    })),
    status: t.Optional(TaskStatusSchema),
    priority: t.Optional(TaskPrioritySchema),
    dueDate: t.Optional(t.String({
        maxLength: 40,
        description: "New due date-time string.",
        examples: ["2026-12-01 12:00:00.000Z"],
    })),
    boardOrder: t.Optional(t.Number({
        minimum: 0,
        description: "New order within the column.",
        examples: [2],
    })),
    labels: t.Optional(t.Array(t.String({ maxLength: 60, examples: ["release"] }), {
        maxItems: 20,
        description: "Replacement label list.",
        examples: [["release"]],
    })),
    noteId: t.Optional(nullableClearableId("Linked note id. Send an empty value to clear the link.")),
    boardId: t.Optional(recordId),
}, {
    description: "Partial task update. Omitted fields stay unchanged. Send `boardId`, `status`, and/or `boardOrder` to move the task.",
});

export const AddNoteToBoardBodySchema = t.Object({
    noteId: recordId,
    status: t.Optional(TaskStatusSchema),
}, {
    description: "Copy a note into a new task.",
    examples: [{ noteId: "note123", status: "done" }],
});

// ── API keys ─────────────────────────────────────────────────────────

export const ApiKeyAccessSchema = t.Union(
    API_KEY_ACCESS_VALUES.map((access) => t.Literal(access)),
    {
        description: "`read` allows workspace reads only; `write` also allows create, update, move, and delete.",
        examples: ["read"],
    },
);

export const ApiKeyScopeSchema = t.Union(
    API_KEY_SCOPE_VALUES.map((scope) => t.Literal(scope)),
    {
        description:
            "`workspace` covers the root and every folder; `root` covers only records with no folder; `folders` covers the selected folders and their descendants.",
        examples: ["folders"],
    },
);

const ApiKeyFolderSchema = t.Object({
    id: t.String({ description: "Folder id.", examples: ["folder123"] }),
    name: t.String({ description: "Folder name.", examples: ["Product"] }),
}, {
    description: "A folder selected as a key scope root.",
});

export const ApiKeyDtoSchema = t.Object({
    id: t.String({ description: "Key metadata id.", examples: ["key123"] }),
    name: t.String({ description: "Display name.", examples: ["Claude Desktop"] }),
    prefix: t.String({
        description: "The visible prefix of the secret. The rest is stored only as a hash.",
        examples: ["nana_a1b2c3d4e5"],
    }),
    // Response schemas use plain strings for these two fields. Elysia's
    // response inference cannot unify literal unions inside an array DTO, and
    // the allowed values are still documented and validated on create.
    access: t.String({
        description: "Key access: `read` or `write`.",
        examples: ["read"],
    }),
    scope: t.String({
        description: "Key scope: `workspace`, `root`, or `folders`.",
        examples: ["folders"],
    }),
    folders: t.Array(ApiKeyFolderSchema, {
        description: "Scope roots when `scope` is `folders`; empty otherwise.",
    }),
    lastUsedAt: t.Union([dateTime, t.Null()], {
        description: "Last successful authentication, or null when never used.",
        examples: ["2026-10-25 12:00:00.000Z"],
    }),
    createdAt: dateTime,
}, {
    description: "API key metadata. The secret and its hash are never returned after creation.",
    examples: [{
        id: "key123",
        name: "Claude Desktop",
        prefix: "nana_a1b2c3d4e5",
        access: "read",
        scope: "folders",
        folders: [{ id: "folder123", name: "Product" }],
        lastUsedAt: null,
        createdAt: "2026-10-24 16:40:00.000Z",
    }],
});

export const ApiKeyListSchema = t.Array(ApiKeyDtoSchema);

export const CreateApiKeyBodySchema = t.Object({
    name: t.String({
        minLength: 1,
        maxLength: 80,
        description: "A label such as the client that will use the key.",
        examples: ["Claude Desktop"],
    }),
    access: ApiKeyAccessSchema,
    scope: ApiKeyScopeSchema,
    folderIds: t.Optional(t.Array(
        t.String({
            minLength: 1,
            maxLength: 64,
            pattern: "^[A-Za-z0-9]{1,64}$",
            description: "Folder id.",
            examples: ["folder123"],
        }),
        {
            maxItems: 20,
            description: "Scope roots when `scope` is `folders`. Ignored for other scopes.",
            examples: [["folder123"]],
        },
    )),
}, {
    description: "Create a long-lived API key. The plaintext is returned exactly once.",
    examples: [{
        name: "Claude Desktop",
        access: "read",
        scope: "folders",
        folderIds: ["folder123"],
    }],
});

export const CreatedApiKeySchema = t.Object({
    token: t.String({
        description: "The plaintext key. Store it now; it cannot be shown again.",
        examples: ["nana_a1b2c3d4e5f6g7h8i9j0"],
    }),
    apiKey: ApiKeyDtoSchema,
}, {
    description: "A newly created key and its metadata.",
});
