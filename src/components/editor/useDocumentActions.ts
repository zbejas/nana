import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createDocument, updateDocument } from '../../lib/documents';
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
    published: boolean;
    newAttachments: File[];
    removedAttachments: string[];
    folderId?: string | null;
    isReadOnly: boolean;
    isSavingRef: React.MutableRefObject<boolean>;
    onSave: (document: Document) => void;
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
    published,
    newAttachments,
    removedAttachments,
    folderId,
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
            const saveTitle = title.trim() || 'Untitled';
            let savedDocument: Document;

            // Check if we're creating a new document or updating existing
            if (urlDocumentId !== 'new' && document?.id) {
                savedDocument = await updateDocument(document.id, {
                    title: saveTitle,
                    content: content.trim(),
                    tags,
                    published,
                    attachments: newAttachments.length > 0 ? newAttachments : undefined,
                    removeAttachments: removedAttachments.length > 0 ? removedAttachments : undefined,
                });
                logger.info('Document saved successfully', { id: document.id });
            } else {
                savedDocument = await createDocument({
                    title: saveTitle,
                    content: content.trim(),
                    tags,
                    published,
                    folder: folderId || undefined,
                });

                // Upload attachments separately if there are any
                if (newAttachments.length > 0) {
                    savedDocument = await updateDocument(savedDocument.id, {
                        attachments: newAttachments,
                    });
                }

                logger.info('New document created', { id: savedDocument.id });
            }

            // Update the global state with saved document
            onSave(savedDocument);

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
        published,
        newAttachments,
        removedAttachments,
        document,
        folderId,
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
            onShowToast('Save the document first before publishing', 'error');
            return;
        }

        onSetPublishing(true);
        isSavingRef.current = true;

        try {
            // Update with published=true flag
            // PocketBase hook will create version and reset flag automatically
            const publishedDocument = await updateDocument(document.id, {
                title: title.trim() || 'Untitled',
                content: content.trim(),
                tags,
                published: true,
                attachments: newAttachments.length > 0 ? newAttachments : undefined,
                removeAttachments: removedAttachments.length > 0 ? removedAttachments : undefined,
            });

            // Update global state
            onSave(publishedDocument);

            onShowToast('Version published successfully', 'success');
        } catch (err: any) {
            logger.error('Failed to publish version', { error: err.message });
            onShowToast(err.message || 'Failed to publish version', 'error');
        } finally {
            onSetPublishing(false);
            isSavingRef.current = false;
        }
    }, [
        document?.id,
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
