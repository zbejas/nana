import type { RecordModel } from 'pocketbase';

export interface Folder extends RecordModel {
    name: string;
    parent?: string; // Parent folder ID (null for root folders)
    author: string; // User ID
    color?: string;
    published: boolean;
    is_public: boolean;
    public_share_token?: string;
    public_expires_at?: string;
    created: string;
    updated: string;
}

export interface FolderTreeNode extends Folder {
    subfolders: FolderTreeNode[];
}

export interface CreateFolderData {
    name: string;
    parent?: string;
    color?: string;
}

export interface UpdateFolderData {
    name?: string;
    parent?: string;
    color?: string;
    is_public?: boolean;
    public_share_token?: string | null;
    public_expires_at?: string | null;
}
