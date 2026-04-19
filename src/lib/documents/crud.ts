import { pb } from '../pocketbase';
import { createLogger } from '../logger';

const logger = createLogger('Documents');
import type { Document, CreateDocumentData, UpdateDocumentData } from './types';
import { generateSlug } from './utils';
import { sanitizeHtml } from '../sanitize';

// ── Auto-embed helpers ───────────────────────────────────────────────

/** Tracks recently triggered embeds to avoid duplicate requests during rapid auto-save. */
const recentEmbedTriggers = new Map<string, number>();
const EMBED_DEBOUNCE_MS = 5_000;

/**
 * Fire-and-forget request to embed a document.
 * Debounced per documentId to avoid flooding during auto-save.
 */
function triggerAutoEmbed(documentId: string): void {
    const now = Date.now();
    const last = recentEmbedTriggers.get(documentId) ?? 0;
    if (now - last < EMBED_DEBOUNCE_MS) return;
    recentEmbedTriggers.set(documentId, now);

    // Clean up old entries periodically
    if (recentEmbedTriggers.size > 100) {
        for (const [id, ts] of recentEmbedTriggers) {
            if (now - ts > EMBED_DEBOUNCE_MS * 2) recentEmbedTriggers.delete(id);
        }
    }

    const token = pb.authStore.token;
    if (!token) return;

    const url = `${pb.baseURL.replace(/\/pb$/, '')}/api/embeddings/embed`;

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: token,
        },
        body: JSON.stringify({ documentId, auto: true }),
    }).catch(() => {
        // Best-effort — never block the save flow
    });
}

// Request deduplication cache
let listDocumentsPromise: Promise<{ items: Document[]; totalItems: number; totalPages: number }> | null = null;

// Create a new document
export async function createDocument(data: CreateDocumentData): Promise<Document> {
    try {
        const normalizedTitle = (data.title || '').trim() || 'Untitled';
        const sanitizedContent = data.content ? await sanitizeHtml(data.content) : data.content;
        const documentData: any = {
            title: normalizedTitle,
            slug: generateSlug(normalizedTitle),
            content: sanitizedContent,
            tags: data.tags || [],
            published: data.published || false,
            author: pb.authStore.record?.id,
        };

        // Only set folder if it has a value (relation fields don't accept empty strings)
        if (data.folder) {
            documentData.folder = data.folder;
        }

        logger.debug('Creating document', { data: documentData });
        const document = await pb.collection('documents').create<Document>(documentData);
        logger.info('Document created', { id: document.id });

        // Auto-embed the new document (fire-and-forget)
        if (document.content && document.content.trim().length > 0) {
            triggerAutoEmbed(document.id);
        }

        return document;
    } catch (error: any) {
        logger.error('Failed to create document', {
            status: error.status,
            message: error.message,
            data: error.data
        });
        throw error;
    }
}

// Update a document
export async function updateDocument(
    id: string,
    data: UpdateDocumentData,
    changeSummary?: string
): Promise<Document> {
    try {
        const formData = new FormData();

        if (data.title !== undefined) {
            const normalizedTitle = (data.title || '').trim() || 'Untitled';
            formData.append('title', normalizedTitle);
            formData.append('slug', generateSlug(normalizedTitle));
        }

        if (data.content !== undefined) {
            const sanitizedContent = await sanitizeHtml(data.content);
            formData.append('content', sanitizedContent);
        }

        if (data.tags !== undefined) {
            formData.append('tags', JSON.stringify(data.tags));
        }

        if (data.published !== undefined) {
            formData.append('published', String(data.published));
        }

        if (data.is_public !== undefined) {
            formData.append('is_public', String(data.is_public));
        }

        if (data.public_share_token !== undefined) {
            formData.append('public_share_token', data.public_share_token || '');
        }

        if (data.public_expires_at !== undefined) {
            formData.append('public_expires_at', data.public_expires_at || '');
        }

        // Handle folder field - relation fields don't accept empty strings
        if (data.folder !== undefined) {
            formData.append('folder', data.folder || '');
        }

        // Get the current document to preserve existing attachments
        const currentDoc = await pb.collection('documents').getOne<Document>(id);

        // Keep existing attachments that aren't being removed
        const existingAttachments = (currentDoc.attachments || []).filter(
            filename => !data.removeAttachments?.includes(filename)
        );

        // If we have attachments to keep or add, send them
        // If we have nothing, explicitly clear the field
        if (existingAttachments.length > 0 || (data.attachments && data.attachments.length > 0)) {
            // Add existing attachment filenames to preserve them
            for (const filename of existingAttachments) {
                formData.append('attachments', filename);
            }

            // Add new attachment files
            if (data.attachments && data.attachments.length > 0) {
                for (const file of data.attachments) {
                    formData.append('attachments', file);
                }
            }
        } else {
            // Explicitly clear attachments by sending empty array
            formData.append('attachments', '');
        }

        logger.debug('Updating document', {
            id,
            newAttachments: data.attachments?.length || 0,
            removedAttachments: data.removeAttachments?.length || 0,
            existingKept: existingAttachments.length,
            totalAfter: existingAttachments.length + (data.attachments?.length || 0)
        });

        const document = await pb.collection('documents').update<Document>(id, formData);
        logger.info('Document updated', { id });

        // Auto-embed when content was updated (fire-and-forget)
        if (data.content !== undefined) {
            triggerAutoEmbed(id);
        }

        return document;
    } catch (error: any) {
        logger.error('Failed to update document', {
            id,
            status: error.status,
            message: error.message,
            data: error.data
        });
        throw error;
    }
}

// Get a document by ID
export async function getDocument(id: string): Promise<Document> {
    return await pb.collection('documents').getOne<Document>(id, {
        expand: 'author',
    });
}

// Get a document by slug
export async function getDocumentBySlug(slug: string): Promise<Document> {
    const result = await pb.collection('documents').getFirstListItem<Document>(
        `slug="${slug}"`,
        { expand: 'author' }
    );
    return result;
}

// List all documents (active + trash; client filters by view)
export async function listDocuments(options?: {
    page?: number;
    perPage?: number;
    filter?: string;
    sort?: string;
}): Promise<{ items: Document[]; totalItems: number; totalPages: number }> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return { items: [], totalItems: 0, totalPages: 0 };
    }

    // Return existing promise if one is in flight
    if (listDocumentsPromise) {
        logger.debug('Reusing in-flight request');
        return listDocumentsPromise;
    }

    // Create new promise and cache it
    listDocumentsPromise = (async () => {
        try {
            logger.debug('Fetching document metadata for indexing and search', { userId });

            // Fetch ALL documents owned by user
            const result = await pb.collection('documents').getList<Document>(
                1,
                500, // Get up to 500 documents
                {
                    filter: `author="${userId}"`,
                    sort: options?.sort || '-updated',
                    requestKey: `documents/list:${options?.sort || '-updated'}`,
                }
            );

            logger.debug('Document metadata fetched for indexing and search', { total: result.items.length });

            // Return all documents
            const allDocuments = result.items;

            // Apply pagination manually if requested
            const page = options?.page || 1;
            const perPage = options?.perPage || 500; // Default to all
            const startIndex = (page - 1) * perPage;
            const endIndex = startIndex + perPage;
            const paginatedItems = allDocuments.slice(startIndex, endIndex);

            return {
                items: paginatedItems,
                totalItems: allDocuments.length,
                totalPages: Math.ceil(allDocuments.length / perPage),
            };
        } catch (error: any) {
            // Suppress PocketBase auto-cancellation errors (expected behavior)
            if (error.isAbort) {
                logger.debug('Request aborted');
                return { items: [], totalItems: 0, totalPages: 0 };
            }

            logger.error('Failed to fetch documents', {
                userId,
                status: error.status,
                message: error.message,
                data: error.data,
                url: error.url,
            });

            // Return empty array instead of throwing to prevent UI crashes
            return { items: [], totalItems: 0, totalPages: 0 };
        } finally {
            // Clear cache after request completes
            listDocumentsPromise = null;
        }
    })();

    return listDocumentsPromise;
}

// Load documents for a specific folder (lazy loading)
export async function loadFolderDocuments(
    folderId: string,
    options?: { includeTrash?: boolean }
): Promise<Document[]> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return [];
    }

    try {
        logger.debug('Loading folder documents', { folderId, includeTrash: options?.includeTrash });

        // Build filter for this specific folder
        const ownershipFilter = `author="${userId}"`;
        const folderFilter = `folder="${folderId}"`;
        const isTrash = options?.includeTrash === true;

        const result = await pb.collection(isTrash ? 'trash_documents' : 'documents').getList<Document>(
            1,
            500, // Max per folder
            {
                filter: `${ownershipFilter} && ${folderFilter}`,
                sort: isTrash ? '-deleted_at' : '-updated',
                requestKey: `documents/folder:${folderId}:${isTrash ? 'trash' : 'active'}`,
            }
        );

        logger.debug('Folder documents loaded', {
            folderId,
            count: result.items.length,
            includeTrash: options?.includeTrash,
            documentIds: result.items.map(d => d.id),
            documentFolders: result.items.map(d => ({ id: d.id, folder: d.folder, title: d.title }))
        });

        return result.items;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Folder documents request aborted', { folderId });
            return [];
        }

        logger.error('Failed to load folder documents', {
            folderId,
            message: error.message,
        });
        return [];
    }
}

// Load documents for multiple folders at once (batched)
export async function loadMultipleFoldersDocuments(
    folderIds: string[],
    options?: { includeTrash?: boolean }
): Promise<Map<string, Document[]>> {
    const userId = pb.authStore.record?.id;
    if (!userId || folderIds.length === 0) {
        return new Map();
    }

    try {
        logger.debug('Loading documents for multiple folders (batched)', {
            folderIds,
            includeTrash: options?.includeTrash
        });

        // Build filter for all folders at once
        const ownershipFilter = `author="${userId}"`;
        const folderFilter = folderIds.map(id => `folder="${id}"`).join(' || ');
        const isTrash = options?.includeTrash === true;

        const result = await pb.collection(isTrash ? 'trash_documents' : 'documents').getList<Document>(
            1,
            500, // Max total documents
            {
                filter: isTrash
                    ? `${ownershipFilter} && (${folderFilter})`
                    : `${ownershipFilter} && (${folderFilter})`,
                sort: isTrash ? '-deleted_at' : '-updated',
                requestKey: `documents/folders-batch:${isTrash ? 'trash' : 'active'}:${[...folderIds].sort().join(',')}`,
            }
        );

        // Group documents by folder ID
        const docsByFolder = new Map<string, Document[]>();

        // Initialize all folders with empty arrays
        for (const folderId of folderIds) {
            docsByFolder.set(folderId, []);
        }

        // Distribute documents to their folders
        for (const doc of result.items) {
            if (doc.folder) {
                const existing = docsByFolder.get(doc.folder) || [];
                existing.push(doc);
                docsByFolder.set(doc.folder, existing);
            }
        }

        logger.debug('Multiple folders documents loaded', {
            folderCount: folderIds.length,
            totalDocs: result.items.length,
            breakdown: Array.from(docsByFolder.entries()).map(([folderId, docs]) => ({
                folderId,
                count: docs.length
            }))
        });

        return docsByFolder;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Multiple folders documents request aborted');
            return new Map();
        }

        logger.error('Failed to load multiple folders documents', {
            folderIds,
            message: error.message,
        });
        return new Map();
    }
}

// Get root documents (no folder)
export async function getRootDocuments(): Promise<Document[]> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return [];
    }

    try {
        logger.debug('Fetching root documents');

        const result = await pb.collection('documents').getList<Document>(
            1,
            500,
            {
                filter: `author="${userId}" && folder=""`,
                sort: '-updated',
                requestKey: 'documents/root',
            }
        );

        logger.debug('Root documents fetched', { total: result.items.length });
        return result.items;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Root documents request aborted');
            return [];
        }

        logger.error('Failed to fetch root documents', {
            message: error.message,
        });
        return [];
    }
}

// Get recent documents (sorted by updated time)
export async function getRecentDocuments(limit: number = 5): Promise<Document[]> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return [];
    }

    try {
        logger.debug('Fetching recent documents', { limit });

        const result = await pb.collection('documents').getList<Document>(
            1,
            limit,
            {
                filter: `author="${userId}"`,
                sort: '-updated',
                requestKey: `documents/recent:${limit}`,
            }
        );

        logger.debug('Recent documents fetched', { total: result.items.length });
        return result.items;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Recent documents request aborted');
            return [];
        }

        logger.error('Failed to fetch recent documents', {
            message: error.message,
        });
        return [];
    }
}

// Get timeline documents in paginated chunks (separate from initial app data load)
export async function getTimelineDocumentsPage(
    page: number = 1,
    perPage: number = 50
): Promise<{ items: Document[]; page: number; perPage: number; totalItems: number; totalPages: number }> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return { items: [], page, perPage, totalItems: 0, totalPages: 0 };
    }

    try {
        logger.debug('Fetching timeline documents page', { page, perPage });

        const result = await pb.collection('documents').getList<Document>(
            page,
            perPage,
            {
                filter: `author="${userId}"`,
                sort: '-updated',
                requestKey: `documents/timeline:${page}:${perPage}`,
            }
        );

        return {
            items: result.items,
            page: result.page,
            perPage: result.perPage,
            totalItems: result.totalItems,
            totalPages: result.totalPages,
        };
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Timeline documents request aborted', { page });
            return { items: [], page, perPage, totalItems: 0, totalPages: 0 };
        }

        logger.error('Failed to fetch timeline documents page', {
            page,
            perPage,
            message: error.message,
        });
        return { items: [], page, perPage, totalItems: 0, totalPages: 0 };
    }
}

export async function getTimelineDocumentsByDateRange(options?: {
    startDate?: string;
    endDate?: string;
}): Promise<Document[]> {
    const userId = pb.authStore.record?.id;
    if (!userId) {
        return [];
    }

    const filters = [`author="${userId}"`];

    if (options?.startDate) {
        filters.push(`updated >= "${options.startDate} 00:00:00"`);
    }

    if (options?.endDate) {
        filters.push(`updated <= "${options.endDate} 23:59:59"`);
    }

    const filter = filters.join(' && ');

    try {
        logger.debug('Fetching timeline documents by date range', {
            startDate: options?.startDate,
            endDate: options?.endDate,
        });

        const pageSize = 200;
        let page = 1;
        let totalPages = 1;
        const allItems: Document[] = [];

        while (page <= totalPages) {
            const result = await pb.collection('documents').getList<Document>(
                page,
                pageSize,
                {
                    filter,
                    sort: '-updated',
                    requestKey: `documents/timeline-range:${options?.startDate || 'none'}:${options?.endDate || 'none'}:${page}`,
                }
            );

            allItems.push(...result.items);
            totalPages = result.totalPages;
            page += 1;
        }

        return allItems;
    } catch (error: any) {
        if (error.isAbort) {
            logger.debug('Timeline date range request aborted', {
                startDate: options?.startDate,
                endDate: options?.endDate,
            });
            return [];
        }

        logger.error('Failed to fetch timeline documents by date range', {
            startDate: options?.startDate,
            endDate: options?.endDate,
            message: error.message,
        });

        return [];
    }
}

// Get document statistics
export async function getDocumentStats(documentId: string) {
    const document = await getDocument(documentId);
    const versions = await pb.collection('document_versions').getList(
        1,
        1000,
        {
            filter: `document="${documentId}"`,
            sort: '-version_number',
        }
    );

    return {
        word_count: document.word_count,
        reading_time: document.reading_time,
        total_versions: versions.totalItems,
        created: document.created,
        updated: document.updated,
        tags_count: document.tags.length,
    };
}
