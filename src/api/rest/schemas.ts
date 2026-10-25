import { t } from "elysia";
import type { TSchema } from "@sinclair/typebox";
import { TASK_PRIORITIES, TASK_STATUSES } from "../workspace/types";

const recordId = t.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9]{1,64}$" });
const nullableString = t.Union([t.String(), t.Null()]);
// Empty string clears a relation, so it is accepted wherever a relation id is
// optional. Non-empty values still have to look like PocketBase ids.
const clearableId = t.String({ maxLength: 64, pattern: "^([A-Za-z0-9]{1,64})?$" });
const nullableClearableId = t.Union([clearableId, t.Null()]);

// Keep these as literal unions, not `t.UnionEnum`: UnionEnum attaches a default
// for the first value, which Elysia applies to omitted optional query/body
// fields (silently filtering task lists and resetting task updates).
export const TaskStatusSchema = t.Union(TASK_STATUSES.map((status) => t.Literal(status)));
export const TaskPrioritySchema = t.Union(
    ["", ...TASK_PRIORITIES].map((priority) => t.Literal(priority)),
);
const NoteSortSchema = t.Union(
    (["updated", "created", "title"] as const).map((sort) => t.Literal(sort)),
);

// ── Response DTOs ────────────────────────────────────────────────────

export const FolderDtoSchema = t.Object({
    id: t.String(),
    name: t.String(),
    parentId: nullableString,
    isPrivate: t.Boolean(),
    isPublic: t.Boolean(),
    created: t.String(),
    updated: t.String(),
});

export const NoteSummaryDtoSchema = t.Object({
    id: t.String(),
    title: t.String(),
    tags: t.Array(t.String()),
    folderId: nullableString,
    isPrivate: t.Boolean(),
    isPublic: t.Boolean(),
    published: t.Boolean(),
    wordCount: t.Number(),
    readingTime: t.Number(),
    created: t.String(),
    updated: t.String(),
});

export const NoteDtoSchema = t.Object({
    id: t.String(),
    title: t.String(),
    tags: t.Array(t.String()),
    folderId: nullableString,
    isPrivate: t.Boolean(),
    isPublic: t.Boolean(),
    published: t.Boolean(),
    wordCount: t.Number(),
    readingTime: t.Number(),
    created: t.String(),
    updated: t.String(),
    slug: t.String(),
    content: t.String(),
});

export const BoardDtoSchema = t.Object({
    id: t.String(),
    name: t.String(),
    description: t.String(),
    archived: t.Boolean(),
    folderId: nullableString,
    isPrivate: t.Boolean(),
    created: t.String(),
    updated: t.String(),
});

export const TaskDtoSchema = t.Object({
    id: t.String(),
    title: t.String(),
    description: t.String(),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    dueDate: nullableString,
    boardOrder: t.Number(),
    labels: t.Array(t.String()),
    noteId: nullableString,
    boardId: t.String(),
    created: t.String(),
    updated: t.String(),
});

function listOf<T extends TSchema>(item: T) {
    return t.Object({
        items: t.Array(item),
        page: t.Number(),
        perPage: t.Number(),
        totalItems: t.Number(),
        totalPages: t.Number(),
    });
}

export const FolderListSchema = t.Array(FolderDtoSchema);
export const NoteListSchema = listOf(NoteSummaryDtoSchema);
export const BoardListSchema = listOf(BoardDtoSchema);
export const TaskListSchema = listOf(TaskDtoSchema);
export const DeleteNoteResultSchema = t.Object({ trashDocumentId: t.String() });
export const ErrorSchema = t.Object({ error: t.String() });

// ── Path params ──────────────────────────────────────────────────────

export const IdParamsSchema = t.Object({ id: recordId });

// ── Query strings ────────────────────────────────────────────────────

export const ListNotesQuerySchema = t.Object({
    query: t.Optional(t.String({ maxLength: 200 })),
    tag: t.Optional(t.String({ maxLength: 60 })),
    folderId: t.Optional(t.String({ maxLength: 64 })),
    page: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000_000 })),
    perPage: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
    sort: t.Optional(NoteSortSchema),
});

export const ListBoardsQuerySchema = t.Object({
    includeArchived: t.Optional(t.BooleanString()),
    folderId: t.Optional(t.String({ maxLength: 64 })),
    page: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000_000 })),
    perPage: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
});

export const ListTasksQuerySchema = t.Object({
    status: t.Optional(TaskStatusSchema),
    page: t.Optional(t.Numeric({ minimum: 1, maximum: 1_000_000 })),
    perPage: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
});

// ── Request bodies ───────────────────────────────────────────────────

export const CreateFolderBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 200 }),
    parentId: t.Optional(nullableClearableId),
    isPrivate: t.Optional(t.Boolean()),
});

export const CreateNoteBodySchema = t.Object({
    title: t.Optional(t.String({ maxLength: 200 })),
    content: t.Optional(t.String()),
    tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
    folderId: t.Optional(nullableClearableId),
    isPrivate: t.Optional(t.Boolean()),
});

export const UpdateNoteBodySchema = t.Object({
    title: t.Optional(t.String({ maxLength: 200 })),
    content: t.Optional(t.String()),
    tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
    folderId: t.Optional(nullableClearableId),
    isPrivate: t.Optional(t.Boolean()),
});

export const CreateBoardBodySchema = t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    description: t.Optional(t.String({ maxLength: 500 })),
    folderId: t.Optional(nullableClearableId),
    isPrivate: t.Optional(t.Boolean()),
});

export const UpdateBoardBodySchema = t.Object({
    name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    description: t.Optional(t.String({ maxLength: 500 })),
    archived: t.Optional(t.Boolean()),
    folderId: t.Optional(nullableClearableId),
    isPrivate: t.Optional(t.Boolean()),
});

export const CreateTaskBodySchema = t.Object({
    title: t.String({ minLength: 1, maxLength: 240 }),
    description: t.Optional(t.String()),
    status: t.Optional(TaskStatusSchema),
    priority: t.Optional(TaskPrioritySchema),
    dueDate: t.Optional(t.String({ maxLength: 40 })),
    boardOrder: t.Optional(t.Number({ minimum: 0 })),
    labels: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
    noteId: t.Optional(nullableClearableId),
});

export const UpdateTaskBodySchema = t.Object({
    title: t.Optional(t.String({ minLength: 1, maxLength: 240 })),
    description: t.Optional(t.String()),
    status: t.Optional(TaskStatusSchema),
    priority: t.Optional(TaskPrioritySchema),
    dueDate: t.Optional(t.String({ maxLength: 40 })),
    boardOrder: t.Optional(t.Number({ minimum: 0 })),
    labels: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
    noteId: t.Optional(nullableClearableId),
    boardId: t.Optional(recordId),
});

export const AddNoteToBoardBodySchema = t.Object({
    noteId: recordId,
    status: t.Optional(TaskStatusSchema),
});
