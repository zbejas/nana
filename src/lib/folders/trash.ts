import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('FolderTrash');
import type { Folder, FolderTreeNode } from './types';
import { buildFolderTree, getCurrentUserId } from './utils';

async function postTrashAction(path: string, payload: Record<string, unknown>) {
    const response = await fetch(`/pb${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': pb.authStore.token,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let message = 'Trash request failed';
        try {
            const body = await response.json();
            message = body?.error || message;
        } catch {
            // Keep fallback message
        }
        throw new Error(message);
    }

    return response.json().catch(() => ({}));
}

/**
 * Lists all folders in trash
 */
export async function listTrashFolders(): Promise<FolderTreeNode[]> {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
        logger.debug('Fetching trash folders for user', { userId });

        const result = await pb.collection('trash_folders').getList<Folder>(1, 500, {
            filter: `author="${userId}"`,
            sort: '-deleted_at',
        });

        logger.debug('Trash folders fetched', { total: result.items.length });
        return buildFolderTree(result.items);
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Request aborted');
            return [];
        }
        logger.error('Failed to fetch trash folders', { error: error.message });
        return [];
    }
}

/**
 * Restores a folder from trash
 * Clears parent reference if parent folder is deleted or doesn't exist
 */
export async function restoreFolder(id: string): Promise<Folder> {
    try {
        await postTrashAction('/api/trash/restore-folder', { trashFolderId: id });
        const restoredList = await pb.collection('folders').getList<Folder>(1, 1, {
            filter: `author="${getCurrentUserId()}"`,
            sort: '-updated',
        });
        const restored = restoredList.items[0];
        if (!restored) {
            throw new Error('Folder restored but failed to fetch updated folder state');
        }
        logger.info('Folder restored', { id });
        return restored;
    } catch (error: any) {
        logger.error('Failed to restore folder', {
            id,
            message: error.message,
        });
        throw error;
    }
}

/**
 * Permanently deletes a folder from trash
 */
export async function permanentlyDeleteFolder(id: string): Promise<boolean> {
    await postTrashAction('/api/trash/permanent-delete-folder', { trashFolderId: id });
    return true;
}
