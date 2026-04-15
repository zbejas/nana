import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import {
    createFolder,
    updateFolder,
    deleteFolder,
    restoreFolder,
    permanentlyDeleteFolder
} from "../../lib/folders";
import {
    deleteDocument,
    permanentlyDeleteDocument,
    restoreDocument,
    type Document
} from "../../lib/documents";
import { exportFolder, exportDocument } from "../../lib/export";
import { createLogger } from "../../lib/logger";

const logger = createLogger('Sidebar');
import { getDefaultHomepageRoute } from "../../lib/settings";
import { useFileFolderDnD } from "../file-folder-handling";
import { useToasts } from "../../state/hooks";
import { refreshTriggerAtom } from "../../state/atoms";

interface EditorActions {
    select: (document: Document) => void;
    startNew: (params?: { folderId?: string; initialTitle?: string; initialContent?: string }) => void;
    saveCallback: (() => Promise<void>) | null;
    reset: () => void;
}

interface SidebarActions {
    toggle: () => void;
    prepareForNavigation: () => void;
}

interface SidebarDataActions {
    expandedFolders: Set<string>;
    toggleFolder: (folderId: string) => Promise<void>;
}

interface UseSidebarHandlersProps {
    editorActions: EditorActions;
    sidebarActions: SidebarActions;
    dataHook: SidebarDataActions;
}

export function useSidebarHandlers({ editorActions, sidebarActions, dataHook }: UseSidebarHandlersProps) {
    const navigate = useNavigate();
    const setRefreshTrigger = useSetAtom(refreshTriggerAtom);
    const { showToast } = useToasts();
    const { select, startNew, saveCallback, reset } = editorActions;
    const { toggle, prepareForNavigation } = sidebarActions;
    const { expandedFolders, toggleFolder: toggleFolderExpanded } = dataHook;

    /** Close sidebar on mobile without undoing navigation */
    const mobileClose = useCallback(() => {
        if (window.innerWidth < 768) {
            prepareForNavigation();
            toggle();
        }
    }, [prepareForNavigation, toggle]);

    // Document/folder handlers
    const handleDocumentClick = useCallback((doc: Document) => {
        select(doc);
        navigate(`/document/${doc.id}`);
        mobileClose();
    }, [select, navigate, mobileClose]);

    const handleLogoClick = useCallback(() => {
        reset();
        navigate(getDefaultHomepageRoute());
        mobileClose();
    }, [reset, navigate, mobileClose]);

    const handleAddFolder = useCallback(async (parentFolderId?: string) => {
        if (parentFolderId && !expandedFolders.has(parentFolderId)) {
            await toggleFolderExpanded(parentFolderId);
        }
        return { type: 'folder' as const, parentFolderId };
    }, [expandedFolders, toggleFolderExpanded]);

    const handleInlineFolderSubmit = useCallback(async (name: string, parentFolderId?: string) => {
        if (name.trim()) {
            try {
                const newFolder = await createFolder({
                    name: name.trim(),
                    parent: parentFolderId,
                });
                await toggleFolderExpanded(newFolder.id);
                if (parentFolderId && !expandedFolders.has(parentFolderId)) {
                    await toggleFolderExpanded(parentFolderId);
                }
            } catch (error) {
                logger.error('Failed to create folder', {
                    error: error instanceof Error ? error.message : String(error),
                });
                showToast('Failed to create folder', 'error');
            }
        }
    }, [expandedFolders, toggleFolderExpanded, showToast]);

    const handleAddDocument = useCallback(async (folderId?: string) => {
        if (folderId && !expandedFolders.has(folderId)) {
            await toggleFolderExpanded(folderId);
        }
        startNew({ folderId, initialTitle: '', initialContent: '' });
        navigate('/document/new');
        mobileClose();
    }, [expandedFolders, toggleFolderExpanded, startNew, navigate, mobileClose]);

    const handleDeleteDocument = useCallback(async (documentId: string, selectedDocumentId?: string) => {
        if (selectedDocumentId === documentId) {
            reset();
            navigate('/timeline');
        }
        await deleteDocument(documentId);
    }, [reset, navigate]);

    const handleRestoreDocument = useCallback(async (documentId: string) => {
        await restoreDocument(documentId);
        setRefreshTrigger((previous) => previous + 1);
    }, [setRefreshTrigger]);

    const handlePermanentlyDeleteDocument = useCallback(async (documentId: string) => {
        await permanentlyDeleteDocument(documentId);
    }, []);

    const handleDeleteFolder = useCallback(async (folderId: string) => {
        await deleteFolder(folderId);
    }, []);

    const handleRenameFolder = useCallback(async (folderId: string, newName: string) => {
        try {
            await updateFolder(folderId, { name: newName.trim() });
            logger.info('Folder renamed successfully', { folderId, newName });
        } catch (error) {
            logger.error('Failed to rename folder', { error });
            showToast('Failed to rename folder', 'error');
        }
    }, [showToast]);

    const handleRestoreFolder = useCallback(async (folderId: string) => {
        await restoreFolder(folderId);
        setRefreshTrigger((previous) => previous + 1);
    }, [setRefreshTrigger]);

    const handlePermanentlyDeleteFolder = useCallback(async (folderId: string) => {
        await permanentlyDeleteFolder(folderId);
    }, []);

    const handleExportDocument = useCallback(async (documentId: string) => {
        try {
            await exportDocument(documentId);
            logger.info('Document exported successfully', { documentId });
        } catch (error) {
            logger.error('Failed to export document', { error });
            showToast(error instanceof Error ? error.message : 'Failed to export document', 'error');
        }
    }, [showToast]);

    const handleExportFolder = useCallback(async (folderId: string, folderName: string) => {
        try {
            await exportFolder(folderId, folderName);
            logger.info('Folder exported successfully', { folderId, folderName });
        } catch (error) {
            logger.error('Failed to export folder', { error });
            showToast(error instanceof Error ? error.message : 'Failed to export folder', 'error');
        }
    }, [showToast]);

    const {
        draggedDocument,
        draggedFolder,
        dropZone,
        dropPosition,
        handleDragStart,
        handleDragEnd,
        handleFolderDragStart,
        handleFolderDragEnd,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    } = useFileFolderDnD();

    // Unsaved changes handlers
    const handleUnsavedDialogSave = useCallback(async (
        pendingDocument: Document | null,
        setPendingDocument: (doc: Document | null) => void
    ) => {
        if (saveCallback) {
            try {
                await saveCallback();
                await new Promise(resolve => setTimeout(resolve, 150));
            } catch (error) {
                logger.error('Failed to save document before switching', { error });
            }
        }

        if (pendingDocument) {
            setTimeout(() => {
                select(pendingDocument);
                navigate(`/document/${pendingDocument.id}`);
                setPendingDocument(null);
            }, 50);
        } else {
            setTimeout(() => {
                reset();
                navigate('/timeline');
                mobileClose();
            }, 50);
        }
    }, [saveCallback, select, navigate, reset, mobileClose]);

    const handleUnsavedDialogDiscard = useCallback((
        pendingDocument: Document | null,
        setPendingDocument: (doc: Document | null) => void
    ) => {
        if (pendingDocument) {
            select(pendingDocument);
            navigate(`/document/${pendingDocument.id}`);
            setPendingDocument(null);
        } else {
            reset();
            navigate('/timeline');
            mobileClose();
        }
    }, [select, navigate, reset, mobileClose]);

    return {
        handleDocumentClick,
        handleLogoClick,
        handleAddFolder,
        handleInlineFolderSubmit,
        handleAddDocument,
        handleDeleteDocument,
        handleRestoreDocument,
        handlePermanentlyDeleteDocument,
        handleDeleteFolder,
        handleRenameFolder,
        handleRestoreFolder,
        handlePermanentlyDeleteFolder,
        handleExportDocument,
        handleExportFolder,
        draggedDocument,
        draggedFolder,
        dropZone,
        dropPosition,
        handleDragStart,
        handleDragEnd,
        handleFolderDragStart,
        handleFolderDragEnd,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        handleUnsavedDialogSave,
        handleUnsavedDialogDiscard,
    };
}
