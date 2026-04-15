import { useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import {
    rootDocumentsAtom,
    folderDocumentsAtom,
    recentDocumentsAtom,
    trashDocumentsAtom,
    isDataLoadingAtom,
    initialLoadDoneAtom,
    timelineRealtimeTickAtom,
} from '../atoms';
import { getAllFolders, listTrashFolders } from '../../lib/folders';
import { getRootDocuments, getRecentDocuments, listTrashDocuments, type Document } from '../../lib/documents';
import { pb } from '../../lib/pocketbase';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Realtime');
import { buildFolderTree } from '../../lib/folders/utils';

interface UseRealtimeSubscriptionsOptions {
    userId: string | undefined;
    onFoldersUpdate: (
        activeFolders: ReturnType<typeof buildFolderTree>,
        trashFolders: ReturnType<typeof buildFolderTree>
    ) => void;
}

/**
 * Manages real-time PocketBase subscriptions for documents and folders.
 * Sets up subscriptions once per user session and handles incremental updates.
 */
export function useRealtimeSubscriptions({
    userId,
    onFoldersUpdate,
}: UseRealtimeSubscriptionsOptions) {
    const setRootDocuments = useSetAtom(rootDocumentsAtom);
    const setFolderDocuments = useSetAtom(folderDocumentsAtom);
    const setRecentDocuments = useSetAtom(recentDocumentsAtom);
    const setTrashDocuments = useSetAtom(trashDocumentsAtom);
    const setIsDataLoading = useSetAtom(isDataLoadingAtom);
    const setInitialLoadDone = useSetAtom(initialLoadDoneAtom);
    const setTimelineRealtimeTick = useSetAtom(timelineRealtimeTickAtom);

    const userIdRef = useRef<string | null>(null);
    const isSettingUpRef = useRef<boolean>(false);
    const onFoldersUpdateRef = useRef(onFoldersUpdate);

    useEffect(() => {
        onFoldersUpdateRef.current = onFoldersUpdate;
    }, [onFoldersUpdate]);

    useEffect(() => {
        if (!userId) {
            // User logged out - clean up everything
            if (userIdRef.current) {
                logger.debug('User logged out, cleaning up subscriptions');
                pb.collection('documents').unsubscribe();
                pb.collection('folders').unsubscribe();
                pb.collection('trash_documents').unsubscribe();
                pb.collection('trash_folders').unsubscribe();
                userIdRef.current = null;
                isSettingUpRef.current = false;
                setInitialLoadDone(false);
            }
            return;
        }

        // Skip if already initialized for this user OR currently setting up
        if (userIdRef.current === userId || isSettingUpRef.current) {
            return;
        }

        // Set both guards IMMEDIATELY before any async operations
        userIdRef.current = userId;
        isSettingUpRef.current = true;

        logger.info('Setting up real-time subscriptions', { userId });
        setIsDataLoading(true);
        setInitialLoadDone(false); // Reset to ensure auto-load doesn't run prematurely

        // Function to fetch and organize all data
        const loadAllData = async () => {
            try {
                // Load in priority order: recents → root → folders → trash

                // 1. Load recent documents first (most frequently accessed)
                const recentDocsResult = await getRecentDocuments(5);
                setRecentDocuments(recentDocsResult);

                // 2. Load root documents
                await new Promise(resolve => setTimeout(resolve, 50));
                const rootDocsResult = await getRootDocuments();
                setRootDocuments(rootDocsResult);

                // 3. Load folders (separate collection, needed for folder auto-load)
                const foldersResult = await getAllFolders();
                const trashFoldersResult = await listTrashFolders();
                const activeFolderTree = buildFolderTree(
                    foldersResult.filter((folder) => folder.author === userId)
                );
                onFoldersUpdateRef.current(activeFolderTree, trashFoldersResult);

                // 4. Load trash documents last (least frequently accessed)
                await new Promise(resolve => setTimeout(resolve, 50));
                const trashDocsResult = await listTrashDocuments();
                setTrashDocuments(trashDocsResult.items);

                logger.debug('Initial data loaded via subscriptions', {
                    recentDocuments: recentDocsResult.length,
                    rootDocuments: rootDocsResult.length,
                    folders: foldersResult.length,
                    trashDocuments: trashDocsResult.items.length,
                });
            } catch (error: any) {
                if (!error.isAbort) {
                    logger.error('Failed to load initial data', { error: error.message });
                }
            } finally {
                setIsDataLoading(false);
                setInitialLoadDone(true);
            }
        };

        // Helper to update document in state incrementally
        const updateDocumentInState = (updatedDoc: Document) => {
            setRootDocuments((prev: Document[]) => {
                const filtered = prev.filter(d => d.id !== updatedDoc.id);
                // Add if belongs in root (active, owned, no folder)
                if (updatedDoc.author === userId && !updatedDoc.folder) {
                    return [...filtered, updatedDoc].sort(
                        (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                    );
                }
                return filtered;
            });

            // Only update folderDocuments if the folder has been loaded (lazy loading)
            setFolderDocuments((prev: Map<string, Document[]>) => {
                const newMap = new Map(prev);

                // Remove from all folders that are already loaded
                for (const [folderId, docs] of newMap.entries()) {
                    const filtered = docs.filter(d => d.id !== updatedDoc.id);
                    if (filtered.length !== docs.length) {
                        newMap.set(folderId, filtered);
                    }
                }

                // Only add if:
                // 1. Document belongs in a folder (active, owned, has folder)
                // 2. That folder has already been loaded
                if (
                    updatedDoc.author === userId &&
                    updatedDoc.folder &&
                    newMap.has(updatedDoc.folder)
                ) {
                    const folderDocs = newMap.get(updatedDoc.folder) || [];
                    newMap.set(
                        updatedDoc.folder,
                        [...folderDocs, updatedDoc].sort(
                            (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                        )
                    );
                }

                return newMap;
            });

            // Update recent documents (top 5 active, owned documents by updated time)
            setRecentDocuments((prev: Document[]) => {
                const filtered = prev.filter(d => d.id !== updatedDoc.id);
                // Add if active and owned (regardless of folder)
                if (updatedDoc.author === userId) {
                    return [...filtered, updatedDoc]
                        .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
                        .slice(0, 5); // Keep only top 5
                }
                return filtered.slice(0, 5); // Ensure we don't have more than 5
            });
        };

        // Setup subscriptions and load initial data
        const setupSubscriptions = async () => {
            try {
                // Subscribe to documents collection for incremental real-time updates
                await pb.collection('documents').subscribe('*', async (e) => {
                    logger.debug('Real-time document event', { action: e.action, id: e.record.id });

                    const updatedDoc = e.record as Document;

                    if (e.action === 'create' || e.action === 'update') {
                        updateDocumentInState(updatedDoc);
                    } else if (e.action === 'delete') {
                        // Remove from all categories
                        setRootDocuments((prev: Document[]) => prev.filter(d => d.id !== updatedDoc.id));
                        setFolderDocuments((prev: Map<string, Document[]>) => {
                            const newMap = new Map(prev);
                            for (const [folderId, docs] of newMap.entries()) {
                                newMap.set(folderId, docs.filter(d => d.id !== updatedDoc.id));
                            }
                            return newMap;
                        });
                        setTrashDocuments((prev: Document[]) => prev.filter(d => d.id !== updatedDoc.id));
                        setRecentDocuments((prev: Document[]) => prev.filter(d => d.id !== updatedDoc.id));
                    }

                    setTimelineRealtimeTick((prev: number) => prev + 1);
                });

                await pb.collection('trash_documents').subscribe('*', async (e) => {
                    const updatedTrashDoc = e.record as Document;

                    if (e.action === 'create' || e.action === 'update') {
                        setTrashDocuments((prev: Document[]) => {
                            const filtered = prev.filter((doc) => doc.id !== updatedTrashDoc.id);
                            if (updatedTrashDoc.author !== userId) {
                                return filtered;
                            }
                            return [...filtered, updatedTrashDoc].sort(
                                (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                            );
                        });
                    } else if (e.action === 'delete') {
                        setTrashDocuments((prev: Document[]) =>
                            prev.filter((doc) => doc.id !== updatedTrashDoc.id)
                        );
                    }
                    setTimelineRealtimeTick((prev: number) => prev + 1);
                });

                // Subscribe to folders collection for real-time updates (keep full refetch for folders - they're small)
                await pb.collection('folders').subscribe('*', async (e) => {
                    logger.debug('Real-time folder event', { action: e.action, id: e.record.id });
                    try {
                        const allFolders = await getAllFolders();
                        const trashFolders = await listTrashFolders();
                        const activeFolderTree = buildFolderTree(
                            allFolders.filter((folder) => folder.author === userId)
                        );
                        onFoldersUpdateRef.current(activeFolderTree, trashFolders);
                    } catch (error: any) {
                        if (!error.isAbort) {
                            logger.error('Failed to reload folders after real-time event', {
                                error: error.message,
                            });
                        }
                    }
                });

                await pb.collection('trash_folders').subscribe('*', async () => {
                    try {
                        const allFolders = await getAllFolders();
                        const trashFolders = await listTrashFolders();
                        const activeFolderTree = buildFolderTree(
                            allFolders.filter((folder) => folder.author === userId)
                        );
                        onFoldersUpdateRef.current(activeFolderTree, trashFolders);
                    } catch (error: any) {
                        if (!error.isAbort) {
                            logger.error('Failed to reload trash folders after real-time event', {
                                error: error.message,
                            });
                        }
                    }
                });

                logger.debug('Real-time subscriptions established');

                // Load initial data after subscriptions are ready
                await loadAllData();
            } finally {
                isSettingUpRef.current = false;
            }
        };

        setupSubscriptions().catch((error: any) => {
            if (!error?.isAbort) {
                logger.error('Failed to setup real-time subscriptions', {
                    userId,
                    error: error?.message ?? String(error),
                });
            }

            pb.collection('documents').unsubscribe();
            pb.collection('folders').unsubscribe();
            pb.collection('trash_documents').unsubscribe();
            pb.collection('trash_folders').unsubscribe();

            if (userIdRef.current === userId) {
                userIdRef.current = null;
            }

            setIsDataLoading(false);
            setInitialLoadDone(false);
        });

        // No cleanup - subscriptions persist across navigation
        // They're only cleaned up when user logs out (handled above)
    }, [userId]); // Minimal dependencies to prevent re-runs
}
