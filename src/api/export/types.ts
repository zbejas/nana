/**
 * Types for the server-side export API
 */

/** Incoming request body for POST /api/export */
export interface ExportRequest {
    documentIds?: string[];
    folderIds?: string[];
    zipName?: string;
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
    published: boolean;
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
    published: boolean;
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
