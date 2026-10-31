import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('ContextMenu');
import { useToasts } from '../../../state/hooks';
import { addToBoardRequestAtom } from '../../../state/atoms';
import type { ContextMenuState } from './useContextMenuState';

interface DeleteDialogConfig {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => Promise<void>;
}

interface InlineInputState {
    type: 'folder' | 'document';
    parentFolderId?: string;
    depth?: number;
}

interface UseContextMenuHandlersProps {
    contextMenu: ContextMenuState | null;
    closeContextMenu: () => void;
    selectedDocumentId?: string;
    handlers: {
        handleAddFolder: (parentFolderId?: string) => Promise<InlineInputState>;
        handleAddDocument: (folderId?: string) => Promise<void>;
        handleDeleteDocument: (documentId: string, selectedDocumentId?: string) => Promise<void>;
        handleRestoreDocument: (documentId: string) => Promise<void>;
        handlePermanentlyDeleteDocument: (documentId: string) => Promise<void>;
        handleDeleteFolder: (folderId: string) => Promise<void>;
        handleRestoreFolder: (folderId: string) => Promise<void>;
        handlePermanentlyDeleteFolder: (folderId: string) => Promise<void>;
        handleExportDocument: (documentId: string) => Promise<void>;
        handleExportFolder: (folderId: string, folderName: string) => Promise<void>;
        handleTrashBoard: (boardId: string, boardName?: string) => Promise<void>;
        handleExportBoard: (boardId: string, boardName: string) => Promise<void>;
        handleRestoreBoard: (boardId: string) => Promise<void>;
        handlePermanentlyDeleteBoard: (boardId: string) => Promise<void>;
    };
    setInlineInput: (input: InlineInputState | null) => void;
    setRenamingFolderId: (id: string | null) => void;
    openDeleteDialog: (config: DeleteDialogConfig) => void;
    toggle: () => void;
}

export function useContextMenuHandlers({
    contextMenu,
    closeContextMenu,
    selectedDocumentId,
    handlers,
    setInlineInput,
    setRenamingFolderId,
    openDeleteDialog,
    toggle,
}: UseContextMenuHandlersProps) {
    const navigate = useNavigate();
    const { showToast } = useToasts();
    const setAddToBoardRequest = useSetAtom(addToBoardRequestAtom);

    const handleAddFolder = useCallback(async () => {
        const result = await handlers.handleAddFolder(contextMenu?.folderId);
        setInlineInput(result);
        closeContextMenu();
    }, [contextMenu?.folderId, handlers, setInlineInput, closeContextMenu]);

    const handleAddDocument = useCallback(async () => {
        await handlers.handleAddDocument(contextMenu?.folderId);
        closeContextMenu();
    }, [contextMenu?.folderId, handlers, closeContextMenu]);

    const handleDeleteDocument = useCallback(async () => {
        if (!contextMenu?.documentId) return;
        const documentId = contextMenu.documentId;
        openDeleteDialog({
            title: 'Move to Trash',
            message: 'Move this document to trash?',
            onConfirm: async () => {
                await handlers.handleDeleteDocument(documentId, selectedDocumentId);
            },
        });
        closeContextMenu();
    }, [contextMenu?.documentId, selectedDocumentId, handlers, openDeleteDialog, closeContextMenu]);

    const handleRestoreDocument = useCallback(async () => {
        if (!contextMenu?.documentId) return;
        try {
            await handlers.handleRestoreDocument(contextMenu.documentId);
        } catch (error) {
            logger.error('Failed to restore document', { error });
            showToast('Failed to restore document', 'error');
        }
        closeContextMenu();
    }, [contextMenu?.documentId, handlers, closeContextMenu, showToast]);

    const handlePermanentlyDeleteDocument = useCallback(async () => {
        if (!contextMenu?.documentId) return;
        const documentId = contextMenu.documentId;
        openDeleteDialog({
            title: 'Permanently Delete',
            message: 'Permanently delete this document? This cannot be undone!',
            confirmLabel: 'Delete forever',
            onConfirm: async () => {
                await handlers.handlePermanentlyDeleteDocument(documentId);
            },
        });
        closeContextMenu();
    }, [contextMenu?.documentId, handlers, openDeleteDialog, closeContextMenu]);

    const handleDeleteFolder = useCallback(async () => {
        if (!contextMenu?.folderId) return;
        const folderId = contextMenu.folderId;
        const folderName = contextMenu.folderName;
        openDeleteDialog({
            title: 'Delete Folder',
            message: `Delete folder "${folderName}"? All documents and subfolders will also be deleted.`,
            onConfirm: async () => {
                await handlers.handleDeleteFolder(folderId);
            },
        });
        closeContextMenu();
    }, [contextMenu?.folderId, contextMenu?.folderName, handlers, openDeleteDialog, closeContextMenu]);

    const handleRenameFolder = useCallback(() => {
        if (!contextMenu?.folderId) return;
        setRenamingFolderId(contextMenu.folderId);
        closeContextMenu();
    }, [contextMenu?.folderId, setRenamingFolderId, closeContextMenu]);

    const handleRenameDocument = useCallback(() => {
        if (!contextMenu?.documentId) return;
        const documentId = contextMenu.documentId;
        closeContextMenu();
        navigate(`/document/${documentId}?selectTitle=true`);
        if (window.innerWidth < 768) toggle();
    }, [contextMenu?.documentId, closeContextMenu, navigate, toggle]);

    const handleRestoreFolder = useCallback(async () => {
        if (!contextMenu?.folderId) return;
        try {
            await handlers.handleRestoreFolder(contextMenu.folderId);
        } catch (error) {
            logger.error('Failed to restore folder', { error });
            showToast('Failed to restore folder', 'error');
        }
        closeContextMenu();
    }, [contextMenu?.folderId, handlers, closeContextMenu, showToast]);

    const handlePermanentlyDeleteFolder = useCallback(async () => {
        if (!contextMenu?.folderId) return;
        const folderId = contextMenu.folderId;
        const folderName = contextMenu.folderName;
        openDeleteDialog({
            title: 'Permanently Delete Folder',
            message: `Permanently delete folder "${folderName}"? This cannot be undone!`,
            confirmLabel: 'Delete forever',
            onConfirm: async () => {
                await handlers.handlePermanentlyDeleteFolder(folderId);
            },
        });
        closeContextMenu();
    }, [contextMenu?.folderId, contextMenu?.folderName, handlers, openDeleteDialog, closeContextMenu]);

    const handleExportDocument = useCallback(async () => {
        if (!contextMenu?.documentId) return;
        await handlers.handleExportDocument(contextMenu.documentId);
        closeContextMenu();
    }, [contextMenu?.documentId, handlers, closeContextMenu]);

    const handleAddToBoard = useCallback(() => {
        if (!contextMenu?.documentId) return;
        const documentId = contextMenu.documentId;
        setAddToBoardRequest({ documentId });
        closeContextMenu();
    }, [contextMenu?.documentId, closeContextMenu, setAddToBoardRequest]);

    const handleExportFolder = useCallback(async () => {
        if (!contextMenu?.folderId || !contextMenu?.folderName) return;
        await handlers.handleExportFolder(contextMenu.folderId, contextMenu.folderName);
        closeContextMenu();
    }, [contextMenu?.folderId, contextMenu?.folderName, handlers, closeContextMenu]);

    const handleTrashBoard = useCallback(async () => {
        if (!contextMenu?.boardId) return;
        const boardId = contextMenu.boardId;
        const boardName = contextMenu.boardName;
        openDeleteDialog({
            title: 'Move to Trash',
            message: `Move board "${boardName || 'Untitled'}" and its tasks to trash? You can restore it later.`,
            onConfirm: async () => {
                await handlers.handleTrashBoard(boardId, boardName);
            },
        });
        closeContextMenu();
    }, [contextMenu?.boardId, contextMenu?.boardName, handlers, openDeleteDialog, closeContextMenu]);

    const handleExportBoard = useCallback(async () => {
        if (!contextMenu?.boardId || !contextMenu?.boardName) return;
        await handlers.handleExportBoard(contextMenu.boardId, contextMenu.boardName);
        closeContextMenu();
    }, [contextMenu?.boardId, contextMenu?.boardName, handlers, closeContextMenu]);

    const handleRestoreBoard = useCallback(async () => {
        if (!contextMenu?.boardId) return;
        try {
            await handlers.handleRestoreBoard(contextMenu.boardId);
        } catch (error) {
            logger.error('Failed to restore board', { error });
            showToast('Failed to restore board', 'error');
        }
        closeContextMenu();
    }, [contextMenu?.boardId, handlers, closeContextMenu, showToast]);

    const handlePermanentlyDeleteBoard = useCallback(async () => {
        if (!contextMenu?.boardId) return;
        const boardId = contextMenu.boardId;
        const boardName = contextMenu.boardName;
        openDeleteDialog({
            title: 'Permanently Delete Board',
            message: `Permanently delete board "${boardName || 'Untitled'}" and its tasks? This cannot be undone!`,
            confirmLabel: 'Delete forever',
            onConfirm: async () => {
                await handlers.handlePermanentlyDeleteBoard(boardId);
            },
        });
        closeContextMenu();
    }, [contextMenu?.boardId, contextMenu?.boardName, handlers, openDeleteDialog, closeContextMenu]);

    return {
        handleAddFolder,
        handleAddDocument,
        handleDeleteDocument,
        handleRestoreDocument,
        handlePermanentlyDeleteDocument,
        handleDeleteFolder,
        handleRenameFolder,
        handleRenameDocument,
        handleRestoreFolder,
        handlePermanentlyDeleteFolder,
        handleExportDocument,
        handleExportFolder,
        handleTrashBoard,
        handleExportBoard,
        handleRestoreBoard,
        handlePermanentlyDeleteBoard,
        handleAddToBoard,
    };
}
