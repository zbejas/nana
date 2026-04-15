// Re-export all types
export type {
    Document,
    DocumentVersion,
    CreateDocumentData,
    UpdateDocumentData,
} from './types';

// Re-export CRUD operations
export {
    createDocument,
    updateDocument,
    getDocument,
    getDocumentBySlug,
    listDocuments,
    getTimelineDocumentsPage,
    getTimelineDocumentsByDateRange,
    loadFolderDocuments,
    loadMultipleFoldersDocuments,
    getRootDocuments,
    getRecentDocuments,
    getDocumentStats,
} from './crud';

// Re-export search operations
export {
    searchDocuments,
} from './search';

// Re-export trash operations
export {
    deleteDocument,
    listTrashDocuments,
    permanentlyDeleteDocument,
    restoreDocument,
    getTrashDocument,
} from './trash';

// Re-export version operations
export {
    getDocumentVersions,
    getDocumentVersion,
    restoreDocumentVersion,
} from './versions';

// Re-export attachment utilities
export {
    getAttachmentUrl,
    getOriginalFilename,
    getAttachmentUrls,
    getAttachmentUrlWithFreshToken,
} from './attachments';

// Re-export utilities
export {
    generateSlug,
} from './utils';
