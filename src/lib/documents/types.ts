import type { RecordModel } from 'pocketbase';

export interface Document extends RecordModel {
    title: string;
    slug: string;
    content: string;
    attachments: string[]; // File names
    tags: string[];
    published: boolean;
    author: string; // User ID
    folder?: string; // Folder ID
    word_count: number;
    reading_time: number; // minutes
    created: string;
    updated: string;
}

export interface DocumentVersion extends RecordModel {
    document: string; // Document ID
    content: string;
    version_number: number;
    change_summary: string;
    created_by: string; // User ID
    source_created_at?: string;
    created: string;
}

export interface CreateDocumentData {
    title: string;
    content: string;
    tags?: string[];
    published?: boolean;
    folder?: string;
}

export interface UpdateDocumentData {
    title?: string;
    content?: string;
    tags?: string[];
    published?: boolean;
    folder?: string;
    attachments?: File[]; // New files to add
    removeAttachments?: string[]; // File names to remove
}
