import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('FolderDocs');
import { getCurrentUserId } from './utils';

/**
 * Gets all documents in a specific folder (or root if null)
 */
export async function getFolderDocuments(folderId: string | null): Promise<any[]> {
    try {
        const userId = getCurrentUserId();
        if (!userId) return [];

        logger.debug('Fetching documents for folder', { folderId });

        // Build filter
        let filter = `author="${userId}"`;
        if (folderId) {
            filter += ` && folder="${folderId}"`;
        } else {
            filter += ` && folder=""`;
        }

        logger.debug('Folder documents filter', { filter });

        const result = await pb.collection('documents').getList(1, 100, {
            filter,
            sort: '-updated',
        });

        logger.debug('Folder documents fetched', { total: result.items.length });
        return result.items;
    } catch (error: any) {
        logger.error('Failed to fetch folder documents', {
            folderId,
            error: error.message,
            data: error.data
        });
        return [];
    }
}
