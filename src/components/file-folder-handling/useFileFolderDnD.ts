import { useCallback, useState } from 'react';
import { updateDocument } from '../../lib/documents';
import { updateFolder } from '../../lib/folders';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DragDrop');
import type {
    DropPosition,
    OnDragStartDocument,
    OnDragStartFolder,
    OnDragEnd,
    OnDragOver,
    OnDragLeave,
    OnDrop,
} from './types';

type DraggedDocument = { id: string; currentFolderId?: string };
type DraggedFolder = { id: string; parentFolderId?: string };

function normalizeFolderValue(folderId?: string): string {
    return folderId ?? '';
}

export function useFileFolderDnD() {
    const [draggedDocument, setDraggedDocument] = useState<DraggedDocument | null>(null);
    const [draggedFolder, setDraggedFolder] = useState<DraggedFolder | null>(null);
    const [dropZone, setDropZone] = useState<string | null>(null);
    const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);

    const clearDragState = useCallback(() => {
        setDraggedDocument(null);
        setDraggedFolder(null);
        setDropZone(null);
        setDropPosition(null);
    }, []);

    const handleDragStart: OnDragStartDocument = useCallback((e, documentId, currentFolderId) => {
        e.stopPropagation();
        setDraggedDocument({ id: documentId, currentFolderId });
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragEnd: OnDragEnd = useCallback(() => {
        clearDragState();
    }, [clearDragState]);

    const handleFolderDragStart: OnDragStartFolder = useCallback((e, folderId, parentFolderId) => {
        e.stopPropagation();
        setDraggedFolder({ id: folderId, parentFolderId });
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleFolderDragEnd: OnDragEnd = useCallback(() => {
        clearDragState();
    }, [clearDragState]);

    const handleDragOver: OnDragOver = useCallback((e, targetFolderId, position = 'into') => {
        if (!draggedDocument && !draggedFolder) return;

        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        if (draggedFolder && targetFolderId === draggedFolder.id) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }

        setDropZone(targetFolderId || 'root');
        setDropPosition(position);
    }, [draggedDocument, draggedFolder]);

    const handleDragLeave: OnDragLeave = useCallback((e) => {
        e.stopPropagation();
        if (e.currentTarget === e.target) {
            setDropZone(null);
            setDropPosition(null);
        }
    }, []);

    const handleDrop: OnDrop = useCallback(async (e, targetFolderId, targetParentId) => {
        e.preventDefault();
        e.stopPropagation();

        let destinationFolderId = targetFolderId;
        if (dropPosition === 'above' || dropPosition === 'below') {
            destinationFolderId = targetParentId;
        }

        if (draggedDocument) {
            const { id: documentId, currentFolderId } = draggedDocument;

            if (normalizeFolderValue(currentFolderId) === normalizeFolderValue(destinationFolderId)) {
                clearDragState();
                return;
            }

            try {
                logger.debug('Moving document', {
                    documentId,
                    from: currentFolderId || 'root',
                    to: destinationFolderId || 'root',
                });
                await updateDocument(documentId, { folder: destinationFolderId === undefined ? '' : destinationFolderId });
                logger.info('Document moved successfully', { documentId, destinationFolderId: destinationFolderId || 'root' });
            } catch (error: any) {
                logger.error('Failed to move document', { error: error?.message ?? String(error) });
            } finally {
                clearDragState();
            }
            return;
        }

        if (draggedFolder) {
            const { id: folderId, parentFolderId } = draggedFolder;

            if (folderId === destinationFolderId) {
                clearDragState();
                return;
            }

            if (normalizeFolderValue(parentFolderId) === normalizeFolderValue(destinationFolderId)) {
                clearDragState();
                return;
            }

            try {
                logger.debug('Moving folder', {
                    folderId,
                    from: parentFolderId || 'root',
                    to: destinationFolderId || 'root',
                    position: dropPosition,
                });
                await updateFolder(folderId, { parent: destinationFolderId === undefined ? '' : destinationFolderId });
                logger.info('Folder moved successfully', { folderId, destinationFolderId: destinationFolderId || 'root' });
            } catch (error: any) {
                logger.error('Failed to move folder', { error: error?.message ?? String(error) });
            } finally {
                clearDragState();
            }
        }
    }, [draggedDocument, draggedFolder, dropPosition, clearDragState]);

    return {
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
    };
}
