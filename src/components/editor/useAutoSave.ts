import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDocument, updateDocument } from '../../lib/documents';
import {
    saveDocumentMetadataWithRetry,
    saveDocumentWithMerge,
} from '../../lib/documents/save';
import { createLogger } from '../../lib/logger';

const logger = createLogger('AutoSave');
import type { Document } from '../../lib/documents/types';
import { MIN_AUTO_SAVE_DELAY } from '../../lib/settings';
import type { CollabPersistencePhase } from '../../lib/collaboration/protocol';

/**
 * Upper bound for one unsaved burst. The trailing debounce still decides when
 * an idle writer saves; this cap only keeps continuous typing from deferring
 * persistence forever.
 */
export const MAX_AUTO_SAVE_WAIT_MS = 8000;

export type EditorSaveStatus = 'idle' | 'unsaved' | 'saving' | 'error' | 'conflict';

/** Who is allowed to persist the note body. */
export type ContentPersistenceMode = 'client' | 'room';

interface AutoSaveDelayOptions {
    debounceMs: number;
    maxWaitMs: number;
    elapsedMs: number;
}

/**
 * Delay before the next autosave. The trailing debounce wins until the max
 * wait is nearly spent, then the remaining window shrinks the delay to zero.
 */
export function nextAutoSaveDelay({ debounceMs, maxWaitMs, elapsedMs }: AutoSaveDelayOptions): number {
    const debounce = Number.isFinite(debounceMs) ? Math.max(0, debounceMs) : 0;
    const maxWait = Number.isFinite(maxWaitMs) ? Math.max(0, maxWaitMs) : debounce;
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    return Math.max(0, Math.min(debounce, maxWait - elapsed));
}

/**
 * Header indicator state. A save in flight always outranks unsaved text so the
 * label does not fall back to "Unsaved" between a write and its follow-up.
 * Server persistence only raises the indicator when this client has local
 * content pending, so a collaborator's write never looks like our save.
 */
export function resolveEditorSaveStatus({
    autoSaving,
    hasUnsavedChanges,
    persistence,
}: {
    autoSaving: boolean;
    hasUnsavedChanges: boolean;
    persistence?: CollabPersistencePhase;
}): EditorSaveStatus {
    if (persistence === 'conflict') return 'conflict';
    if (persistence === 'error') return 'error';
    if (autoSaving) return 'saving';
    if (persistence === 'saving' && hasUnsavedChanges) return 'saving';
    return hasUnsavedChanges ? 'unsaved' : 'idle';
}

export interface MetadataChangeInput {
    document: Document | null;
    title: string;
    tags: string[];
    newAttachments: File[];
    removedAttachments: string[];
}

/**
 * Metadata is everything autosave still owns while the room persists content.
 * Content-only edits must not schedule a PATCH that repeats the same fields.
 */
export function hasPendingMetadataChanges({
    document,
    title,
    tags,
    newAttachments,
    removedAttachments,
}: MetadataChangeInput): boolean {
    if (!document) return false;
    const normalizedTitle = title.trim() || 'Untitled';
    return normalizedTitle !== document.title
        || JSON.stringify(tags) !== JSON.stringify(document.tags || [])
        || newAttachments.length > 0
        || removedAttachments.length > 0;
}

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
    /** Bumped only by local content edits, never by remote collaboration text. */
    localEditVersion: number;
    isReadOnly?: boolean;
    /** `room` means the live room persists content; this hook only writes metadata. */
    contentPersistence?: ContentPersistenceMode;
    folderId?: string | null;
    creationSessionId: number;
    isSavingRef: React.MutableRefObject<boolean>;
    onSave: (document: Document, options?: {
        creationSessionId?: number;
        preserveContent?: boolean;
    }) => void;
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
    localEditVersion,
    isReadOnly = false,
    contentPersistence = 'client',
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
    // Re-run the debounce after a save settles. Edits made while a save is in
    // flight used to be stranded because the effect bailed out on isSavingRef
    // and a ref change cannot retrigger it.
    const [saveCycle, setSaveCycle] = useState(0);
    const creationSessionIdRef = useRef(creationSessionId);
    const onSaveRef = useRef(onSave);
    const onApplyMergedContentRef = useRef(onApplyMergedContent);
    const onSetIsAutoSavingRef = useRef(onSetIsAutoSaving);
    const onShowToastRef = useRef(onShowToast);
    const navigateRef = useRef(navigate);
    // The timer saves the content that exists when it fires, not the snapshot
    // from the render that scheduled it. Remote text can arrive in between and
    // must be part of the write.
    const contentRef = useRef(content);
    const titleRef = useRef(title);
    const tagsRef = useRef(tags);
    const newAttachmentsRef = useRef(newAttachments);
    const removedAttachmentsRef = useRef(removedAttachments);
    const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
    const documentRef = useRef(document);
    const contentPersistenceRef = useRef(contentPersistence);
    // Start of the current unsaved burst. Reset when a save starts, finishes,
    // fails, or the editor becomes clean.
    const firstUnsavedEditAtRef = useRef<number | null>(null);

    contentRef.current = content;
    titleRef.current = title;
    tagsRef.current = tags;
    newAttachmentsRef.current = newAttachments;
    removedAttachmentsRef.current = removedAttachments;
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    documentRef.current = document;
    contentPersistenceRef.current = contentPersistence;

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
            // Navigation clears timers but keeps the unsaved local draft. The
            // live room has already received every Yjs update this client
            // published; there is no client content-flush endpoint to call.
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
            autoSaveTimerRef.current = null;
        }

        // Don't auto-save if there are no changes
        if (!hasUnsavedChanges) {
            firstUnsavedEditAtRef.current = null;
            onSetIsAutoSavingRef.current(false);
            return;
        }

        if (isReadOnly) {
            firstUnsavedEditAtRef.current = null;
            onSetIsAutoSavingRef.current(false);
            return;
        }

        // With the room connected, autosave owns metadata only. Content-only
        // edits are already queued in Yjs and must not trigger a PATCH.
        const documentAtSchedule = documentRef.current;
        const roomOwnsContent = contentPersistenceRef.current === 'room'
            && urlDocumentId !== 'new'
            && Boolean(documentAtSchedule?.id);
        if (
            roomOwnsContent
            && !hasPendingMetadataChanges({
                document: documentAtSchedule,
                title: titleRef.current,
                tags: tagsRef.current,
                newAttachments: newAttachmentsRef.current,
                removedAttachments: removedAttachmentsRef.current,
            })
        ) {
            firstUnsavedEditAtRef.current = null;
            onSetIsAutoSavingRef.current(false);
            return;
        }

        // Don't auto-save if we're already saving
        if (isSavingRef.current) {
            return;
        }

        // For new documents, require at least a title or content before auto-saving
        if (urlDocumentId === 'new' && !titleRef.current.trim() && !contentRef.current.trim()) {
            return;
        }

        const sanitizedDelay = Math.max(MIN_AUTO_SAVE_DELAY, autoSaveDelayMs);
        const now = Date.now();
        if (firstUnsavedEditAtRef.current === null) {
            firstUnsavedEditAtRef.current = now;
        }
        const delay = nextAutoSaveDelay({
            debounceMs: sanitizedDelay,
            maxWaitMs: MAX_AUTO_SAVE_WAIT_MS,
            elapsedMs: now - firstUnsavedEditAtRef.current,
        });

        // Set up auto-save timer
        const sessionAtStart = creationSessionIdRef.current;
        autoSaveTimerRef.current = setTimeout(async () => {
            autoSaveTimerRef.current = null;
            firstUnsavedEditAtRef.current = null;
            const titleAtSave = titleRef.current;
            const contentAtSave = contentRef.current;
            const tagsAtSave = tagsRef.current;
            const attachmentsAtSave = newAttachmentsRef.current;
            const removedAttachmentsAtSave = removedAttachmentsRef.current;
            const documentAtSave = documentRef.current;
            // Re-read the mode when the timer fires. A room that reconnected
            // after the timer was scheduled must keep content authority.
            const metadataOnlyAtSave = contentPersistenceRef.current === 'room'
                && urlDocumentId !== 'new'
                && Boolean(documentAtSave?.id);
            if (
                metadataOnlyAtSave
                && !hasPendingMetadataChanges({
                    document: documentAtSave,
                    title: titleAtSave,
                    tags: tagsAtSave,
                    newAttachments: attachmentsAtSave,
                    removedAttachments: removedAttachmentsAtSave,
                })
            ) {
                onSetIsAutoSavingRef.current(false);
                return;
            }
            try {
                onSetIsAutoSavingRef.current(true);
                isSavingRef.current = true;
                const saveStartTime = Date.now();

                let savedDocument: Document;
                let metadataOnly = false;

                // Check if we're creating a new document or updating existing
                if (urlDocumentId !== 'new' && documentAtSave?.id) {
                    if (metadataOnlyAtSave) {
                        // The room writes content. Sending the editor body here
                        // would race the room and could overwrite newer text.
                        logger.debug('Auto-saving document metadata only', { id: documentAtSave.id });
                        savedDocument = await saveDocumentMetadataWithRetry({
                            base: documentAtSave,
                            title: titleAtSave.trim() || 'Untitled',
                            tags: tagsAtSave,
                            attachments: attachmentsAtSave,
                            removeAttachments: removedAttachmentsAtSave,
                        });
                        metadataOnly = true;
                        logger.info('Document metadata auto-saved successfully', { id: documentAtSave.id });
                    } else {
                        // Updating existing document
                        logger.debug('Auto-saving existing document', { id: documentAtSave.id });

                        const result = await saveDocumentWithMerge({
                            base: documentAtSave,
                            title: titleAtSave.trim() || 'Untitled',
                            content: contentAtSave,
                            tags: tagsAtSave,
                            attachments: attachmentsAtSave,
                            removeAttachments: removedAttachmentsAtSave,
                            onMergedContent: (merged) => onApplyMergedContentRef.current?.(merged),
                        });
                        savedDocument = result.document;
                        logger.info('Document auto-saved successfully', { id: documentAtSave.id });
                    }
                } else {
                    // Creating new document
                    logger.debug('Auto-saving new document');

                    savedDocument = await createDocument({
                        title: titleAtSave.trim() || 'Untitled',
                        content: contentAtSave.trim(),
                        tags: tagsAtSave,
                        folder: folderId || undefined,
                    });

                    // Upload attachments separately if there are any
                    if (attachmentsAtSave.length > 0) {
                        savedDocument = await updateDocument(savedDocument.id, {
                            attachments: attachmentsAtSave,
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

                if (urlDocumentId !== 'new' || documentAtSave?.id) {
                    onSaveRef.current(savedDocument, {
                        creationSessionId: sessionAtStart,
                        preserveContent: metadataOnly,
                    });
                }

                // Ensure spinner shows for minimum 500ms for better UX
                const elapsedTime = Date.now() - saveStartTime;
                const remainingTime = Math.max(0, 500 - elapsedTime);

                if (autoSaveSpinnerTimerRef.current) {
                    clearTimeout(autoSaveSpinnerTimerRef.current);
                }

                autoSaveSpinnerTimerRef.current = setTimeout(() => {
                    if (!isMountedRef.current) return;
                    // More edits arrived after this save finished. The follow-up
                    // save is already queued, so keep the indicator on instead
                    // of flickering Saving -> Unsaved -> Saving.
                    if (hasUnsavedChangesRef.current) return;
                    onSetIsAutoSavingRef.current(false);
                }, remainingTime);
            } catch (err: any) {
                if (isMountedRef.current) {
                    logger.error('Auto-save failed', { error: err.message });
                    onShowToastRef.current('Failed to auto-save', 'error');
                    firstUnsavedEditAtRef.current = null;
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
                        setSaveCycle((value) => value + 1);
                    }
                }, 200);
            }
        }, delay);

        // Cleanup on unmount or when dependencies change
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, [
        localEditVersion,
        title,
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
        contentPersistence,
        saveCycle,
    ]);
}
