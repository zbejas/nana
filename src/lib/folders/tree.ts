import { createLogger } from '../logger';

const logger = createLogger('FolderTree');
import type { FolderTreeNode } from './types';
import { getAllFolders } from './crud';
import { buildFolderTree, getCurrentUserId } from './utils';

/**
 * Gets the folder tree structure for active folders (non-deleted, owned by user)
 */
export async function getFolderTree(): Promise<FolderTreeNode[]> {
    const userId = getCurrentUserId();
    if (!userId) {
        logger.debug('No user ID available for getFolderTree');
        return [];
    }

    try {
        logger.debug('Building folder tree for user', { userId });

        const allFolders = await getAllFolders();

        // Return only non-deleted folders owned by user
        const activeFolders = allFolders.filter(f => f.author === userId);
        return buildFolderTree(activeFolders);
    } catch (error: any) {
        logger.error('Failed to build folder tree', {
            status: error.status,
            message: error.message,
            data: error.data
        });
        return [];
    }
}
