import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '../../lib/pocketbase';
import { getDocument, getTrashDocument } from '../../lib/documents';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DocLoader');
import type { Document } from '../../lib/documents/types';

interface UseDocumentLoaderOptions {
    urlDocumentId: string | undefined;
    document: Document | null;
    hasUnsavedChanges: boolean;
    isTrashDocument: boolean;
    initialTitle: string;
    initialContent: string;
    onSave: (document: Document) => void;
    onReset: () => void;
    onShowToast: (message: string, type: 'error' | 'success' | 'info') => void;
}

export function useDocumentLoader({
    urlDocumentId,
    document,
    hasUnsavedChanges,
    isTrashDocument,
    initialTitle,
    initialContent,
    onSave,
    onReset,
    onShowToast,
}: UseDocumentLoaderOptions) {
    const navigate = useNavigate();
    const isRedirectingRef = useRef(false);
    const isCheckingForUpdatesRef = useRef(false);
    const isSavingRef = useRef(false);
    const isLoadingRef = useRef(false);

    // Load document from URL parameter if present
    useEffect(() => {
        const loadDocumentFromUrl = async () => {
            // If URL is 'new', we're creating a new document
            if (urlDocumentId === 'new') {
                return;
            }

            // Skip if:
            // - No URL document ID
            // - Document is already loaded with matching ID
            // - Already redirecting from a 404
            // - Already loading
            if (!urlDocumentId || document?.id === urlDocumentId || isRedirectingRef.current || isLoadingRef.current) {
                return;
            }

            // Clear old document immediately to prevent flash
            if (document && document.id !== urlDocumentId) {
                onReset();
            }

            isLoadingRef.current = true;

            try {
                logger.debug('Loading document from URL', { id: urlDocumentId });
                const loadedDocument = isTrashDocument
                    ? await getTrashDocument(urlDocumentId)
                    : await getDocument(urlDocumentId);
                onSave(loadedDocument);
                logger.info('Document loaded from URL', { id: urlDocumentId });
            } catch (err: any) {
                logger.error('Failed to load document from URL', {
                    id: urlDocumentId,
                    error: err.message,
                    status: err.status
                });

                // Check if it's a 404 error - redirect to timeline
                if (err.status === 404) {
                    isRedirectingRef.current = true;
                    onShowToast('Document not found', 'error');
                    onReset();
                    navigate('/timeline');
                    return;
                }

                // For 403 or other errors, show error message
                if (err.status === 403) {
                    onShowToast('You do not have permission to view this document', 'error');
                } else {
                    onShowToast(err.message || 'Failed to load document', 'error');
                }
            } finally {
                isLoadingRef.current = false;
            }
        };

        loadDocumentFromUrl();
    }, [urlDocumentId, document?.id, isTrashDocument, onSave, navigate, onReset, onShowToast]);

    // Real-time subscription for document updates
    const subscriptionIdRef = useRef<string | null>(null);

    // Keep refs in sync for subscription callback
    const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
    const documentRef = useRef(document);
    const onSaveRef = useRef(onSave);
    const onResetRef = useRef(onReset);
    const onShowToastRef = useRef(onShowToast);
    useEffect(() => {
        hasUnsavedChangesRef.current = hasUnsavedChanges;
        documentRef.current = document;
        onSaveRef.current = onSave;
        onResetRef.current = onReset;
        onShowToastRef.current = onShowToast;
    }, [hasUnsavedChanges, document, onSave, onReset, onShowToast]);

    useEffect(() => {
        if (isTrashDocument) {
            subscriptionIdRef.current = null;
            return;
        }

        // Only subscribe if we have a valid URL document ID (not in 'new' mode)
        if (!urlDocumentId || urlDocumentId === 'new') {
            subscriptionIdRef.current = null;
            return;
        }
        if (subscriptionIdRef.current === urlDocumentId) return;
        subscriptionIdRef.current = urlDocumentId;

        logger.debug('Setting up real-time subscription for document', { id: urlDocumentId });

        // Subscribe to this specific document
        pb.collection('documents').subscribe(urlDocumentId, async (e) => {
            logger.debug('Real-time document update received', { id: urlDocumentId, action: e.action });

            // If document was deleted, redirect to timeline
            if (e.action === 'delete') {
                logger.info('Document deleted remotely, redirecting', { id: urlDocumentId });
                onShowToastRef.current('Document was deleted', 'info');
                onResetRef.current();
                navigate('/timeline');
                return;
            }

            // Handle content updates intelligently
            if (e.action === 'update') {
                const updatedDoc = e.record as Document;

                // Skip if user has unsaved changes (they're actively editing)
                if (hasUnsavedChangesRef.current) {
                    logger.debug('Skipping real-time update - user has unsaved changes');
                    return;
                }

                // Skip if we're currently saving (would create a loop)
                if (isSavingRef.current) {
                    logger.debug('Skipping real-time update - currently saving');
                    return;
                }

                // Only reload if timestamp is newer
                const currentDoc = documentRef.current;
                if (currentDoc && updatedDoc.updated !== currentDoc.updated) {
                    logger.info('Document updated remotely, reloading', { id: urlDocumentId });
                    onSaveRef.current(updatedDoc);
                    onShowToastRef.current('Document updated remotely', 'info');
                } else {
                    logger.debug('Skipping real-time update - no timestamp change');
                }
                return;
            }
        });

        // Cleanup subscription on unmount or document change
        return () => {
            logger.debug('Cleaning up document subscription', { id: urlDocumentId });
            pb.collection('documents').unsubscribe(urlDocumentId);
            subscriptionIdRef.current = null;
        };
    }, [urlDocumentId, isTrashDocument, navigate]);

    // Handle tab visibility change - reload document if timestamp changed
    useEffect(() => {
        if (isTrashDocument) return;

        // Only apply to existing documents, not new ones
        if (!urlDocumentId || urlDocumentId === 'new') return;

        const handleVisibilityChange = async () => {
            if (!window.document.hidden) {
                // Skip if already checking
                if (isCheckingForUpdatesRef.current) {
                    logger.debug('Skipping visibility check - already checking');
                    return;
                }

                isCheckingForUpdatesRef.current = true;

                try {
                    // Fetch latest version
                    const latestDoc = await getDocument(urlDocumentId);
                    const currentDoc = documentRef.current;
                    const currentlyHasUnsavedChanges = hasUnsavedChangesRef.current;

                    // Only update if timestamp changed and user doesn't have unsaved changes
                    if (currentDoc && latestDoc.updated !== currentDoc.updated && !currentlyHasUnsavedChanges) {
                        logger.info('Document updated while tab was inactive, reloading', { id: urlDocumentId });
                        onSave(latestDoc);
                        onShowToast('Document updated', 'info');
                    }
                } catch (err: any) {
                    // Silently fail - don't disrupt user if check fails
                    logger.error('Failed to check for updates on visibility change', { error: err.message });
                } finally {
                    isCheckingForUpdatesRef.current = false;
                }
            }
        };

        window.document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [urlDocumentId, isTrashDocument, onSave, onShowToast]);

    return { isSavingRef };
}
