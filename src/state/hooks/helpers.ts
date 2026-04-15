import type { Folder, FolderTreeNode } from '../../lib/folders';

/**
 * Helper to build folder tree from flat list
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
            // Root folder
            rootFolders.push(node);
        } else {
            // Subfolder - add to parent
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
