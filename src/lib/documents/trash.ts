import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('DocTrash');
import type { Document } from './types';

async function postTrashAction(path: string, payload: Record<string, unknown>) {
    const response = await fetch(`/pb${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': pb.authStore.token,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let message = 'Trash request failed';
        try {
            const body = await response.json();
            message = body?.error || message;
        } catch {
            // Keep fallback message
        }
        throw new Error(message);
    }

    return response.json().catch(() => ({}));
}

// Delete a document (move to trash collection)
export async function deleteDocument(id: string): Promise<boolean> {
    await postTrashAction('/api/trash/move-document', { documentId: id });
    return true;
}

// List trash documents
export async function listTrashDocuments(options?: {
    page?: number;
    perPage?: number;
}): Promise<{ items: Document[]; totalItems: number; totalPages: number }> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return { items: [], totalItems: 0, totalPages: 0 };
    }

    try {
        const filter = `author="${userId}"`;

        const result = await pb.collection('trash_documents').getList<Document>(
            options?.page || 1,
            options?.perPage || 100,
            {
                filter,
                sort: '-deleted_at',
                requestKey: `trash-documents/list:${options?.page || 1}:${options?.perPage || 100}`,
            }
        );

        return {
            items: result.items,
            totalItems: result.totalItems,
            totalPages: result.totalPages,
        };
    } catch (error: any) {
        if (error.isAbort) {
            return { items: [], totalItems: 0, totalPages: 0 };
        }
        logger.error('Failed to fetch trash documents', {
            userId,
            message: error.message,
        });
        return { items: [], totalItems: 0, totalPages: 0 };
    }
}

// Permanently delete a document from trash
export async function permanentlyDeleteDocument(id: string): Promise<boolean> {
    await postTrashAction('/api/trash/permanent-delete-document', { trashDocumentId: id });
    return true;
}

// Restore a document from trash
export async function restoreDocument(id: string): Promise<Document> {
    try {
        const restoreResult = await postTrashAction('/api/trash/restore-document', {
            trashDocumentId: id,
        });

        const restoredId = restoreResult?.documentId;
        if (!restoredId) {
            throw new Error('Missing restored document id in response');
        }

        const restored = await pb.collection('documents').getOne<Document>(restoredId);
        logger.info('Document restored', { id, restoredId });
        return restored;
    } catch (error: any) {
        logger.error('Failed to restore document', {
            id,
            message: error.message,
        });
        throw error;
    }
}

export async function getTrashDocument(id: string): Promise<Document> {
    return await pb.collection('trash_documents').getOne<Document>(id);
}
