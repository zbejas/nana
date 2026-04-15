import { useState, useCallback } from 'react';
import { updateDocument } from '../../lib/documents';
import { createLogger } from '../../lib/logger';

const logger = createLogger('Attachments');
import type { Document } from '../../lib/documents/types';

interface UseAttachmentHandlersOptions {
    document: Document | null;
    onSave: (document: Document) => void;
    onShowToast: (message: string, type: 'error' | 'success' | 'info') => void;
}

export function useAttachmentHandlers({
    document,
    onSave,
    onShowToast,
}: UseAttachmentHandlersOptions) {
    const [newAttachments, setNewAttachments] = useState<File[]>([]);
    const [removedAttachments, setRemovedAttachments] = useState<string[]>([]);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [isMouseOverEditor, setIsMouseOverEditor] = useState(false);
    const [isAutoSaving, setIsAutoSaving] = useState(false);

    const handleAttachmentsChange = useCallback((files: File[]) => {
        setNewAttachments(files);
    }, []);

    const handleAttachmentRemove = useCallback((filename: string, isExisting: boolean) => {
        if (isExisting) {
            // Toggle existing attachment removal
            setRemovedAttachments(prev =>
                prev.includes(filename)
                    ? prev.filter(f => f !== filename)
                    : [...prev, filename]
            );
        } else {
            // Remove from new attachments
            setNewAttachments(prev => prev.filter(f => f.name !== filename));
        }
    }, []);

    const handleImmediateAttachmentDelete = useCallback(async (filename: string) => {
        if (!document?.id) return;

        try {
            setIsAutoSaving(true);
            const saveStartTime = Date.now();

            const updatedDoc = await updateDocument(document.id, {
                removeAttachments: [filename],
            });

            logger.debug('Attachment deleted immediately', { id: document.id, filename });

            // Update local document state to reflect the change
            onSave(updatedDoc);

            // Ensure spinner shows for minimum 500ms
            const elapsedTime = Date.now() - saveStartTime;
            const remainingTime = Math.max(0, 500 - elapsedTime);

            setTimeout(() => {
                setIsAutoSaving(false);
            }, remainingTime);
        } catch (err: any) {
            logger.error('Failed to delete attachment', { error: err.message });
            setIsAutoSaving(false);
        }
    }, [document?.id, onSave]);

    const handleAutoSaveAttachments = useCallback(async (files: File[]) => {
        if (!document?.id) return;

        try {
            onShowToast(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`, 'info');

            const updatedDocument = await updateDocument(document.id, {
                attachments: files,
            });

            onSave(updatedDocument);
            onShowToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success');
        } catch (err: any) {
            logger.error('Failed to upload attachments', { error: err.message });

            // Check if error is due to file size limit
            if (err.data?.data?.attachments?.code === 'validation_file_size_limit') {
                const maxSize = err.data.data.attachments.message.match(/\d+/)?.[0];
                onShowToast(
                    `File too large. Maximum size is ${maxSize ? maxSize + 'MB' : 'exceeded'}`,
                    'error'
                );
            } else {
                onShowToast('Failed to upload attachments', 'error');
            }
        }
    }, [document?.id, onSave, onShowToast]);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDraggingFile(true);
            setIsMouseOverEditor(true);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if we're actually leaving the editor container
        const rect = e.currentTarget.getBoundingClientRect();
        const isOutside =
            e.clientX < rect.left ||
            e.clientX >= rect.right ||
            e.clientY < rect.top ||
            e.clientY >= rect.bottom;

        if (isOutside) {
            setIsDraggingFile(false);
            setIsMouseOverEditor(false);
        }
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(false);
            setIsMouseOverEditor(false);

            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                // Auto-save attachments immediately if we have an existing document
                if (document?.id) {
                    handleAutoSaveAttachments(files);
                } else {
                    // Queue for next save if creating new document
                    setNewAttachments(prev => [...prev, ...files]);
                }
            }
        },
        [document?.id, handleAutoSaveAttachments]
    );

    return {
        newAttachments,
        removedAttachments,
        isDraggingFile,
        isMouseOverEditor,
        isAutoSaving,
        setIsAutoSaving,
        setNewAttachments,
        setRemovedAttachments,
        handleAttachmentsChange,
        handleAttachmentRemove,
        handleImmediateAttachmentDelete,
        handleAutoSaveAttachments,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    };
}
