import type { RecordModel } from '../record-model';

export interface Document extends RecordModel {
    title: string;
    slug: string;
    content: string;
    attachments: string[]; // File names
    tags: string[];
    is_public: boolean;
    is_private: boolean;
    share_attachments: boolean;
    public_share_token?: string;
    public_expires_at?: string;
    deleted_at?: string;
    deleted_by?: string;
    author: string; // User ID
    folder?: string; // Folder ID
    word_count: number;
    reading_time: number; // minutes
    revision?: number;
    last_edited_by?: string;
    last_edit_source?: 'user' | 'ai' | 'system';
    created: string;
    updated: string;
}

/** A saved note version. `id` is an opaque version id, not a record id. */
export interface DocumentVersion {
    id: string;
    document: string; // Document ID
    /** Present on detail reads; list results omit the body. */
    content?: string;
    version_number: number;
    change_summary: string;
    source_created_at?: string;
    created: string;
    metadata?: {
        title: string;
        tags: string[];
        folder: string;
        is_private: boolean;
    };
}

export interface CreateDocumentVersionResult {
    created: boolean;
    version: DocumentVersion;
}

export interface CreateDocumentData {
    title: string;
    content: string;
    tags?: string[];
    folder?: string;
}

export interface UpdateDocumentData {
    title?: string;
    content?: string;
    tags?: string[];
    /** The revision the editor loaded. Required for conflict detection. */
    revision?: number;
    is_public?: boolean;
    is_private?: boolean;
    share_attachments?: boolean;
    public_share_token?: string | null;
    public_expires_at?: string | null;
    folder?: string;
    attachments?: File[]; // New files to add
    removeAttachments?: string[]; // File names to remove
}
