import { getBoard, updateBoard, type Board } from './boards';
import { getDocument, updateDocument, type Document } from './documents';
import { buildFolderTree, getFolder, updateFolder, type Folder, type FolderTreeNode } from './folders';
import type { TaskPriority, TaskStatus } from './tasks';

export type ShareTargetType = 'document' | 'folder' | 'board';

export interface ShareableRecord {
    id: string;
    is_public: boolean;
    is_private: boolean;
    share_attachments?: boolean;
    public_share_token?: string;
    public_expires_at?: string;
}

export interface PublicAuthor {
    id: string;
    name: string;
}

export interface PublicDocumentShareResponse {
    type: 'document';
    shareToken: string;
    expiresAt: string | null;
    shareAttachments: boolean;
    author: PublicAuthor | null;
    document: Document;
}

export interface PublicFolderShareResponse {
    type: 'folder';
    shareToken: string;
    expiresAt: string | null;
    shareAttachments: boolean;
    author: PublicAuthor | null;
    rootFolder: Folder;
    folders: Folder[];
    documents: Document[];
    boards: PublicFolderBoard[];
    entryDocumentId: string | null;
}

export interface PublicBoard {
    id: string;
    name: string;
    description: string;
    author: string;
    folder: string;
    created: string;
    updated: string;
}

export interface PublicBoardTask {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority | '';
    due_date: string | null;
    board_order: number;
    labels: string[];
    created: string | null;
    updated: string | null;
}

export interface PublicBoardShareResponse {
    type: 'board';
    shareToken: string;
    expiresAt: string | null;
    author: PublicAuthor | null;
    board: PublicBoard;
    tasks: PublicBoardTask[];
}

/**
 * A board reached through a shared folder. It carries its tasks so the folder
 * reader can render it without a separate share token.
 */
export interface PublicFolderBoard extends PublicBoard {
    tasks: PublicBoardTask[];
}

export interface PublicShareUpdateOptions {
    enabled: boolean;
    expiresAt: string | null;
    isPrivate: boolean;
    shareAttachments: boolean;
}

function baseUrl() {
    if (typeof window === 'undefined') {
        return '';
    }

    return window.location.origin;
}

function randomHex(bytes: number) {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function generatePublicShareToken() {
    return randomHex(20);
}

export function getDefaultPublicExpiryDate() {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    date.setDate(date.getDate() + 7);
    return date;
}

export function toDatetimeLocalValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function fromDatetimeLocalValue(value: string) {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

export function getPublicDocumentUrl(shareToken: string) {
    return `${baseUrl()}/public/document/${shareToken}`;
}

export function getPublicFolderUrl(shareToken: string) {
    return `${baseUrl()}/public/folder/${shareToken}`;
}

export function getPublicBoardUrl(shareToken: string) {
    return `${baseUrl()}/public/board/${shareToken}`;
}

function publicFetch(path: string) {
    return fetch(`/api/v1${path.replace(/^\/api/, '')}`, {
        headers: {
            Accept: 'application/json',
        },
    });
}

async function updateDocumentShareFields(document: Document, options: PublicShareUpdateOptions) {
    const publicShareToken = options.enabled
        ? document.public_share_token || generatePublicShareToken()
        : null;

    return updateDocument(document.id, {
        is_public: options.enabled,
        is_private: options.isPrivate,
        share_attachments: options.shareAttachments,
        public_share_token: publicShareToken,
        public_expires_at: options.enabled ? options.expiresAt : null,
    });
}

async function updateFolderShareFields(folder: Folder, options: PublicShareUpdateOptions) {
    const publicShareToken = options.enabled
        ? folder.public_share_token || generatePublicShareToken()
        : null;

    return updateFolder(folder.id, {
        is_public: options.enabled,
        is_private: options.isPrivate,
        share_attachments: options.shareAttachments,
        public_share_token: publicShareToken,
        public_expires_at: options.enabled ? options.expiresAt : null,
    });
}

async function updateBoardShareFields(board: Board, options: PublicShareUpdateOptions) {
    const publicShareToken = options.enabled
        ? board.public_share_token || generatePublicShareToken()
        : null;

    return updateBoard(board.id, {
        is_public: options.enabled,
        is_private: options.isPrivate,
        public_share_token: publicShareToken,
        public_expires_at: options.enabled ? options.expiresAt : null,
    });
}

export async function getDocumentForPublicShare(documentId: string) {
    return getDocument(documentId);
}

export async function getFolderForPublicShare(folderId: string) {
    return getFolder(folderId);
}

export async function getBoardForPublicShare(boardId: string) {
    return getBoard(boardId);
}

export async function updateDocumentPublicShare(document: Document, options: PublicShareUpdateOptions) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const nextDocument = attempt === 0 ? document : await getDocument(document.id);
            return await updateDocumentShareFields(nextDocument, options);
        } catch (error: any) {
            const tokenError = error?.data?.data?.public_share_token;
            const isUniqueConflict = tokenError?.code === 'validation_not_unique' || /unique/i.test(tokenError?.message || '');

            if (!options.enabled || !isUniqueConflict || attempt === 2) {
                throw error;
            }
        }
    }

    throw new Error('Failed to update document public share');
}

export async function updateFolderPublicShare(folder: Folder, options: PublicShareUpdateOptions) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const nextFolder = attempt === 0 ? folder : await getFolder(folder.id);
            return await updateFolderShareFields(nextFolder, options);
        } catch (error: any) {
            const tokenError = error?.data?.data?.public_share_token;
            const isUniqueConflict = tokenError?.code === 'validation_not_unique' || /unique/i.test(tokenError?.message || '');

            if (!options.enabled || !isUniqueConflict || attempt === 2) {
                throw error;
            }
        }
    }

    throw new Error('Failed to update folder public share');
}

export async function updateBoardPublicShare(board: Board, options: PublicShareUpdateOptions) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const nextBoard = attempt === 0 ? board : await getBoard(board.id);
            return await updateBoardShareFields(nextBoard, options);
        } catch (error: any) {
            const tokenError = error?.data?.data?.public_share_token;
            const isUniqueConflict = tokenError?.code === 'validation_not_unique' || /unique/i.test(tokenError?.message || '');

            if (!options.enabled || !isUniqueConflict || attempt === 2) {
                throw error;
            }
        }
    }

    throw new Error('Failed to update board public share');
}

export async function fetchPublicDocumentShare(shareToken: string): Promise<PublicDocumentShareResponse> {
    const response = await publicFetch(`/api/public/documents/${encodeURIComponent(shareToken)}`);

    if (!response.ok) {
        throw new Error(response.status === 404 ? 'not-found' : 'Failed to load public document');
    }

    return response.json() as Promise<PublicDocumentShareResponse>;
}

export async function fetchPublicFolderShare(shareToken: string): Promise<PublicFolderShareResponse> {
    const response = await publicFetch(`/api/public/folders/${encodeURIComponent(shareToken)}`);

    if (!response.ok) {
        throw new Error(response.status === 404 ? 'not-found' : 'Failed to load public folder');
    }

    return response.json() as Promise<PublicFolderShareResponse>;
}

export async function fetchPublicBoardShare(shareToken: string): Promise<PublicBoardShareResponse> {
    const response = await publicFetch(`/api/public/boards/${encodeURIComponent(shareToken)}`);

    if (!response.ok) {
        throw new Error(response.status === 404 ? 'not-found' : 'Failed to load public board');
    }

    return response.json() as Promise<PublicBoardShareResponse>;
}

export function getPublicDocumentAttachmentUrl(shareToken: string, filename: string) {
    return `/api/v1/public/documents/${encodeURIComponent(shareToken)}/files/${encodeURIComponent(filename)}`;
}

export function getPublicFolderAttachmentUrl(shareToken: string, documentId: string, filename: string) {
    return `/api/v1/public/folders/${encodeURIComponent(shareToken)}/files/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewritePublicAttachmentUrls(
    content: string,
    document: Document,
    resolveUrl: (filename: string) => string,
) {
    let nextContent = content;

    for (const filename of document.attachments || []) {
        const escapedFilename = escapeRegExp(filename);
        const escapedDocumentId = escapeRegExp(document.id);
        const patterns = [
            // Legacy /pb content from notes saved before the Elysia cutover.
            new RegExp(`https?:\\/\\/[^\\s)"]+\\/pb\\/api\\/files\\/[^\\/]+\\/${escapedDocumentId}\\/${escapedFilename}(?:\\?[^\\s)"]*)?`, 'g'),
            new RegExp(`\\/pb\\/api\\/files\\/[^\\/]+\\/${escapedDocumentId}\\/${escapedFilename}(?:\\?[^\\s)"]*)?`, 'g'),
            // Current same-origin file paths.
            new RegExp(`https?:\\/\\/[^\\s)"]+\\/api\\/v1\\/files\\/[^\\/]+\\/${escapedDocumentId}\\/${escapedFilename}(?:\\?[^\\s)"]*)?`, 'g'),
            new RegExp(`\\/api\\/v1\\/files\\/[^\\/]+\\/${escapedDocumentId}\\/${escapedFilename}(?:\\?[^\\s)"]*)?`, 'g'),
            new RegExp(`\\/api\\/files\\/[^\\/]+\\/${escapedDocumentId}\\/${escapedFilename}(?:\\?[^\\s)"]*)?`, 'g'),
        ];

        for (const pattern of patterns) {
            nextContent = nextContent.replace(pattern, resolveUrl(filename));
        }
    }

    return nextContent;
}

export function buildPublicFolderTree(response: PublicFolderShareResponse): FolderTreeNode[] {
    return buildFolderTree(response.folders);
}