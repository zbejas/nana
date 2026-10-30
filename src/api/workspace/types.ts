/** DTOs and enums shared by REST handlers, workspace services, and MCP. */

export type Surface = "user" | "ai";

export type NoteSort = "updated" | "created" | "title";

/** `tasks.status` is a board column slug; planned/archived are virtual. */
export type TaskStatus = string;

export const VIRTUAL_TASK_STATUSES = ["planned", "archived"] as const;
export type VirtualTaskStatus = (typeof VIRTUAL_TASK_STATUSES)[number];

export function isVirtualTaskStatus(value: unknown): value is VirtualTaskStatus {
    return typeof value === "string" && (VIRTUAL_TASK_STATUSES as readonly string[]).includes(value);
}

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isTaskPriority(value: unknown): value is TaskPriority {
    return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export interface TaskRecurrenceDto {
    frequency: RecurrenceFrequency;
    interval: number;
    weekdays?: number[];
    timeZone?: string;
}

export const TASK_RELATION_TYPES = ["subtask", "blocks", "related"] as const;
export type TaskRelationType = (typeof TASK_RELATION_TYPES)[number];

export function isTaskRelationType(value: unknown): value is TaskRelationType {
    return typeof value === "string" && (TASK_RELATION_TYPES as readonly string[]).includes(value);
}

export interface ListResult<T> {
    items: T[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
}

export interface FolderDto {
    id: string;
    name: string;
    parentId: string | null;
    isPrivate: boolean;
    isPublic: boolean;
    created: string;
    updated: string;
}

export interface NoteSummaryDto {
    id: string;
    title: string;
    tags: string[];
    folderId: string | null;
    isPrivate: boolean;
    isPublic: boolean;
    published: boolean;
    wordCount: number;
    readingTime: number;
    created: string;
    updated: string;
}

export interface NoteDto extends NoteSummaryDto {
    slug: string;
    content: string;
}

export interface BoardDto {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    folderId: string | null;
    icon: string;
    isPrivate: boolean;
    taskCounter: number;
    created: string;
    updated: string;
}

export interface BoardColumnDto {
    id: string;
    boardId: string;
    name: string;
    slug: string;
    position: number;
    icon: string;
    color: string;
    isFinal: boolean;
    created: string;
    updated: string;
}

export interface TaskDto {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority | "";
    dueDate: string | null;
    startDate: string | null;
    completedAt: string | null;
    boardOrder: number;
    labels: string[];
    noteId: string | null;
    boardId: string;
    assigneeId: string | null;
    recurrence: TaskRecurrenceDto | null;
    taskNumber: number | null;
    created: string;
    updated: string;
}

export interface TaskRelationDto {
    id: string;
    sourceTaskId: string;
    targetTaskId: string;
    type: TaskRelationType;
    sourceTitle: string | null;
    targetTitle: string | null;
    targetStatus: string | null;
    created: string;
    updated: string;
}

export interface TaskActivityDto {
    id: string;
    taskId: string;
    boardId: string;
    actorId: string | null;
    type: string;
    data: Record<string, unknown>;
    created: string;
}

export interface DeleteNoteResult {
    /** The trashed document id; soft delete keeps the original id. */
    trashDocumentId: string;
}
