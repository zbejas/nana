import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('DocSearch');
import type { Document } from './types';

// Search documents
export async function searchDocuments(query: string): Promise<Document[]> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return [];
    }

    const result = await pb.collection('documents').getList<Document>(1, 50, {
        filter: `author="${userId}" && (title ~ "${query}" || content ~ "${query}" || tags ~ "${query}")`,
        sort: '-updated',
    });

    return result.items;
}
