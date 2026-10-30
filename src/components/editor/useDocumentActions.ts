import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createDocument, createDocumentVersion, updateDocument } from '../../lib/documents';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DocActions');
import { getDefaultHomepageRoute, getLastNonDocumentRoute } from '../../lib/settings';
import type { Document } from '../../lib/documents/types';

interface UseDocumentActionsOptions {
    urlDocumentId: string | undefined;
    document: Document | null;
    title: string;
    content: string;
    tags: string[];
    newAttachments: File[];
    removedAttachments: string[];
    folderId?: string | null;
    creationSessionId: number;
    isReadOnly: boolean;
    isSavingRef: React.MutableRefObject<boolean>;
    onSave: (document: Document, options?: { creationSessionId?: number }) => void;
    onReset: () => void;
    onSetSaving: (saving: boolean) => void;
    onSetPublishing: (publishing: boolean) => void;
    onShowToast: (message: string, type: 'error' | 'success' | 'info') => void;
    onSetError: (error: string | null) => void;
}

export function useDocumentActions({
    urlDocumentId,
    document,
    title,
    content,
    tags,
    newAttachments,
    removedAttachments,
    folderId,
    creationSessionId,
    isReadOnly,
    isSavingRef,
    onSave,
    onReset,
    onSetSaving,
    onSetPublishing,
    onShowToast,
    onSetError,
}: UseDocumentActionsOptions) {
    const navigate = useNavigate();
    const location = useLocation();
    const saveResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelNavigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const creationSessionIdRef = useRef(creationSessionId);

    useEffect(() => {
        creationSessionIdRef.current = creationSessionId;
    }, [creationSessionId]);

    useEffect(() => {
        return () => {
            if (saveResetTimeoutRef.current) {
                clearTimeout(saveResetTimeoutRef.current);
                saveResetTimeoutRef.current = null;
            }

            if (cancelNavigateTimeoutRef.current) {
                clearTimeout(cancelNavigateTimeoutRef.current);
                cancelNavigateTimeoutRef.current = null;
            }
        };
    }, []);

    const handleSave = useCallback(async () => {
        if (isReadOnly) {
            onShowToast('Trash documents are read-only', 'info');
            return;
        }

        onSetSaving(true);
        isSavingRef.current = true;
        onSetError(null);

        try {
            const sessionAtStart = creationSessionIdRef.current;
            const saveTitle = title.trim() || 'Untitled';
            let savedDocument: Document;

            // Check if we're creating a new document or updating existing
            if (urlDocumentId !== 'new' && document?.id) {
                savedDocument = await updateDocument(document.id, {
                    title: saveTitle,
                    content: content.trim(),
                    tags,
                    revision: document.revision,
                    attachments: newAttachments.length > 0 ? newAttachments : undefined,
                    removeAttachments: removedAttachments.length > 0 ? removedAttachments : undefined,
                });
                logger.info('Document saved successfully', { id: document.id });
            } else {
                savedDocument = await createDocument({
                    title: saveTitle,
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

                logger.info('New document created', { id: savedDocument.id });

                if (creationSessionIdRef.current !== sessionAtStart) {
                    logger.debug('Skipping post-save navigation — a new document session started');
                    return;
                }
            }

            // Update the global state with saved document
            onSave(savedDocument, { creationSessionId: sessionAtStart });

            // If we just created a new document (from /document/new), navigate to its URL
            if (urlDocumentId === 'new') {
                navigate(`/document/${savedDocument.id}`, { replace: true });
            }
        } catch (err: any) {
            logger.error('Failed to save document', { error: err.message });
            onSetError(err.message || 'Failed to save document');
        } finally {
            onSetSaving(false);
            // Keep isSavingRef true for a short time to avoid subscription race
            if (saveResetTimeoutRef.current) {
                clearTimeout(saveResetTimeoutRef.current);
            }

            saveResetTimeoutRef.current = setTimeout(() => {
                isSavingRef.current = false;
            }, 200);
        }
    }, [
        title,
        content,
        tags,
        newAttachments,
        removedAttachments,
        document,
        folderId,
        creationSessionId,
        urlDocumentId,
        navigate,
        isSavingRef,
        onSave,
        onSetSaving,
        onSetError,
        onShowToast,
        isReadOnly,
    ]);

    const handlePublish = useCallback(async () => {
        if (isReadOnly) {
            onShowToast('Trash documents are read-only', 'info');
            return;
        }

        if (!document?.id) {
            onShowToast('Save the note first before saving a version', 'error');
            return;
        }

        onSetPublishing(true);
        isSavingRef.current = true;

        try {
            // Persist the editor state first, then commit that exact revision.
            const savedDocument = await updateDocument(document.id, {
                title: title.trim() || 'Untitled',
                content: content.trim(),
                tags,
                revision: document.revision,
                attachments: newAttachments.length > 0 ? newAttachments : undefined,
                removeAttachments: removedAttachments.length > 0 ? removedAttachments : undefined,
            });

            // Update global state with the save even if the version commit fails.
            onSave(savedDocument, { creationSessionId: creationSessionIdRef.current });

            const revision = savedDocument.revision ?? document.revision;
            if (typeof revision !== 'number') {
                throw new Error('Reload the note before saving a version.');
            }

            const result = await createDocumentVersion(document.id, revision);

            onShowToast(
                result.created ? 'Version saved' : 'No changes since the last version',
                result.created ? 'success' : 'info',
            );
        } catch (err: any) {
            logger.error('Failed to save version', { error: err.message });
            onShowToast(err.message || 'Failed to save version', 'error');
        } finally {
            onSetPublishing(false);
            isSavingRef.current = false;
        }
    }, [
        document?.id,
        document?.revision,
        title,
        content,
        tags,
        newAttachments,
        removedAttachments,
        isSavingRef,
        onSave,
        onSetPublishing,
        onShowToast,
        isReadOnly,
    ]);

    const handleCancel = useCallback(() => {
        logger.debug('[DocumentEditor] handleCancel called');
        onReset();
        const fallbackRoute = getDefaultHomepageRoute();
        const previousRoute = getLastNonDocumentRoute();
        const currentRouteWithSearch = `${location.pathname}${location.search}`;
        const nextRoute = previousRoute && previousRoute !== currentRouteWithSearch
            ? previousRoute
            : fallbackRoute;

        logger.debug('[DocumentEditor] Reset called, navigating to previous route', { nextRoute });
        // Use setTimeout to ensure state updates before navigation
        if (cancelNavigateTimeoutRef.current) {
            clearTimeout(cancelNavigateTimeoutRef.current);
        }

        cancelNavigateTimeoutRef.current = setTimeout(() => {
            navigate(nextRoute);
        }, 0);
    }, [onReset, navigate, location.pathname, location.search]);

    return {
        handleSave,
        handlePublish,
        handleCancel,
    };
}
