import { pb } from '../pocketbase';
import type {
    CreateDocumentVersionResult,
    Document,
    DocumentVersion,
} from './types';

interface VersionPage {
    items: DocumentVersion[];
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
}

// Get version history for a document. List results omit the Markdown body.
export async function getDocumentVersions(
    documentId: string,
    page = 1,
    perPage = 20
): Promise<VersionPage> {
    return await pb.send<VersionPage>(
        `/documents/${encodeURIComponent(documentId)}/versions?page=${page}&perPage=${perPage}`
    );
}

// Get one version, including its Markdown body for the preview.
export async function getDocumentVersion(
    documentId: string,
    versionId: string
): Promise<DocumentVersion> {
    return await pb.send<DocumentVersion>(
        `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`
    );
}

// Commit the current note state as a version.
export async function createDocumentVersion(
    documentId: string,
    expectedRevision: number
): Promise<CreateDocumentVersionResult> {
    return await pb.send<CreateDocumentVersionResult>(
        `/documents/${encodeURIComponent(documentId)}/versions`,
        {
            method: 'POST',
            body: { expectedRevision },
        }
    );
}

// Restore a version body. The server commits the current state first, then
// writes only the selected Markdown body; title, tags, folder, and privacy stay.
export async function restoreDocumentVersion(
    documentId: string,
    versionId: string,
    expectedRevision: number
): Promise<Document> {
    const result = await pb.send<{ document: Document }>(
        `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`,
        {
            method: 'POST',
            body: { expectedRevision },
        }
    );

    return result.document;
}
