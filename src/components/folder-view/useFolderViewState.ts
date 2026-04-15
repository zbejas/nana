import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    foldersAtom,
    trashFoldersAtom,
    trashDocumentsAtom,
    rootDocumentsAtom,
    folderDocumentsAtom,
    isDataLoadingAtom,
    refreshTriggerAtom,
    loadedFoldersAtom,
    loadedTrashFoldersAtom,
    loadingFoldersAtom,
    loadingTrashFoldersAtom,
    loadFolderDocumentsAtom,
    selectDocumentAtom,
    startNewDocumentAtom,
} from '../../state/atoms';
import { createFolder, updateFolder, deleteFolder } from '../../lib/folders';
import {
    deleteDocument,
    permanentlyDeleteDocument,
    restoreDocument,
    updateDocument,
} from '../../lib/documents';
import { permanentlyDeleteFolder, restoreFolder } from '../../lib/folders';
import { exportDocument, exportFolder, exportSelectionAsZip } from '../../lib/export';
import { useFileFolderDnD, useContextMenuState } from '../file-folder-handling';
import { useToasts } from '../../state/hooks';
import type { FolderTreeNode } from '../../lib/folders';
import type { Document } from '../../lib/documents';
import type { PendingCreate, PendingRename, ViewMode } from './types';
import type React from 'react';
import { createLogger } from '../../lib/logger';

const log = createLogger('FolderView');

type DeleteConfirmState = {
    folderIds: string[];
    documentIds: string[];
    title: string;
    message: string;
    isPermanent?: boolean;
};

const FOLDER_VIEW_MODE_STORAGE_KEY = 'nana-folder-view-mode';

function getInitialFolderViewMode(): ViewMode {
    if (typeof window === 'undefined') {
        return 'list';
    }

    try {
        const stored = localStorage.getItem(FOLDER_VIEW_MODE_STORAGE_KEY);
        if (stored === 'list' || stored === 'icon') {
            return stored;
        }
    } catch (error) {
        log.error('Failed to read folder view mode from localStorage', error);
    }

    return 'list';
}

function findFolderById(nodes: FolderTreeNode[], folderId: string): FolderTreeNode | null {
    for (const node of nodes) {
        if (node.id === folderId) {
            return node;
        }

        const child = findFolderById(node.subfolders, folderId);
        if (child) {
            return child;
        }
    }

    return null;
}

function findPathToFolder(nodes: FolderTreeNode[], folderId: string): FolderTreeNode[] {
    for (const node of nodes) {
        if (node.id === folderId) {
            return [node];
        }

        const childPath = findPathToFolder(node.subfolders, folderId);
        if (childPath.length > 0) {
            return [node, ...childPath];
        }
    }

    return [];
}

export function useFolderViewState() {
    const navigate = useNavigate();
    const location = useLocation();
    const { folderId: routeFolderId, trashFolderId } = useParams<{ folderId?: string; trashFolderId?: string }>();
    const isTrashMode = location.pathname.startsWith('/folders/trash');
    const folders = useAtomValue(foldersAtom);
    const trashFolders = useAtomValue(trashFoldersAtom);
    const trashDocuments = useAtomValue(trashDocumentsAtom);
    const rootDocuments = useAtomValue(rootDocumentsAtom);
    const folderDocuments = useAtomValue(folderDocumentsAtom);
    const isDataLoading = useAtomValue(isDataLoadingAtom);
    const loadedFolders = useAtomValue(loadedFoldersAtom);
    const loadedTrashFolders = useAtomValue(loadedTrashFoldersAtom);
    const loadingFolders = useAtomValue(loadingFoldersAtom);
    const loadingTrashFolders = useAtomValue(loadingTrashFoldersAtom);
    const loadFolderDocuments = useAtomValue(loadFolderDocumentsAtom);
    const selectDocument = useSetAtom(selectDocumentAtom);
    const startNewDocument = useSetAtom(startNewDocumentAtom);
    const setRefreshTrigger = useSetAtom(refreshTriggerAtom);
    const { showToast } = useToasts();

    const [currentFolderId, setCurrentFolderId] = useState<string | null>(
        isTrashMode ? (trashFolderId || null) : (routeFolderId || null)
    );
    const [viewMode, setViewMode] = useState<ViewMode>(getInitialFolderViewMode());
    const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
    const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
    const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
    const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
    const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
    const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);

    const { contextMenu, isClosingContextMenu, setContextMenu, contextMenuRef, handleContextMenu, closeContextMenu } = useContextMenuState();
    const {
        dropZone,
        handleDragStart,
        handleDragEnd,
        handleFolderDragStart,
        handleFolderDragEnd,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    } = useFileFolderDnD();

    const activeTree = isTrashMode ? trashFolders : folders;
    const loadedSet = isTrashMode ? loadedTrashFolders : loadedFolders;
    const loadingSet = isTrashMode ? loadingTrashFolders : loadingFolders;

    const currentFolder = useMemo(() => {
        if (!currentFolderId) return null;
        return findFolderById(activeTree, currentFolderId);
    }, [activeTree, currentFolderId]);

    const breadcrumbPath = useMemo(() => {
        if (!currentFolderId) return [];
        return findPathToFolder(activeTree, currentFolderId);
    }, [activeTree, currentFolderId]);

    const routeFolderKey = isTrashMode ? trashFolderId : routeFolderId;

    const isRouteFolderPending = Boolean(routeFolderKey) && (
        isDataLoading || (currentFolderId === routeFolderKey && !currentFolder)
    );

    const displayedFolders = isRouteFolderPending
        ? []
        : currentFolder
            ? currentFolder.subfolders
            : activeTree;

    useEffect(() => {
        try {
            localStorage.setItem(FOLDER_VIEW_MODE_STORAGE_KEY, viewMode);
        } catch (error) {
            log.error('Failed to save folder view mode to localStorage', error);
        }
    }, [viewMode]);

    const displayedDocuments = useMemo<Document[]>(() => {
        if (isRouteFolderPending) {
            return [];
        }

        if (isTrashMode) {
            if (!currentFolderId) {
                const allTrashFolderIds = new Set<string>();
                const collectIds = (nodes: FolderTreeNode[]) => {
                    for (const node of nodes) {
                        allTrashFolderIds.add(node.id);
                        if (node.subfolders.length > 0) {
                            collectIds(node.subfolders);
                        }
                    }
                };
                collectIds(trashFolders);

                return trashDocuments.filter((doc) => !doc.folder || !allTrashFolderIds.has(doc.folder));
            }

            return trashDocuments.filter((doc) => doc.folder === currentFolderId);
        }

        if (!currentFolderId) {
            return rootDocuments;
        }

        return folderDocuments.get(currentFolderId) || [];
    }, [
        isRouteFolderPending,
        isTrashMode,
        currentFolderId,
        rootDocuments,
        folderDocuments,
        trashDocuments,
        trashFolders,
    ]);

    const isLoadingCurrentFolder = isRouteFolderPending || (currentFolderId ? loadingSet.has(currentFolderId) : false);

    const orderedSelectionKeys = useMemo(() => {
        const folderKeys = displayedFolders.map((folder) => `folder:${folder.id}`);
        const documentKeys = displayedDocuments.map((document) => `document:${document.id}`);
        return [...folderKeys, ...documentKeys];
    }, [displayedFolders, displayedDocuments]);

    const applySelectionKeys = (keys: string[]) => {
        const nextFolderIds: string[] = [];
        const nextDocumentIds: string[] = [];

        keys.forEach((key) => {
            if (key.startsWith('folder:')) {
                nextFolderIds.push(key.slice('folder:'.length));
                return;
            }

            if (key.startsWith('document:')) {
                nextDocumentIds.push(key.slice('document:'.length));
            }
        });

        setSelectedFolderIds(nextFolderIds);
        setSelectedDocumentIds(nextDocumentIds);
    };

    useEffect(() => {
        setSelectedFolderIds([]);
        setSelectedDocumentIds([]);
        setSelectionAnchorKey(null);
        setPendingRename(null);
    }, [currentFolderId]);

    useEffect(() => {
        const handleResize = () => setIsDesktop(window.innerWidth >= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (!isDesktop) {
            setSelectedFolderIds([]);
            setSelectedDocumentIds([]);
            setSelectionAnchorKey(null);
        }
    }, [isDesktop]);

    useEffect(() => {
        if (!routeFolderKey) {
            setCurrentFolderId(null);
            return;
        }

        setCurrentFolderId((previous) => (previous === routeFolderKey ? previous : routeFolderKey));

        if (isDataLoading) {
            return;
        }

        const routeFolder = findFolderById(activeTree, routeFolderKey);
        if (!routeFolder) {
            navigate(isTrashMode ? '/folders/trash' : '/folders', { replace: true });
            return;
        }

        setCurrentFolderId(routeFolderKey);

        if (!loadedSet.has(routeFolderKey) && loadFolderDocuments) {
            void loadFolderDocuments(routeFolderKey, isTrashMode);
        }
    }, [
        routeFolderKey,
        isDataLoading,
        activeTree,
        loadedSet,
        loadFolderDocuments,
        isTrashMode,
        navigate,
    ]);

    const handleFolderOpen = async (folderId: string) => {
        navigate(isTrashMode ? `/folders/trash/${folderId}` : `/folders/${folderId}`);

        if (!loadedSet.has(folderId) && loadFolderDocuments) {
            await loadFolderDocuments(folderId, isTrashMode);
        }
    };

    const handleDocumentOpen = (document: Document) => {
        selectDocument(document);
        navigate(isTrashMode ? `/document/${document.id}?trash=true` : `/document/${document.id}`);
    };

    const toggleFolderSelection = (folderId: string) => {
        setSelectedFolderIds((previous) =>
            previous.includes(folderId)
                ? previous.filter((id) => id !== folderId)
                : [...previous, folderId]
        );
    };

    const toggleDocumentSelection = (documentId: string) => {
        setSelectedDocumentIds((previous) =>
            previous.includes(documentId)
                ? previous.filter((id) => id !== documentId)
                : [...previous, documentId]
        );
    };

    const selectRangeToKey = (targetKey: string) => {
        const anchorKey = selectionAnchorKey;
        if (!anchorKey) {
            applySelectionKeys([targetKey]);
            return;
        }

        const anchorIndex = orderedSelectionKeys.indexOf(anchorKey);
        const targetIndex = orderedSelectionKeys.indexOf(targetKey);

        if (anchorIndex === -1 || targetIndex === -1) {
            applySelectionKeys([targetKey]);
            return;
        }

        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        applySelectionKeys(orderedSelectionKeys.slice(start, end + 1));
    };

    const handleFolderClick = (event: React.MouseEvent, folderId: string) => {
        if (!isDesktop) {
            void handleFolderOpen(folderId);
            return;
        }

        if (event.detail !== 1) {
            return;
        }

        const folderKey = `folder:${folderId}`;

        if (event.shiftKey) {
            selectRangeToKey(folderKey);
            setSelectionAnchorKey(folderKey);
            return;
        }

        if (event.metaKey || event.ctrlKey) {
            toggleFolderSelection(folderId);
            setSelectionAnchorKey(folderKey);
            return;
        }

        setSelectedFolderIds([folderId]);
        setSelectedDocumentIds([]);
        setSelectionAnchorKey(folderKey);
    };

    const handleFolderDoubleClick = (folderId: string) => {
        void handleFolderOpen(folderId);
    };

    const handleDocumentClick = (event: React.MouseEvent, document: Document) => {
        if (!isDesktop) {
            handleDocumentOpen(document);
            return;
        }

        if (event.detail !== 1) {
            return;
        }

        const documentKey = `document:${document.id}`;

        if (event.shiftKey) {
            selectRangeToKey(documentKey);
            setSelectionAnchorKey(documentKey);
            return;
        }

        if (event.metaKey || event.ctrlKey) {
            toggleDocumentSelection(document.id);
            setSelectionAnchorKey(documentKey);
            return;
        }

        setSelectedDocumentIds([document.id]);
        setSelectedFolderIds([]);
        setSelectionAnchorKey(documentKey);
    };

    const handleDocumentDoubleClick = (document: Document) => {
        handleDocumentOpen(document);
    };

    const selectedItemCount = selectedFolderIds.length + selectedDocumentIds.length;
    const hasSelection = selectedItemCount > 0;

    const clearSelection = () => {
        setSelectedFolderIds([]);
        setSelectedDocumentIds([]);
        setSelectionAnchorKey(null);
    };

    const handleSelectAll = () => {
        if (!isDesktop) {
            return;
        }

        if (!hasSelection) {
            return;
        }

        setSelectedFolderIds(displayedFolders.map((folder) => folder.id));
        setSelectedDocumentIds(displayedDocuments.map((document) => document.id));
        if (orderedSelectionKeys.length > 0) {
            setSelectionAnchorKey(orderedSelectionKeys[0] ?? null);
        }
    };

    useEffect(() => {
        if (!isDesktop) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
                return;
            }

            const activeElement = document.activeElement as HTMLElement | null;
            if (
                activeElement?.tagName === 'INPUT' ||
                activeElement?.tagName === 'TEXTAREA' ||
                activeElement?.isContentEditable
            ) {
                return;
            }

            event.preventDefault();
            setSelectedFolderIds(displayedFolders.map((folder) => folder.id));
            setSelectedDocumentIds(displayedDocuments.map((document) => document.id));
            if (orderedSelectionKeys.length > 0) {
                setSelectionAnchorKey(orderedSelectionKeys[0] ?? null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDesktop, displayedFolders, displayedDocuments, orderedSelectionKeys]);

    useEffect(() => {
        if (!isDesktop) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const activeElement = document.activeElement as HTMLElement | null;
            if (
                activeElement?.tagName === 'INPUT' ||
                activeElement?.tagName === 'TEXTAREA' ||
                activeElement?.isContentEditable
            ) {
                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (!hasSelection) {
                    return;
                }

                event.preventDefault();

                const folderIds = [...selectedFolderIds];
                const documentIds = [...selectedDocumentIds];
                const totalItems = folderIds.length + documentIds.length;

                if (totalItems === 0) {
                    return;
                }

                if (isTrashMode) {
                    const title = totalItems > 1
                        ? `Permanently delete ${totalItems} items`
                        : folderIds.length === 1
                            ? 'Permanently delete'
                            : 'Permanently delete';
                    const message = totalItems > 1
                        ? `Permanently delete ${totalItems} selected items? This cannot be undone.`
                        : folderIds.length === 1
                            ? `Permanently delete folder "${displayedFolders.find((f) => f.id === folderIds[0])?.name || 'Untitled'}"? This cannot be undone.`
                            : `Permanently delete "${displayedDocuments.find((d) => d.id === documentIds[0])?.title || 'Untitled'}"? This cannot be undone.`;

                    setDeleteConfirmState({
                        folderIds,
                        documentIds,
                        title,
                        message,
                        isPermanent: true,
                    });
                } else {
                    const title = totalItems > 1
                        ? `Delete ${totalItems} items`
                        : folderIds.length === 1
                            ? 'Delete folder'
                            : 'Delete document';
                    const message = totalItems > 1
                        ? `Move ${totalItems} selected items to trash?`
                        : folderIds.length === 1
                            ? `Delete folder "${displayedFolders.find((f) => f.id === folderIds[0])?.name || 'Untitled'}"?`
                            : `Move "${displayedDocuments.find((d) => d.id === documentIds[0])?.title || 'Untitled'}" to trash?`;

                    setDeleteConfirmState({
                        folderIds,
                        documentIds,
                        title,
                        message,
                    });
                }

                return;
            }

            if (event.key === 'Enter') {
                if (selectedFolderIds.length === 1 && selectedDocumentIds.length === 0) {
                    event.preventDefault();
                    void handleFolderOpen(selectedFolderIds[0]!);
                    return;
                }

                if (selectedDocumentIds.length === 1 && selectedFolderIds.length === 0) {
                    event.preventDefault();
                    const targetDocument = displayedDocuments.find((d) => d.id === selectedDocumentIds[0]);
                    if (targetDocument) {
                        handleDocumentOpen(targetDocument);
                    }
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        isDesktop,
        hasSelection,
        selectedFolderIds,
        selectedDocumentIds,
        displayedFolders,
        displayedDocuments,
        isTrashMode,
    ]);

    const handleNavigateUp = () => {
        if (!currentFolderId) return;

        if (breadcrumbPath.length <= 1) {
            navigate(isTrashMode ? '/folders/trash' : '/folders');
            return;
        }

        const parent = breadcrumbPath[breadcrumbPath.length - 2];
        if (parent?.id) {
            navigate(isTrashMode ? `/folders/trash/${parent.id}` : `/folders/${parent.id}`);
            return;
        }

        navigate(isTrashMode ? '/folders/trash' : '/folders');
    };

    const handleBreadcrumbClick = (folderId: string | null) => {
        if (folderId) {
            navigate(isTrashMode ? `/folders/trash/${folderId}` : `/folders/${folderId}`);
            return;
        }

        navigate(isTrashMode ? '/folders/trash' : '/folders');
    };

    const getTargetFolderForCreation = () => {
        if (!contextMenu) {
            return currentFolderId || undefined;
        }

        if (contextMenu.type === 'folder' && contextMenu.folderId) {
            return contextMenu.folderId;
        }

        if (contextMenu.folderId) {
            return contextMenu.folderId;
        }

        return currentFolderId || undefined;
    };

    const handleAddFolder = async () => {
        if (isTrashMode) {
            closeContextMenu();
            return;
        }

        const targetParentId = getTargetFolderForCreation();
        if (targetParentId !== (currentFolderId || undefined)) {
            if (targetParentId) {
                navigate(`/folders/${targetParentId}`);
            } else {
                navigate('/folders');
            }

            if (targetParentId && !loadedFolders.has(targetParentId) && loadFolderDocuments) {
                await loadFolderDocuments(targetParentId, false);
            }
        }

        setPendingCreate({
            type: 'folder',
            parentFolderId: targetParentId,
            name: '',
        });
        closeContextMenu();
    };

    const handleAddDocument = async () => {
        if (isTrashMode) {
            closeContextMenu();
            return;
        }

        const targetFolderId = getTargetFolderForCreation();
        if (targetFolderId !== (currentFolderId || undefined)) {
            if (targetFolderId) {
                navigate(`/folders/${targetFolderId}`);
            } else {
                navigate('/folders');
            }

            if (targetFolderId && !loadedFolders.has(targetFolderId) && loadFolderDocuments) {
                await loadFolderDocuments(targetFolderId, false);
            }
        }

        setPendingCreate({
            type: 'document',
            parentFolderId: targetFolderId,
            name: '',
        });
        closeContextMenu();
    };

    const handleInlineCreateSubmit = async () => {
        if (!pendingCreate || isCreating) return;

        const trimmedName = pendingCreate.name.trim();

        if (pendingCreate.type === 'folder') {
            if (!trimmedName) {
                setPendingCreate(null);
                return;
            }

            setIsCreating(true);
            try {
                await createFolder({
                    name: trimmedName,
                    parent: pendingCreate.parentFolderId,
                });
                setPendingCreate(null);
            } finally {
                setIsCreating(false);
            }
            return;
        }

        startNewDocument({
            folderId: pendingCreate.parentFolderId,
            initialTitle: trimmedName || 'Untitled',
            initialContent: '',
        });
        setPendingCreate(null);
        navigate('/document/new');
    };

    const handleInlineCreateCancel = () => {
        if (isCreating) return;
        setPendingCreate(null);
    };

    const handleInlineRenameSubmit = async () => {
        if (!pendingRename || isRenaming) return;

        const trimmedName = pendingRename.name.trim();
        if (!trimmedName) {
            setPendingRename(null);
            return;
        }

        setIsRenaming(true);

        try {
            if (pendingRename.type === 'folder') {
                await updateFolder(pendingRename.id, { name: trimmedName });
            } else {
                await updateDocument(pendingRename.id, { title: trimmedName });
            }
            setPendingRename(null);
        } finally {
            setIsRenaming(false);
        }
    };

    const handleInlineRenameCancel = () => {
        if (isRenaming) return;
        setPendingRename(null);
    };

    const handleRenameFolder = async () => {
        if (!contextMenu?.folderId || isTrashMode) return;
        setPendingRename({
            type: 'folder',
            id: contextMenu.folderId,
            name: contextMenu.folderName || '',
        });
        closeContextMenu();
    };

    const handleDeleteFolder = async () => {
        const contextFolderId = contextMenu?.folderId;
        const shouldDeleteSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextFolderId ? selectedFolderIds.includes(contextFolderId) : false)
        );

        const folderIds = shouldDeleteSelection
            ? [...selectedFolderIds]
            : (contextFolderId ? [contextFolderId] : []);
        const documentIds = shouldDeleteSelection ? [...selectedDocumentIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        const totalItems = folderIds.length + documentIds.length;
        const title = totalItems > 1 ? `Delete ${totalItems} items` : 'Delete folder';
        const message = totalItems > 1
            ? `Move ${totalItems} selected items to trash?`
            : `Delete folder "${contextMenu?.folderName || 'Untitled'}"?`;

        setDeleteConfirmState({
            folderIds,
            documentIds,
            title,
            message,
        });
        closeContextMenu();
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirmState) {
            return;
        }

        try {
            const { folderIds, documentIds, isPermanent } = deleteConfirmState;

            if (isPermanent) {
                for (const documentId of documentIds) {
                    await permanentlyDeleteDocument(documentId);
                }
                for (const folderId of folderIds) {
                    await permanentlyDeleteFolder(folderId);
                }
            } else {
                for (const documentId of documentIds) {
                    await deleteDocument(documentId);
                }
                for (const folderId of folderIds) {
                    await deleteFolder(folderId);
                }
            }

            if (folderIds.length > 0) {
                setSelectedFolderIds((previous) => previous.filter((id) => !folderIds.includes(id)));
            }
            if (documentIds.length > 0) {
                setSelectedDocumentIds((previous) => previous.filter((id) => !documentIds.includes(id)));
            }
            setSelectionAnchorKey(null);
            setDeleteConfirmState(null);
        } catch (error) {
            log.error('Failed to delete selected items', error);
            showToast(deleteConfirmState.isPermanent
                ? 'Failed to permanently delete selected items. Please try again.'
                : 'Failed to move selected items to trash. Please try again.', 'error');
        }
    };

    const handleCancelDelete = () => {
        setDeleteConfirmState(null);
    };

    const handleRenameDocument = () => {
        if (!contextMenu?.documentId || isTrashMode) return;

        const targetDocument = displayedDocuments.find((document) => document.id === contextMenu.documentId);
        if (!targetDocument) {
            closeContextMenu();
            return;
        }

        setPendingRename({
            type: 'document',
            id: targetDocument.id,
            name: targetDocument.title || '',
        });
        closeContextMenu();
    };

    const handleDeleteDocument = async () => {
        if (isTrashMode) {
            closeContextMenu();
            return;
        }

        const contextDocumentId = contextMenu?.documentId;
        const shouldDeleteSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextDocumentId ? selectedDocumentIds.includes(contextDocumentId) : false)
        );

        const documentIds = shouldDeleteSelection
            ? [...selectedDocumentIds]
            : (contextDocumentId ? [contextDocumentId] : []);
        const folderIds = shouldDeleteSelection ? [...selectedFolderIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        const totalItems = folderIds.length + documentIds.length;
        const contextDocument = contextDocumentId
            ? displayedDocuments.find((document) => document.id === contextDocumentId)
            : null;
        const title = totalItems > 1 ? `Delete ${totalItems} items` : 'Delete document';
        const message = totalItems > 1
            ? `Move ${totalItems} selected items to trash?`
            : `Move "${contextDocument?.title || 'Untitled'}" to trash?`;

        setDeleteConfirmState({
            folderIds,
            documentIds,
            title,
            message,
        });
        closeContextMenu();
    };

    const exportSelectedItems = async () => {
        await exportSelectionAsZip({
            selectedFolderIds,
            selectedDocumentIds,
            zipName: currentFolder?.name || 'root',
        });
    };

    const handleExportDocument = async () => {
        if (isTrashMode) {
            closeContextMenu();
            return;
        }

        if (hasSelection) {
            await exportSelectedItems();
            closeContextMenu();
            return;
        }

        if (!contextMenu?.documentId) return;
        await exportDocument(contextMenu.documentId);
        closeContextMenu();
    };

    const handleExportFolder = async () => {
        if (isTrashMode) {
            closeContextMenu();
            return;
        }

        if (hasSelection) {
            await exportSelectedItems();
            closeContextMenu();
            return;
        }

        if (!contextMenu?.folderId || !contextMenu?.folderName) return;
        await exportFolder(contextMenu.folderId, contextMenu.folderName);
        closeContextMenu();
    };

    const openItemMenu = (
        event: React.MouseEvent<HTMLButtonElement>,
        type: 'folder' | 'document' | 'trash-folder' | 'trash-document',
        options?: { folderId?: string; folderName?: string; documentId?: string }
    ) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setContextMenu({
            x: rect.right,
            y: rect.bottom + 4,
            type,
            ...options,
        });
    };

    const handleRestoreDocument = async () => {
        const contextDocumentId = contextMenu?.documentId;
        const shouldRestoreSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextDocumentId ? selectedDocumentIds.includes(contextDocumentId) : false)
        );

        const documentIds = shouldRestoreSelection
            ? [...selectedDocumentIds]
            : (contextDocumentId ? [contextDocumentId] : []);
        const folderIds = shouldRestoreSelection ? [...selectedFolderIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        try {
            for (const documentId of documentIds) {
                await restoreDocument(documentId);
            }

            for (const folderId of folderIds) {
                await restoreFolder(folderId);
            }

            if (folderIds.length > 0) {
                setSelectedFolderIds((previous) => previous.filter((id) => !folderIds.includes(id)));
            }
            if (documentIds.length > 0) {
                setSelectedDocumentIds((previous) => previous.filter((id) => !documentIds.includes(id)));
            }

            setSelectionAnchorKey(null);
            setRefreshTrigger((previous) => previous + 1);
            closeContextMenu();
        } catch (error) {
            log.error('Failed to restore selected items', error);
            showToast('Failed to restore selected items. Please try again.', 'error');
        }
    };

    const handlePermanentlyDeleteDocument = async () => {
        const contextDocumentId = contextMenu?.documentId;
        const shouldDeleteSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextDocumentId ? selectedDocumentIds.includes(contextDocumentId) : false)
        );

        const documentIds = shouldDeleteSelection
            ? [...selectedDocumentIds]
            : (contextDocumentId ? [contextDocumentId] : []);
        const folderIds = shouldDeleteSelection ? [...selectedFolderIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        const totalItems = folderIds.length + documentIds.length;
        const contextDocument = contextDocumentId
            ? displayedDocuments.find((doc) => doc.id === contextDocumentId)
            : null;
        const title = totalItems > 1 ? `Permanently delete ${totalItems} items` : 'Permanently delete';
        const message = totalItems > 1
            ? `Permanently delete ${totalItems} selected items? This cannot be undone.`
            : `Permanently delete "${contextDocument?.title || 'Untitled'}"? This cannot be undone.`;

        setDeleteConfirmState({
            folderIds,
            documentIds,
            title,
            message,
            isPermanent: true,
        });
        closeContextMenu();
    };

    const handleRestoreFolder = async () => {
        const contextFolderId = contextMenu?.folderId;
        const shouldRestoreSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextFolderId ? selectedFolderIds.includes(contextFolderId) : false)
        );

        const folderIds = shouldRestoreSelection
            ? [...selectedFolderIds]
            : (contextFolderId ? [contextFolderId] : []);
        const documentIds = shouldRestoreSelection ? [...selectedDocumentIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        try {
            for (const documentId of documentIds) {
                await restoreDocument(documentId);
            }

            for (const folderId of folderIds) {
                await restoreFolder(folderId);
            }

            if (folderIds.length > 0) {
                setSelectedFolderIds((previous) => previous.filter((id) => !folderIds.includes(id)));
            }
            if (documentIds.length > 0) {
                setSelectedDocumentIds((previous) => previous.filter((id) => !documentIds.includes(id)));
            }

            setSelectionAnchorKey(null);
            setRefreshTrigger((previous) => previous + 1);
            closeContextMenu();
        } catch (error) {
            log.error('Failed to restore selected items', error);
            showToast('Failed to restore selected items. Please try again.', 'error');
        }
    };

    const handlePermanentlyDeleteFolder = async () => {
        const contextFolderId = contextMenu?.folderId;
        const shouldDeleteSelection = hasSelection && (
            selectedItemCount > 1 ||
            (contextFolderId ? selectedFolderIds.includes(contextFolderId) : false)
        );

        const folderIds = shouldDeleteSelection
            ? [...selectedFolderIds]
            : (contextFolderId ? [contextFolderId] : []);
        const documentIds = shouldDeleteSelection ? [...selectedDocumentIds] : [];

        if (folderIds.length === 0 && documentIds.length === 0) {
            closeContextMenu();
            return;
        }

        const totalItems = folderIds.length + documentIds.length;
        const title = totalItems > 1 ? `Permanently delete ${totalItems} items` : 'Permanently delete';
        const message = totalItems > 1
            ? `Permanently delete ${totalItems} selected items? This cannot be undone.`
            : `Permanently delete folder "${contextMenu?.folderName || 'Untitled'}"? This cannot be undone.`;

        setDeleteConfirmState({
            folderIds,
            documentIds,
            title,
            message,
            isPermanent: true,
        });
        closeContextMenu();
    };

    const openTrash = () => {
        navigate('/folders/trash', { preventScrollReset: true });
    };

    const exitTrash = () => {
        navigate('/folders', { preventScrollReset: true });
    };

    const dragHandlers = isTrashMode
        ? {
            handleDragStart: (_event: React.DragEvent, _documentId: string, _folderId?: string) => undefined,
            handleDragEnd: () => undefined,
            handleFolderDragStart: (_event: React.DragEvent, _folderId: string, _parentFolderId?: string) => undefined,
            handleFolderDragEnd: () => undefined,
            handleDragOver: (_event: React.DragEvent, _targetFolderId?: string) => undefined,
            handleDragLeave: (_event: React.DragEvent) => undefined,
            handleDrop: (_event: React.DragEvent, _targetFolderId?: string, _targetParentId?: string) => undefined,
        }
        : {
            handleDragStart,
            handleDragEnd,
            handleFolderDragStart,
            handleFolderDragEnd,
            handleDragOver,
            handleDragLeave,
            handleDrop,
        };

    const hasItems = displayedFolders.length > 0 || displayedDocuments.length > 0 || !!pendingCreate;

    return {
        viewMode,
        setViewMode,
        isTrashMode,
        currentFolderId,
        currentFolder,
        breadcrumbPath,
        displayedFolders,
        displayedDocuments,
        selectedFolderIds,
        selectedDocumentIds,
        isDesktop,
        hasSelection,
        clearSelection,
        deleteConfirmState,
        pendingCreate,
        pendingRename,
        isCreating,
        isRenaming,
        isLoadingCurrentFolder,
        hasItems,
        dropZone,
        contextMenu,
        isClosingContextMenu,
        contextMenuRef,
        handleContextMenu,
        closeContextMenu,
        ...dragHandlers,
        setPendingCreate,
        handleFolderClick,
        handleFolderDoubleClick,
        handleNavigateUp,
        handleBreadcrumbClick,
        openTrash,
        exitTrash,
        handleDocumentClick,
        handleDocumentDoubleClick,
        handleSelectAll,
        handleAddFolder,
        handleAddDocument,
        handleInlineCreateSubmit,
        handleInlineCreateCancel,
        setPendingRename,
        handleInlineRenameSubmit,
        handleInlineRenameCancel,
        handleRenameFolder,
        handleDeleteFolder,
        handleConfirmDelete,
        handleCancelDelete,
        handleRenameDocument,
        handleDeleteDocument,
        handleRestoreDocument,
        handlePermanentlyDeleteDocument,
        handleExportDocument,
        handleExportFolder,
        handleRestoreFolder,
        handlePermanentlyDeleteFolder,
        openItemMenu,
    };
}
