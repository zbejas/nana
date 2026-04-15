import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef } from 'react';
import {
    foldersAtom,
    rootDocumentsAtom,
    recentDocumentsAtom,
    trashDocumentsAtom,
    trashFoldersAtom,
    isDataLoadingAtom,
    refreshTriggerAtom,
    loadFolderDocumentsAtom,
} from '../atoms';
import { getAllFolders, listTrashFolders } from '../../lib/folders';
import { getRootDocuments, getRecentDocuments, listTrashDocuments } from '../../lib/documents';
import { useAuth } from '../../lib/auth';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DocData');
import { useRealtimeSubscriptions } from './useRealtimeSubscriptions';
import { useFolderLazyLoading } from './useFolderLazyLoading';
import { buildFolderTree } from '../../lib/folders/utils';

/**
 * Main hook for folder and document data management.
 * Orchestrates real-time subscriptions and lazy loading of folder documents.
 */
export function useDocumentData() {
    const { user } = useAuth();
    const folders = useAtomValue(foldersAtom);
    const trashFolders = useAtomValue(trashFoldersAtom);
    const setIsDataLoading = useSetAtom(isDataLoadingAtom);
    const refreshTrigger = useAtomValue(refreshTriggerAtom);
    const setFolders = useSetAtom(foldersAtom);
    const setTrashFolders = useSetAtom(trashFoldersAtom);
    const setRootDocuments = useSetAtom(rootDocumentsAtom);
    const setRecentDocuments = useSetAtom(recentDocumentsAtom);
    const setTrashDocuments = useSetAtom(trashDocumentsAtom);
    const setLoadFolderDocuments = useSetAtom(loadFolderDocumentsAtom);

    // Handle folder updates from real-time subscriptions
    const handleFoldersUpdate = (activeFolders: ReturnType<typeof buildFolderTree>, trashFolderTree: ReturnType<typeof buildFolderTree>) => {
        setFolders(activeFolders);
        setTrashFolders(trashFolderTree);
    };

    // Setup real-time subscriptions (runs once per user session)
    useRealtimeSubscriptions({
        userId: user?.id,
        onFoldersUpdate: handleFoldersUpdate,
    });

    // Setup lazy loading for folder documents
    const {
        loadFolderDocuments,
    } = useFolderLazyLoading({
        userId: user?.id,
        folders,
        trashFolders,
    });

    // Store loadFolderDocuments function in atom so Sidebar can access it
    useEffect(() => {
        setLoadFolderDocuments(() => loadFolderDocuments);
    }, [loadFolderDocuments, setLoadFolderDocuments]);

    // Manual refresh trigger
    const prevTrigger = useRef(0);
    const refreshEpochRef = useRef(0);
    useEffect(() => {
        if (user && refreshTrigger > 0 && refreshTrigger !== prevTrigger.current) {
            logger.debug('Manual refresh triggered', { count: refreshTrigger });
            prevTrigger.current = refreshTrigger;
            const epoch = ++refreshEpochRef.current;
            let isCancelled = false;
            const activeUserId = user.id;

            (async () => {
                setIsDataLoading(true);
                try {
                    // Load in priority order: recents → root → folders → trash

                    // 1. Load recent documents first
                    const recentDocsResult = await getRecentDocuments(5);
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    setRecentDocuments(recentDocsResult);

                    // 2. Load root documents
                    await new Promise(resolve => setTimeout(resolve, 50));
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    const rootDocsResult = await getRootDocuments();
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    setRootDocuments(rootDocsResult);

                    // 3. Load folders
                    const foldersResult = await getAllFolders();
                    const trashFoldersResult = await listTrashFolders();
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    const activeFolders = buildFolderTree(
                        foldersResult.filter((folder) => folder.author === activeUserId)
                    );
                    handleFoldersUpdate(activeFolders, trashFoldersResult);

                    // 4. Load trash documents
                    await new Promise(resolve => setTimeout(resolve, 50));
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    const trashDocsResult = await listTrashDocuments();
                    if (isCancelled || epoch !== refreshEpochRef.current) return;
                    setTrashDocuments(trashDocsResult.items);
                } catch (error: any) {
                    if (!isCancelled && !error.isAbort) {
                        logger.error('Failed to refresh data', { error: error.message });
                    }
                } finally {
                    if (!isCancelled && epoch === refreshEpochRef.current) {
                        setIsDataLoading(false);
                    }
                }
            })();

            return () => {
                isCancelled = true;
            };
        }

        return;
    }, [refreshTrigger, user, setIsDataLoading, setRootDocuments, setRecentDocuments, setTrashDocuments]);

    return;
}
