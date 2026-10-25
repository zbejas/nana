/** DTOs and enums shared by REST handlers, workspace services, and MCP. */

export type Surface = "user" | "ai";

export type NoteSort = "updated" | "created" | "title";

export const TASK_STATUSES = ["backlog", "next", "progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function isTaskStatus(value: unknown): value is TaskStatus {
    return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
    return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
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
    isPrivate: boolean;
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
    boardOrder: number;
    labels: string[];
    noteId: string | null;
    boardId: string;
    created: string;
    updated: string;
}

export interface DeleteNoteResult {
    trashDocumentId: string;
}
