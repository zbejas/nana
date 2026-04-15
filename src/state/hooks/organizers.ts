import type { Document } from '../../lib/documents';
import type { Folder } from '../../lib/folders';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Organizers');
import { buildFolderTree } from './helpers';

/**
 * Organizes folders into active and trash categories
 */
export function organizeFolders(
    allFolders: Folder[],
    userId: string | undefined
): {
    active: ReturnType<typeof buildFolderTree>;
} {
    const activeFolders = allFolders.filter(f => f.author === userId);

    logger.debug('Folders organized', {
        active: activeFolders.length,
    });

    return {
        active: buildFolderTree(activeFolders),
    };
}

/**
 * Organizes documents into root and trash categories
 * NOTE: Folder documents are intentionally excluded for lazy loading
 */
export function organizeDocuments(
    allDocuments: Document[],
    userId: string | undefined
): {
    root: Document[];
    trash: Document[];
} {
    const rootDocs: Document[] = [];
    const trashDocs: Document[] = [];

    allDocuments.forEach(doc => {
        // Skip non-owned documents
        if (doc.author !== userId) return;

        // Active documents owned by user - only add root documents
        // Folder documents will be lazy-loaded when folders are expanded
        if (!doc.folder) {
            rootDocs.push(doc);
        }
    });

    logger.debug('Documents organized - root docs visible, folder contents deferred', {
        rootDocs: rootDocs.length,
        trash: trashDocs.length,
    });

    return {
        root: rootDocs,
        trash: trashDocs,
    };
}

/**
 * Helper to get all folder IDs from a folder tree (including nested folders)
 */
export function getAllFolderIds(nodes: ReturnType<typeof buildFolderTree>): Set<string> {
    const ids = new Set<string>();
    const traverse = (nodeList: typeof nodes) => {
        for (const node of nodeList) {
            ids.add(node.id);
            if (node.subfolders.length > 0) {
                traverse(node.subfolders);
            }
        }
    };
    traverse(nodes);
    return ids;
}
