// Re-export all types
export type {
    Folder,
    FolderTreeNode,
    CreateFolderData,
    UpdateFolderData,
} from './types';

// Re-export CRUD operations
export {
    createFolder,
    updateFolder,
    getFolder,
    deleteFolder,
    listFolders,
    getAllFolders,
    hasSubfolders,
    getFolderPath,
    moveFolder,
    publishFolder,
    unpublishFolder,
} from './crud';

// Re-export tree operations
export { getFolderTree } from './tree';

// Re-export trash operations
export {
    listTrashFolders,
    restoreFolder,
    permanentlyDeleteFolder,
} from './trash';

// Re-export document operations
export { getFolderDocuments } from './documents';

// Re-export utilities
export { buildFolderTree } from './utils';
