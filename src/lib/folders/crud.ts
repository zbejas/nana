import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('Folders');
import type { Folder, CreateFolderData, UpdateFolderData } from './types';
import { getCurrentUserId } from './utils';

/**
 * Creates a new folder
 */
export async function createFolder(data: CreateFolderData): Promise<Folder> {
    try {
        const folderData: any = {
            name: data.name,
            author: getCurrentUserId(),
            published: false,
        };

        // Only set optional fields if they have values (relation fields don't accept empty strings)
        if (data.parent) folderData.parent = data.parent;
        if (data.color) folderData.color = data.color;

        logger.debug('Creating folder', { data: folderData });
        const result = await pb.collection('folders').create<Folder>(folderData);
        logger.info('Folder created', { id: result.id });
        return result;
    } catch (error: any) {
        logger.error('Failed to create folder', {
            status: error.status,
            message: error.message,
            data: error.data
        });
        throw error;
    }
}

/**
 * Updates an existing folder
 */
export async function updateFolder(id: string, data: UpdateFolderData): Promise<Folder> {
    const updates: Record<string, any> = {};

    if (data.name !== undefined) updates.name = data.name;
    if (data.parent !== undefined) updates.parent = data.parent;
    if (data.color !== undefined) updates.color = data.color;

    return await pb.collection('folders').update<Folder>(id, updates);
}

/**
 * Gets a folder by ID with expanded relations
 */
export async function getFolder(id: string): Promise<Folder> {
    return await pb.collection('folders').getOne<Folder>(id, {
        expand: 'author,parent',
    });
}

/**
 * Deletes a folder permanently (and all its subfolders due to cascade)
 */
export async function deleteFolder(id: string): Promise<boolean> {
    const response = await fetch('/pb/api/trash/move-folder', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': pb.authStore.token,
        },
        body: JSON.stringify({ folderId: id }),
    });

    if (!response.ok) {
        let message = 'Failed to move folder to trash';
        try {
            const body = await response.json();
            message = body?.error || message;
        } catch {
            // keep fallback
        }
        throw new Error(message);
    }

    return true;
}

/**
 * Lists folders by parent ID
 */
export async function listFolders(parentId?: string | null): Promise<Folder[]> {
    const userId = getCurrentUserId();
    if (!userId) return [];

    let filter = `author="${userId}"`;

    // Filter by parent folder
    if (parentId === undefined || parentId === null || parentId === '') {
        filter += ` && parent=""`;
    } else {
        filter += ` && parent="${parentId}"`;
    }

    const result = await pb.collection('folders').getList<Folder>(1, 200, {
        filter,
        sort: 'name',
        expand: 'parent',
    });

    return result.items;
}

/**
 * Gets all folders for the current user
 */
export async function getAllFolders(): Promise<Folder[]> {
    const userId = getCurrentUserId();
    if (!userId) {
        logger.debug('No user ID available for getAllFolders');
        return [];
    }

    try {
        logger.debug('Fetching folder structure (contents load on-demand)', { userId });

        const result = await pb.collection('folders').getList<Folder>(1, 500, {
            filter: `author="${userId}"`,
            sort: 'name',
        });

        logger.debug('Folder structure fetched (contents load on-demand)', { total: result.items.length });
        return result.items;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Request aborted');
            return [];
        }
        logger.error('Failed to fetch folders', { error: error.message });
        return [];
    }
}

/**
 * Checks if a folder has any subfolders
 */
export async function hasSubfolders(folderId: string): Promise<boolean> {
    const result = await pb.collection('folders').getList<Folder>(1, 1, {
        filter: `parent="${folderId}"`,
    });
    return result.totalItems > 0;
}

/**
 * Gets the folder path (breadcrumb trail) from root to the given folder
 */
export async function getFolderPath(folderId: string): Promise<Folder[]> {
    const path: Folder[] = [];
    let currentId: string | undefined = folderId;

    while (currentId) {
        const folder = await getFolder(currentId);
        path.unshift(folder);
        currentId = folder.parent;
    }

    return path;
}

/**
 * Moves a folder to a new parent
 */
export async function moveFolder(folderId: string, newParentId: string | null): Promise<Folder> {
    return await updateFolder(folderId, {
        parent: newParentId || undefined,
    });
}

/**
 * Toggles the published status of a folder
 */
export async function setFolderPublished(folderId: string, published: boolean): Promise<Folder> {
    try {
        logger.debug(`${published ? 'Publishing' : 'Unpublishing'} folder`, { folderId });

        const updated = await pb.collection('folders').update<Folder>(folderId, {
            published,
        });

        logger.info(`Folder ${published ? 'published' : 'unpublished'} successfully`, { folderId });
        return updated;
    } catch (error: any) {
        logger.error(`Failed to ${published ? 'publish' : 'unpublish'} folder`, {
            folderId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Publishes a folder
 */
export const publishFolder = (folderId: string) => setFolderPublished(folderId, true);

/**
 * Unpublishes a folder
 */
export const unpublishFolder = (folderId: string) => setFolderPublished(folderId, false);
