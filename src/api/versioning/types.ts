/** Stable metadata stored beside each committed note body. */
export interface VersionMetadata {
    title: string;
    tags: string[];
    folder: string;
    is_private: boolean;
}

/** The part of a document that a version commit captures. */
export interface NoteSnapshot {
    content: string;
    metadata: VersionMetadata;
}

export interface VersionEntry {
    /** Git commit id. The UI treats this as an opaque version id. */
    id: string;
    document: string;
    version_number: number;
    change_summary: string;
    source_created_at: string;
    created: string;
}

export interface VersionDetail extends VersionEntry {
    content: string;
    metadata: VersionMetadata;
}

export interface VersionPage {
    items: VersionEntry[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
}

export interface CommitResult {
    created: boolean;
    version: VersionEntry;
}
