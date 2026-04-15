export type ViewMode = 'list' | 'icon';

export type PendingCreate = {
    type: 'folder' | 'document';
    parentFolderId?: string;
    name: string;
};

export type PendingRename = {
    type: 'folder' | 'document';
    id: string;
    name: string;
};
