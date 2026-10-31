import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDocument, updateDocument } from '../../lib/documents';
import { saveDocumentWithMerge } from '../../lib/documents/save';
import { createLogger } from '../../lib/logger';

const logger = createLogger('AutoSave');
import type { Document } from '../../lib/documents/types';
import { MIN_AUTO_SAVE_DELAY } from '../../lib/settings';

interface UseAutoSaveOptions {
    urlDocumentId: string | undefined;
    document: Document | null;
    title: string;
    content: string;
    tags: string[];
    newAttachments: File[];
    removedAttachments: string[];
    autoSaveDelayMs: number;
    hasUnsavedChanges: boolean;
    isReadOnly?: boolean;
    folderId?: string | null;
    creationSessionId: number;
    isSavingRef: React.MutableRefObject<boolean>;
    onSave: (document: Document, options?: { creationSessionId?: number }) => void;
    onApplyMergedContent?: (content: string) => void;
    onSetIsAutoSaving: (saving: boolean) => void;
    onShowToast: (message: string, type: 'error' | 'success' | 'info') => void;
}

export function useAutoSave({
    urlDocumentId,
    document,
    title,
    content,
    tags,
    newAttachments,
    removedAttachments,
    autoSaveDelayMs,
    hasUnsavedChanges,
    isReadOnly = false,
    folderId,
    creationSessionId,
    isSavingRef,
    onSave,
    onApplyMergedContent,
    onSetIsAutoSaving,
    onShowToast,
}: UseAutoSaveOptions) {
    const navigate = useNavigate();
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const autoSaveSpinnerTimerRef = useRef<NodeJS.Timeout | null>(null);
    const savingReleaseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);
    const creationSessionIdRef = useRef(creationSessionId);
    const onSaveRef = useRef(onSave);
    const onApplyMergedContentRef = useRef(onApplyMergedContent);
    const onSetIsAutoSavingRef = useRef(onSetIsAutoSaving);
    const onShowToastRef = useRef(onShowToast);
    const navigateRef = useRef(navigate);

    useEffect(() => {
        creationSessionIdRef.current = creationSessionId;
        onSaveRef.current = onSave;
        onApplyMergedContentRef.current = onApplyMergedContent;
        onSetIsAutoSavingRef.current = onSetIsAutoSaving;
        onShowToastRef.current = onShowToast;
        navigateRef.current = navigate;
    }, [creationSessionId, onSave, onApplyMergedContent, onSetIsAutoSaving, onShowToast, navigate]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
            if (autoSaveSpinnerTimerRef.current) {
                clearTimeout(autoSaveSpinnerTimerRef.current);
            }
            if (savingReleaseTimerRef.current) {
                clearTimeout(savingReleaseTimerRef.current);
            }
        };
    }, []);

    // Auto-save with debounce - works for both new and existing documents
    useEffect(() => {
        // Clear any existing timer
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        // Don't auto-save if there are no changes
        if (!hasUnsavedChanges) {
            onSetIsAutoSavingRef.current(false);
            return;
        }

        if (isReadOnly) {
            onSetIsAutoSavingRef.current(false);
            return;
        }

        // Don't auto-save if we're already saving
        if (isSavingRef.current) {
            return;
        }

        // For new documents, require at least a title or content before auto-saving
        if (urlDocumentId === 'new' && !title.trim() && !content.trim()) {
            return;
        }

        const sanitizedDelay = Math.max(MIN_AUTO_SAVE_DELAY, autoSaveDelayMs);

        // Set up auto-save timer
        const sessionAtStart = creationSessionIdRef.current;
        autoSaveTimerRef.current = setTimeout(async () => {
            try {
                onSetIsAutoSavingRef.current(true);
                isSavingRef.current = true;
                const saveStartTime = Date.now();

                let savedDocument: Document;

                // Check if we're creating a new document or updating existing
                if (urlDocumentId !== 'new' && document?.id) {
                    // Updating existing document
                    logger.debug('Auto-saving existing document', { id: document.id });

                    const result = await saveDocumentWithMerge({
                        base: document,
                        title: title.trim() || 'Untitled',
                        content,
                        tags,
                        attachments: newAttachments,
                        removeAttachments: removedAttachments,
                        onMergedContent: (merged) => onApplyMergedContentRef.current?.(merged),
                    });
                    savedDocument = result.document;
                    logger.info('Document auto-saved successfully', { id: document.id });
                } else {
                    // Creating new document
                    logger.debug('Auto-saving new document');

                    savedDocument = await createDocument({
                        title: title.trim() || 'Untitled',
                        content: content.trim(),
                        tags,
                        folder: folderId || undefined,
                    });

                    // Upload attachments separately if there are any
                    if (newAttachments.length > 0) {
                        savedDocument = await updateDocument(savedDocument.id, {
                            attachments: newAttachments,
                        });
                    }

                    logger.info('New document auto-saved successfully', { id: savedDocument.id });

                    // If the user started another new document while this save
                    // was in-flight, don't navigate away from /document/new and
                    // don't overwrite the blank editor state.
                    if (creationSessionIdRef.current !== sessionAtStart) {
                        logger.debug('Skipping post-save navigation — a new document session started');
                        onSetIsAutoSavingRef.current(false);
                        return;
                    }

                    onSaveRef.current(savedDocument, { creationSessionId: sessionAtStart });

                    // Navigate to the new document URL
                    navigateRef.current(`/document/${savedDocument.id}`, { replace: true });
                }

                if (urlDocumentId !== 'new' || document?.id) {
                    onSaveRef.current(savedDocument, { creationSessionId: sessionAtStart });
                }

                // Ensure spinner shows for minimum 500ms for better UX
                const elapsedTime = Date.now() - saveStartTime;
                const remainingTime = Math.max(0, 500 - elapsedTime);

                if (autoSaveSpinnerTimerRef.current) {
                    clearTimeout(autoSaveSpinnerTimerRef.current);
                }

                autoSaveSpinnerTimerRef.current = setTimeout(() => {
                    if (isMountedRef.current) {
                        onSetIsAutoSavingRef.current(false);
                    }
                }, remainingTime);
            } catch (err: any) {
                if (isMountedRef.current) {
                    logger.error('Auto-save failed', { error: err.message });
                    onShowToastRef.current('Failed to auto-save', 'error');
                    onSetIsAutoSavingRef.current(false);
                }
            } finally {
                // Keep isSavingRef true for a short time to avoid subscription race
                if (savingReleaseTimerRef.current) {
                    clearTimeout(savingReleaseTimerRef.current);
                }

                savingReleaseTimerRef.current = setTimeout(() => {
                    if (isMountedRef.current) {
                        isSavingRef.current = false;
                    }
                }, 200);
            }
        }, sanitizedDelay);

        // Cleanup on unmount or when dependencies change
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, [
        title,
        content,
        tags,
        document?.id,
        urlDocumentId,
        hasUnsavedChanges,
        folderId,
        newAttachments,
        removedAttachments,
        autoSaveDelayMs,
        isSavingRef,
        isReadOnly,
    ]);
}
