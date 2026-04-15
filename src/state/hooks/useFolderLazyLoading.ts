import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    folderDocumentsAtom,
    trashDocumentsAtom,
    expandedFoldersAtom,
    expandedTrashFoldersAtom,
    initialLoadDoneAtom,
    loadedFoldersAtom,
    loadedTrashFoldersAtom,
    loadingFoldersAtom,
    loadingTrashFoldersAtom,
} from '../atoms';
import {
    loadFolderDocuments as fetchFolderDocuments,
    loadMultipleFoldersDocuments,
    type Document,
} from '../../lib/documents';
import { createLogger } from '../../lib/logger';

const logger = createLogger('LazyLoad');
import { getAllFolderIds } from './organizers';
import { buildFolderTree } from './helpers';

interface UseFolderLazyLoadingOptions {
    userId: string | undefined;
    folders: ReturnType<typeof buildFolderTree>;
    trashFolders: ReturnType<typeof buildFolderTree>;
}

/**
 * Handles lazy loading of folder documents when folders are expanded.
 * Also auto-loads documents for folders that were expanded on previous sessions.
 */
export function useFolderLazyLoading({
    userId,
    folders,
    trashFolders,
}: UseFolderLazyLoadingOptions) {
    const [expandedFolders, setExpandedFolders] = useAtom(expandedFoldersAtom);
    const [expandedTrashFolders, setExpandedTrashFolders] = useAtom(expandedTrashFoldersAtom);
    const initialLoadDone = useAtomValue(initialLoadDoneAtom);
    const [loadedFolders, setLoadedFolders] = useAtom(loadedFoldersAtom);
    const [loadedTrashFolders, setLoadedTrashFolders] = useAtom(loadedTrashFoldersAtom);
    const [loadingFolders, setLoadingFolders] = useAtom(loadingFoldersAtom);
    const [loadingTrashFolders, setLoadingTrashFolders] = useAtom(loadingTrashFoldersAtom);
    const setFolderDocuments = useSetAtom(folderDocumentsAtom);
    const setTrashDocuments = useSetAtom(trashDocumentsAtom);

    // Use refs for current state to avoid recreating callback when sets change
    const loadedFoldersRef = useRef(loadedFolders);
    const loadedTrashFoldersRef = useRef(loadedTrashFolders);
    const loadingFoldersRef = useRef(loadingFolders);
    const loadingTrashFoldersRef = useRef(loadingTrashFolders);

    useEffect(() => {
        loadedFoldersRef.current = loadedFolders;
    }, [loadedFolders]);

    useEffect(() => {
        loadedTrashFoldersRef.current = loadedTrashFolders;
    }, [loadedTrashFolders]);

    useEffect(() => {
        loadingFoldersRef.current = loadingFolders;
    }, [loadingFolders]);

    useEffect(() => {
        loadingTrashFoldersRef.current = loadingTrashFolders;
    }, [loadingTrashFolders]);

    /**
     * Loads documents for a specific folder
     */
    const loadFolderDocuments = useCallback(
        async (folderId: string, isTrash: boolean = false) => {
            const loadedSet = isTrash ? loadedTrashFoldersRef.current : loadedFoldersRef.current;
            const loadingSet = isTrash ? loadingTrashFoldersRef.current : loadingFoldersRef.current;
            const setLoadedSet = isTrash ? setLoadedTrashFolders : setLoadedFolders;
            const setLoadingSet = isTrash ? setLoadingTrashFolders : setLoadingFolders;

            // Skip if already loaded or currently loading
            if (loadedSet.has(folderId) || loadingSet.has(folderId)) {
                return;
            }

            // Mark as loading
            setLoadingSet((prev: Set<string>) => new Set([...prev, folderId]));

            // Track loading start time for minimum display duration
            const loadStartTime = Date.now();
            const MIN_LOADING_DISPLAY_MS = 200; // Show spinner for at least 200ms

            try {
                logger.debug('Lazy loading folder documents', { folderId, isTrash });
                const docs = await fetchFolderDocuments(folderId, { includeTrash: isTrash });

                if (isTrash) {
                    // Update trash documents
                    setTrashDocuments((prev: Document[]) => {
                        // Remove any existing docs from this folder, then add new ones
                        const filtered = prev.filter(d => d.folder !== folderId);
                        return [...filtered, ...docs].sort(
                            (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                        );
                    });
                } else {
                    // Update folder documents
                    setFolderDocuments((prev: Map<string, Document[]>) => {
                        const newMap = new Map(prev);
                        newMap.set(
                            folderId,
                            docs.sort(
                                (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                            )
                        );
                        return newMap;
                    });
                }

                // Mark as loaded
                setLoadedSet((prev: Set<string>) => new Set([...prev, folderId]));
                logger.debug('Folder documents loaded', { folderId, count: docs.length, isTrash });
            } catch (error: any) {
                logger.error('Failed to load folder documents', { folderId, error: error.message });
            } finally {
                // Ensure loading spinner shows for minimum duration for better UX
                const loadDuration = Date.now() - loadStartTime;
                const remainingTime = MIN_LOADING_DISPLAY_MS - loadDuration;

                if (remainingTime > 0) {
                    await new Promise(resolve => setTimeout(resolve, remainingTime));
                }

                // Remove from loading set
                setLoadingSet((prev: Set<string>) => {
                    const newSet = new Set(prev);
                    newSet.delete(folderId);
                    return newSet;
                });
            }
        },
        [
            setLoadedFolders,
            setLoadedTrashFolders,
            setLoadingFolders,
            setLoadingTrashFolders,
            setFolderDocuments,
            setTrashDocuments,
        ]
    );

    // Auto-load documents for expanded folders on page load
    const hasAutoLoadedRef = useRef(false);

    useEffect(() => {
        // Only run once after initial load completes
        if (!initialLoadDone || hasAutoLoadedRef.current || !userId) {
            return;
        }

        // Set flag IMMEDIATELY to prevent concurrent runs
        hasAutoLoadedRef.current = true;

        // Get all valid folder IDs from current state
        const validFolderIds = getAllFolderIds(folders);
        const validTrashFolderIds = getAllFolderIds(trashFolders);

        // Only proceed if we actually have folders loaded
        // (avoid clearing expanded state if folders haven't loaded yet)
        const hasFolders = validFolderIds.size > 0 || validTrashFolderIds.size > 0;
        if (!hasFolders && expandedFolders.size > 0) {
            logger.debug('Skipping auto-load - folders not yet loaded');
            hasAutoLoadedRef.current = false; // Reset so we try again when folders load
            return;
        }

        // Filter expanded folders to only include folders that exist
        const foldersToLoad = Array.from(expandedFolders).filter(id => validFolderIds.has(id));
        const trashFoldersToLoad = Array.from(expandedTrashFolders).filter(id =>
            validTrashFolderIds.has(id)
        );

        // Clean up localStorage by removing stale folder IDs
        // Only clean up if we have folders to validate against
        if (hasFolders && foldersToLoad.length < expandedFolders.size) {
            logger.debug('Cleaning up stale expanded folders from localStorage', {
                before: expandedFolders.size,
                after: foldersToLoad.length,
                removed: expandedFolders.size - foldersToLoad.length,
            });
            setExpandedFolders(new Set(foldersToLoad));
        }
        if (hasFolders && trashFoldersToLoad.length < expandedTrashFolders.size) {
            logger.debug('Cleaning up stale expanded trash folders from localStorage', {
                before: expandedTrashFolders.size,
                after: trashFoldersToLoad.length,
                removed: expandedTrashFolders.size - trashFoldersToLoad.length,
            });
            setExpandedTrashFolders(new Set(trashFoldersToLoad));
        }

        // Load documents for all valid expanded folders
        if (foldersToLoad.length === 0 && trashFoldersToLoad.length === 0) {
            return;
        }

        logger.debug('Auto-loading documents for expanded folders on page load', {
            expandedCount: foldersToLoad.length,
            expandedTrashCount: trashFoldersToLoad.length,
            folderIds: foldersToLoad,
            trashFolderIds: trashFoldersToLoad,
        });

        // Load all expanded folders in a SINGLE batched request per category
        (async () => {
            try {
                // Load active folders documents (all in one request)
                if (foldersToLoad.length > 0) {
                    const docsByFolder = await loadMultipleFoldersDocuments(foldersToLoad, {
                        includeTrash: false,
                    });

                    // Update state with all loaded documents at once
                    setFolderDocuments((prev: Map<string, Document[]>) => {
                        const newMap = new Map(prev);
                        for (const [folderId, docs] of docsByFolder.entries()) {
                            newMap.set(
                                folderId,
                                docs.sort(
                                    (a, b) =>
                                        new Date(b.updated).getTime() - new Date(a.updated).getTime()
                                )
                            );
                        }
                        return newMap;
                    });

                    // Mark all as loaded
                    setLoadedFolders((prev: Set<string>) => new Set([...prev, ...foldersToLoad]));
                }

                // Load trash folders documents (all in one request)
                if (trashFoldersToLoad.length > 0) {
                    const docsByFolder = await loadMultipleFoldersDocuments(trashFoldersToLoad, {
                        includeTrash: true,
                    });

                    // Update trash documents (flatten all docs from all trash folders)
                    setTrashDocuments((prev: Document[]) => {
                        const allTrashDocs = Array.from(docsByFolder.values()).flat();
                        // Remove any existing docs from these folders, then add new ones
                        const filtered = prev.filter(
                            d => !trashFoldersToLoad.includes(d.folder || '')
                        );
                        return [...filtered, ...allTrashDocs].sort(
                            (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
                        );
                    });

                    // Mark all as loaded
                    setLoadedTrashFolders((prev: Set<string>) =>
                        new Set([...prev, ...trashFoldersToLoad])
                    );
                }

                logger.debug('Auto-load of expanded folders completed');
            } catch (error: any) {
                logger.error('Failed to auto-load folders', { error: error.message });
            }
        })();
    }, [
        initialLoadDone,
        userId,
        expandedFolders,
        expandedTrashFolders,
        folders,
        trashFolders,
        setExpandedFolders,
        setExpandedTrashFolders,
        setFolderDocuments,
        setTrashDocuments,
        setLoadedFolders,
        setLoadedTrashFolders,
    ]);

    return {
        loadFolderDocuments,
        loadedFolders,
        loadedTrashFolders,
        loadingFolders,
        loadingTrashFolders,
    };
}
