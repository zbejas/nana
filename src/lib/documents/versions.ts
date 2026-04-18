import { pb } from '../pocketbase';
import type { DocumentVersion } from './types';

// Get version history for a document
export async function getDocumentVersions(
    documentId: string,
    page = 1,
    perPage = 20
): Promise<{ items: DocumentVersion[]; totalItems: number }> {
    const result = await pb.collection('document_versions').getList<DocumentVersion>(
        page,
        perPage,
        {
            filter: `document="${documentId}"`,
            sort: '-version_number',
            expand: 'created_by',
        }
    );

    return {
        items: result.items,
        totalItems: result.totalItems,
    };
}

// Get a specific version
export async function getDocumentVersion(versionId: string): Promise<DocumentVersion> {
    return await pb.collection('document_versions').getOne<DocumentVersion>(versionId, {
        expand: 'created_by',
    });
}

// Restore a document to a specific version
export async function restoreDocumentVersion(
    documentId: string,
    versionId: string
): Promise<import('./types').Document> {
    const version = await getDocumentVersion(versionId);

    // Import updateDocument here to avoid circular dependency
    const { updateDocument } = await import('./crud');

    return await updateDocument(
        documentId,
        { content: version.content },
        `Restored to version ${version.version_number}`
    );
}
