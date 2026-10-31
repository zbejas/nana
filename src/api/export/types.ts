/**
 * Types for the server-side export API
 */

/** Incoming request body for POST /api/export */
export interface ExportRequest {
    documentIds?: string[];
    folderIds?: string[];
    boardIds?: string[];
    zipName?: string;
}

/** Minimal board shape returned by PocketBase REST API */
export interface PBBoard {
    id: string;
    name: string;
    description?: string;
    author: string;
    created: string;
    updated: string;
}

/** Minimal board column shape returned by PocketBase REST API */
export interface PBBoardColumn {
    id: string;
    board: string;
    name: string;
    slug: string;
    position: number;
    is_final: boolean;
}

/** Minimal task shape returned by PocketBase REST API */
export interface PBTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    due_date?: string;
    labels?: string[];
    document?: string;
    board: string;
    board_order?: number;
}

/** Minimal document shape returned by PocketBase REST API */
export interface PBDocument {
    id: string;
    collectionId: string;
    collectionName: string;
    title: string;
    slug: string;
    content: string;
    attachments: string[];
    tags: string[];
    author: string;
    folder?: string;
    word_count: number;
    reading_time: number;
    created: string;
    updated: string;
}

/** Minimal folder shape returned by PocketBase REST API */
export interface PBFolder {
    id: string;
    collectionId: string;
    collectionName: string;
    name: string;
    parent?: string;
    author: string;
    color?: string;
    created: string;
    updated: string;
}

/** PocketBase list response wrapper */
export interface PBListResponse<T> {
    page: number;
    perPage: number;
    totalPages: number;
    totalItems: number;
    items: T[];
}

/** Resolved document with its path info, ready for zipping */
export interface ResolvedDocument {
    doc: PBDocument;
    /** Relative path within the ZIP (e.g. "FolderA/SubFolder") */
    folderPath: string;
}

/** A downloaded attachment file */
export interface AttachmentFile {
    /** Original display name (PB suffix stripped) */
    displayName: string;
    /** Raw PocketBase filename (with random suffix) */
    pbFilename: string;
    /** The file data */
    data: Uint8Array;
}
