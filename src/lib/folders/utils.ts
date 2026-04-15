import { pb } from '../pocketbase';
import type { Folder, FolderTreeNode } from './types';

/**
 * Builds a hierarchical tree structure from a flat list of folders
 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
    const folderMap = new Map<string, FolderTreeNode>();
    const rootFolders: FolderTreeNode[] = [];

    // Create nodes for all folders
    folders.forEach(folder => {
        folderMap.set(folder.id, {
            ...folder,
            subfolders: [],
        });
    });

    // Build the tree structure
    folders.forEach(folder => {
        const node = folderMap.get(folder.id);
        if (!node) return;

        if (!folder.parent) {
            rootFolders.push(node);
        } else {
            const parent = folderMap.get(folder.parent);
            if (parent) {
                parent.subfolders.push(node);
            } else {
                // Parent not found, treat as root
                rootFolders.push(node);
            }
        }
    });

    return rootFolders;
}

/**
 * Gets the current authenticated user ID
 */
export function getCurrentUserId(): string | undefined {
    return pb.authStore.record?.id;
}

/**
 * Checks if a parent folder exists and is not deleted
 */
export async function isParentFolderValid(parentId: string): Promise<boolean> {
    try {
        const parentFolder = await pb.collection('folders').getOne(parentId);
        return true;
    } catch {
        return false;
    }
}
