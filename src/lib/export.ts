import { pb } from './pocketbase';
import { createLogger } from './logger';

const logger = createLogger('Export');

/**
 * Trigger a browser download from a Blob.
 */
function downloadFile(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Extract the filename from a Content-Disposition header, or fall back to a default.
 */
function parseFilename(header: string | null, fallback: string): string {
    if (header) {
        const match = header.match(/filename="?([^";\n]+)"?/);
        if (match?.[1]) return match[1];
    }
    return fallback;
}

/**
 * Internal helper: POST to /api/export and trigger a browser download of the returned ZIP.
 */
async function requestExport(body: {
    documentIds?: string[];
    folderIds?: string[];
    zipName?: string;
}, fallbackFilename: string): Promise<void> {
    const token = pb.authStore.token;
    if (!token) {
        throw new Error('User not authenticated');
    }

    const response = await fetch('/api/export', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        let message = 'Export failed';
        try {
            const err = await response.json() as { error?: string };
            if (err.error) message = err.error;
        } catch { /* ignore parse errors */ }
        throw new Error(message);
    }

    const blob = await response.blob();
    const filename = parseFilename(response.headers.get('Content-Disposition'), fallbackFilename);
    downloadFile(blob, filename);
}

/**
 * Export a single document (downloads a ZIP with the document and its attachments).
 */
export async function exportDocument(documentId: string): Promise<void> {
    try {
        logger.info('Exporting document', { documentId });
        await requestExport({ documentIds: [documentId] }, 'export.zip');
        logger.info('Document exported successfully', { documentId });
    } catch (error) {
        logger.error('Failed to export document', { documentId, error });
        throw error instanceof Error ? error : new Error('Failed to export document');
    }
}

/**
 * Export all documents in a folder as a ZIP (preserves folder hierarchy, includes attachments).
 */
export async function exportFolder(folderId: string, folderName: string): Promise<void> {
    try {
        logger.info('Exporting folder', { folderId, folderName });
        await requestExport(
            { folderIds: [folderId], zipName: folderName },
            `${folderName || 'export'}.zip`,
        );
        logger.info('Folder exported successfully', { folderId, folderName });
    } catch (error) {
        logger.error('Failed to export folder', { folderId, folderName, error });
        throw error instanceof Error ? error : new Error('Failed to export folder');
    }
}

/**
 * Export a selection of documents and/or folders as a single ZIP.
 */
export async function exportSelectionAsZip(options: {
    selectedFolderIds: string[];
    selectedDocumentIds: string[];
    zipName: string;
}): Promise<void> {
    const { selectedFolderIds, selectedDocumentIds, zipName } = options;
    try {
        logger.info('Exporting selection', {
            folderCount: selectedFolderIds.length,
            documentCount: selectedDocumentIds.length,
        });
        await requestExport(
            {
                folderIds: selectedFolderIds,
                documentIds: selectedDocumentIds,
                zipName,
            },
            `${zipName || 'export'}.zip`,
        );
        logger.info('Selection exported successfully');
    } catch (error) {
        logger.error('Failed to export selection', { error });
        throw error instanceof Error ? error : new Error('Failed to export selection');
    }
}
