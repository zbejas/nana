import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { getDocument, type Document } from '../../lib/documents';
import { useDocumentEditor, useSidebar, useToasts } from '../../state/hooks';
import { createLogger } from '../../lib/logger';
import { refreshTriggerAtom } from '../../state/atoms';

const logger = createLogger('DocEditor');
import { type ViewMode } from './EditorHeader';
import {
    useSidebarWidth,
    useAutoSaveDelay,
    setAutoSaveDelay,
    MIN_AUTO_SAVE_DELAY,
} from '../../lib/settings';
import { useDocumentLoader } from './useDocumentLoader';
import { useAutoSave } from './useAutoSave';
import { isSameMarkdown, normalizeMarkdown } from './milkdown/helpers';
import { useAttachmentHandlers } from './useAttachmentHandlers';
import { useDocumentActions } from './useDocumentActions';
import { useDocumentCollaboration } from '../../lib/collaboration/useDocumentCollaboration';
import { setRoomContentAuthority } from '../../lib/documents/save';
import { adoptEditorDocument } from '../../lib/documents/drafts';

export function useDocumentEditorState() {
    const navigate = useNavigate();
    const { id: urlDocumentId } = useParams<{ id: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        selectedDocument: document,
        setSelectedDocument,
        createInFolder: folderId,
        initialTitle,
        initialContent,
        hasUnsavedChanges: globalHasUnsavedChanges,
        creationSessionId,
        save,
        reset,
        setHasUnsavedChanges: setGlobalUnsavedChanges,
        setSaveCallback,
        startNew,
    } = useDocumentEditor();
    const { isOpen: sidebarOpen } = useSidebar();
    const setRefreshTrigger = useSetAtom(refreshTriggerAtom);
    const { showToast: showAppToast } = useToasts();
    const sidebarWidth = useSidebarWidth();
    const autoSaveDelay = useAutoSaveDelay();

    const titleInputRef = useRef<HTMLInputElement>(null);
    const [shouldSelectTitle, setShouldSelectTitle] = useState(false);
    const [title, setTitle] = useState(document?.title || initialTitle || '');
    const [content, setContent] = useState(() => normalizeMarkdown(document?.content || initialContent || ''));
    const [tags, setTags] = useState<string[]>(document?.tags || []);
    const [tagInput, setTagInput] = useState('');
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    // Content can change because this user typed or because a collaborator
    // typed. Only the former belongs in this client's autosave/unsaved state;
    // otherwise every live update makes idle viewers save and flicker.
    const [localContentDirty, setLocalContentDirty] = useState(false);
    // Drives the autosave debounce. Remote text leaves this untouched so a
    // collaborator's keystrokes never reset or schedule this client's timer.
    const [localEditVersion, setLocalEditVersion] = useState(0);
    // The document record whose values are already reflected in local state.
    // Same-ID realtime updates arrive through the atom before the local setters,
    // so dirty comparison must ignore that one committed render.
    const [syncedDocument, setSyncedDocument] = useState<Document | null>(document);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [documentNotFound, setDocumentNotFound] = useState(false);
    const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);

    const MOBILE_EDITOR_HEIGHT = 'calc(100dvh - var(--mobile-navbar-height, calc(72px + env(safe-area-inset-bottom))))';

    const titleRef = useRef(title);
    const contentRef = useRef(content);
    const tagsRef = useRef(tags);
    const prevDocumentIdRef = useRef(document?.id);
    const remoteContentChangeRef = useRef<{ from: string; to: string } | null>(null);
    // Set by the first save of the current /document/new session. The next
    // document id is a promotion, not a switch to another note.
    const promotedDocumentIdRef = useRef<string | null>(null);

    useEffect(() => { titleRef.current = title; }, [title]);
    useEffect(() => { contentRef.current = content; }, [content]);
    useEffect(() => { tagsRef.current = tags; }, [tags]);

    const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
        showAppToast(message, type);
    }, [showAppToast]);

    const isTrashDocument = searchParams.get('trash') === 'true';

    const handleRemoteContent = useCallback((next: string) => {
        const normalized = normalizeMarkdown(next);
        if (normalized === normalizeMarkdown(contentRef.current)) return;
        // Keep the pre-live draft so a later AI edit event can still diff
        // against what was actually on screen.
        remoteContentChangeRef.current = { from: contentRef.current, to: normalized };
        contentRef.current = normalized;
        // Apply the merged Yjs value before returning from the SSE handler.
        // Otherwise the next keystroke can diff against a newer Y.Doc and
        // delete the update that has not reached the editor yet.
        flushSync(() => setContent(normalized));
    }, [setContent]);

    const {
        session: collaborationSession,
        collaborators,
        status: collaborationStatus,
        canEdit: collaborationCanEdit,
        persistence: collaborationPersistence,
        revision: collaborationRevision,
        updateSelection: handleEditorSelection,
        applyLocalContent,
        flushContent,
    } = useDocumentCollaboration({
        documentId: document?.id,
        initialContent: document?.content ?? initialContent ?? '',
        initialRevision: document?.revision ?? 0,
        content,
        enabled: Boolean(document?.id) && !isTrashDocument,
        onRemoteContent: handleRemoteContent,
    });
    const isReadOnly = isTrashDocument || !collaborationCanEdit;
    // The room is the content writer only once it has synced. While it is
    // connecting, offline, or absent (new/trashed notes), autosave keeps the
    // full content path.
    const roomOwnsContent = Boolean(document?.id)
        && !isTrashDocument
        && collaborationStatus === 'connected';
    // While connected, a clean room persistence phase means the body is
    // durable even if the local dirty flag has not re-rendered yet.
    const pendingContentChanges = roomOwnsContent
        ? localContentDirty && collaborationPersistence !== 'clean'
        : localContentDirty;

    // Explicit Save and Save version still call saveDocumentWithMerge(); the
    // registry keeps those paths from writing a body the room already owns.
    useEffect(() => {
        const documentId = document?.id;
        if (!documentId) return;
        setRoomContentAuthority(documentId, roomOwnsContent);
        return () => setRoomContentAuthority(documentId, false);
    }, [document?.id, roomOwnsContent]);

    // Editor input must reach Yjs in the same event as the ProseMirror change,
    // not one React commit later. In live session mode the Source/WYSIWYG
    // bindings own the canonical Y.Text write and call this only to mirror the
    // new value into React state. Applying the same value again here would
    // duplicate every keystroke.
    const bindingOwnsContent = Boolean(collaborationSession);
    const handleContentChange = useCallback((next: string) => {
        const normalized = normalizeMarkdown(next);
        if (!bindingOwnsContent) applyLocalContent(normalized);
        contentRef.current = normalized;
        setLocalContentDirty(true);
        setLocalEditVersion((version) => version + 1);
        setContent(normalized);
    }, [applyLocalContent, bindingOwnsContent]);

    const applyExternalContent = useCallback((next: string) => {
        const normalized = normalizeMarkdown(next);
        applyLocalContent(normalized);
        contentRef.current = normalized;
        setContent(normalized);
    }, [applyLocalContent]);

    // AI edits and restores are explicit persisted writes, so they clear the
    // local draft flag. A PocketBase broadcast uses applyExternalContent below:
    // a stale broadcast must never clear dirty state or edit the autosave
    // sequence.
    const applyPersistedContent = useCallback((next: string) => {
        applyExternalContent(next);
        setLocalContentDirty(false);
    }, [applyExternalContent]);

    const handleSavedDocument = useCallback((
        saved: Document,
        options?: { creationSessionId?: number; preserveContent?: boolean },
    ) => {
        // The first save of this new-note session turns /document/new into a
        // real note. Mark it so the id change adopts the saved record without
        // discarding anything typed while the create request was in flight.
        if (!document && options?.creationSessionId === creationSessionId) {
            promotedDocumentIdRef.current = saved.id;
        }
        if (options?.preserveContent) {
            // A metadata-only save must not rewind the editor to the room's
            // last persisted body. Adopt the record fields it did write and
            // leave the live content alone.
            setSelectedDocument((previous) => {
                if (!previous || previous.id !== saved.id) return previous ?? saved;
                return {
                    ...previous,
                    title: saved.title,
                    slug: saved.slug,
                    tags: saved.tags,
                    attachments: saved.attachments,
                    revision: saved.revision,
                    updated: saved.updated,
                    word_count: saved.word_count,
                    reading_time: saved.reading_time,
                    last_edited_by: saved.last_edited_by,
                    last_edit_source: saved.last_edit_source,
                };
            });
        } else {
            save(saved, options);
        }
        // A room-owned save writes metadata only; its clean ack owns the
        // content dirty flag, so do not clear it from an explicit save.
        if (!roomOwnsContent && isSameMarkdown(contentRef.current, saved.content)) {
            setLocalContentDirty(false);
        }
    }, [save, setSelectedDocument, roomOwnsContent, document, creationSessionId]);

    // The room is authoritative for content, so its clean ack is what clears
    // the local dirty flag. Remote-only text never reached that flag.
    useEffect(() => {
        if (!roomOwnsContent || collaborationPersistence !== 'clean') return;
        setLocalContentDirty(false);
    }, [roomOwnsContent, collaborationPersistence]);

    // A room ack advances the note revision without replacing the editor body.
    useEffect(() => {
        if (!document || collaborationRevision <= 0) return;
        if (collaborationRevision <= (document.revision ?? 0)) return;
        const next = { ...document, revision: collaborationRevision };
        setSelectedDocument(next);
        // Keep the adopted record in sync with the render so the status
        // comparison does not treat the revision-only update as a doc switch.
        setSyncedDocument(next);
    }, [collaborationRevision, document, setSelectedDocument]);

    const { isSavingRef } = useDocumentLoader({
        urlDocumentId,
        document,
        promotedDocumentId: promotedDocumentIdRef.current,
        hasUnsavedChanges: globalHasUnsavedChanges,
        isTrashDocument,
        initialTitle: initialTitle || '',
        initialContent: initialContent || '',
        onSave: handleSavedDocument,
        onReset: reset,
        onShowToast: showToast,
    });

    const {
        newAttachments,
        removedAttachments,
        isDraggingFile,
        isMouseOverEditor,
        isAutoSaving: clientAutoSaving,
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
    } = useAttachmentHandlers({
        document,
        onSave: handleSavedDocument,
        onShowToast: showToast,
    });

    const persistenceNeedsAttention = roomOwnsContent
        && (collaborationPersistence === 'conflict' || collaborationPersistence === 'error');
    const hasUnsavedChangesForDisplay = document && document !== syncedDocument
        ? globalHasUnsavedChanges
        : document
            ? (title.trim() || 'Untitled') !== document.title
                || pendingContentChanges
                || JSON.stringify(tags) !== JSON.stringify(document.tags || [])
                || newAttachments.length > 0
                || removedAttachments.length > 0
                || persistenceNeedsAttention
            : title.trim().length > 0 || content.trim().length > 0 || newAttachments.length > 0;

    useAutoSave({
        urlDocumentId,
        document,
        title,
        content,
        tags,
        newAttachments,
        removedAttachments,
        autoSaveDelayMs: autoSaveDelay,
        hasUnsavedChanges: hasUnsavedChangesForDisplay,
        localEditVersion,
        isReadOnly,
        contentPersistence: roomOwnsContent ? 'room' : 'client',
        folderId,
        creationSessionId,
        isSavingRef,
        onSave: handleSavedDocument,
        onApplyMergedContent: applyExternalContent,
        onSetIsAutoSaving: setIsAutoSaving,
        onShowToast: showToast,
    });

    // Server saving is content persistence for this note. Gate it on local
    // content so a collaborator's write does not make this viewer look busy.
    const serverContentSaving = roomOwnsContent
        && collaborationPersistence === 'saving'
        && localContentDirty;
    const isAutoSaving = clientAutoSaving || serverContentSaving;

    useEffect(() => {
        if (autoSaveDelay < MIN_AUTO_SAVE_DELAY) {
            setAutoSaveDelay(MIN_AUTO_SAVE_DELAY);
        }
    }, [autoSaveDelay]);

    const { handleSave, handlePublish, handleCancel } = useDocumentActions({
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
        onSave: handleSavedDocument,
        onApplyMergedContent: applyExternalContent,
        onFlushContent: flushContent,
        onReset: reset,
        onSetSaving: setSaving,
        onSetPublishing: setPublishing,
        onShowToast: showToast,
        onSetError: setError,
    });

    const handleSaveRef = useRef(handleSave);
    useEffect(() => {
        handleSaveRef.current = handleSave;
    }, [handleSave]);

    useEffect(() => {
        if (searchParams.get('selectTitle') === 'true') {
            setShouldSelectTitle(true);
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete('selectTitle');
            setSearchParams(nextSearchParams, { replace: true });
        }
    }, [urlDocumentId, searchParams, setSearchParams]);

    useEffect(() => {
        if (shouldSelectTitle && !loading && title && titleInputRef.current) {
            const timeoutId = setTimeout(() => {
                titleInputRef.current?.focus();
                titleInputRef.current?.select();
                setShouldSelectTitle(false);
            }, 100);

            return () => clearTimeout(timeoutId);
        }
    }, [shouldSelectTitle, loading, title]);

    const getInitialViewMode = (): ViewMode => {
        if (typeof window === 'undefined') return 'split';
        const saved = localStorage.getItem('editorViewMode') as ViewMode | 'preview' | null;
        if (saved === 'preview') return 'wysiwyg';
        if (saved && ['wysiwyg', 'text', 'split'].includes(saved)) {
            return saved;
        }
        return window.innerWidth < 768 ? 'wysiwyg' : 'split';
    };

    const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode());
    const [headerVisible, setHeaderVisible] = useState(true);
    const headerExpanded = isDesktop || headerVisible;
    // Split is a desktop-only surface. Keep the stored preference untouched
    // while the phone shows the rendered editor, and never expose a toggle
    // step that would land on the inaccessible split state.
    const effectiveViewMode: ViewMode = !isDesktop && viewMode === 'split' ? 'wysiwyg' : viewMode;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!isDesktop && viewMode === 'split') return;
        localStorage.setItem('editorViewMode', viewMode);
    }, [viewMode, isDesktop]);

    useEffect(() => {
        const handleResizeDesktop = () => setIsDesktop(window.innerWidth >= 768);
        window.addEventListener('resize', handleResizeDesktop);
        return () => window.removeEventListener('resize', handleResizeDesktop);
    }, []);

    // ── Synchronous state sync on document switch ──────────────────────
    // Prevents flash of stale content when switching documents.
    // React allows calling setState during render for derived state;
    // it aborts the current render and re-renders immediately with the
    // new values, so the intermediate (stale) state never reaches the DOM.
    const [lastSyncedDocId, setLastSyncedDocId] = useState<string | undefined>(document?.id);
    const [lastSyncedSession, setLastSyncedSession] = useState(creationSessionId);
    // The mounted editor follows the note session, not the raw record id. A
    // first-save promotion (/document/new -> /document/:id) must not remount
    // the editor and lose its scroll/selection/undo history.
    const [editorSurfaceKey, setEditorSurfaceKey] = useState<string>(() => (
        document?.id ? `document:${document.id}` : `new:${creationSessionId}`
    ));
    if (document?.id !== lastSyncedDocId || creationSessionId !== lastSyncedSession) {
        const promotedId = promotedDocumentIdRef.current;
        const isPromotion = Boolean(document?.id && !lastSyncedDocId && promotedId === document.id);
        const adoption = adoptEditorDocument({
            mode: isPromotion ? 'promotion' : document ? 'document' : 'blank',
            document,
            current: { title, content, tags },
            initialTitle: initialTitle || '',
            initialContent: initialContent || '',
        });

        setLastSyncedDocId(document?.id);
        setLastSyncedSession(creationSessionId);
        setSyncedDocument(document);
        remoteContentChangeRef.current = null;
        setTitle(adoption.title);
        setContent(adoption.content);
        setTags(adoption.tags);
        setNewAttachments([]);
        setRemovedAttachments([]);
        setLocalContentDirty(adoption.contentDirty);

        // Keep the promoted id while this note is open so the loader does not
        // race the promotion with a snapshot fetch. It is replaced by the next
        // new-note save or cleared when another document becomes selected.
        if (promotedId && promotedId !== document?.id) promotedDocumentIdRef.current = null;

        const nextEditorKey = isPromotion
            ? editorSurfaceKey
            : document
                ? `document:${document.id}`
                : `new:${creationSessionId}`;
        if (nextEditorKey !== editorSurfaceKey) setEditorSurfaceKey(nextEditorKey);
    }

    useLayoutEffect(() => {
        setGlobalUnsavedChanges(false);
    }, [lastSyncedDocId, lastSyncedSession, setGlobalUnsavedChanges]);

    // Scroll to top when a new document is loaded
    useEffect(() => {
        if (document && document.id === lastSyncedDocId) {
            if (!titleRef.current && !contentRef.current) {
                requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                });
            }
        }
    }, [lastSyncedDocId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Handle realtime updates to the current document (same ID, new data)
    useEffect(() => {
        if (!document || document.id !== urlDocumentId) return;

        // Only handle same-document content updates (ID change is handled above)
        if (document.id !== prevDocumentIdRef.current) {
            prevDocumentIdRef.current = document.id;
            setSyncedDocument(document);
            return;
        }

        // Mark the record as adopted before the dirty comparison runs. If the
        // user has local edits, only the baseline moves; their draft is kept.
        setSyncedDocument(document);

        if (collaborationStatus === 'connected') {
            // The live room owns content while it is connected. A PocketBase
            // broadcast can arrive out of order relative to the Yjs stream and
            // applying it would briefly rewind another user's keystrokes.
            if (!globalHasUnsavedChanges) {
                setTitle(document.title || '');
                setTags(document.tags || []);
            }
            return;
        }

        if (globalHasUnsavedChanges || pendingContentChanges) {
            logger.debug('Skipping realtime state sync - user has unsaved changes');
            return;
        }

        const nextContent = normalizeMarkdown(document.content);
        if (nextContent !== normalizeMarkdown(contentRef.current)) {
            // Keep the pre-realtime draft so an AI-edit event that arrives after
            // the PocketBase broadcast can still diff against what was on screen.
            remoteContentChangeRef.current = { from: contentRef.current, to: nextContent };
        }
        setTitle(document.title || '');
        // A broadcast is not this client's save. Apply its body without
        // touching local dirty state, and never replay it as a local edit.
        applyExternalContent(nextContent);
        setTags(document.tags || []);
    }, [document, urlDocumentId, globalHasUnsavedChanges, pendingContentChanges, collaborationStatus, applyExternalContent]);

    useEffect(() => {
        // The atom can change one render before the realtime effect adopts it.
        // Ignoring that intermediate render prevents a one-frame "Unsaved"
        // flash while the local fields catch up.
        if (document && document !== syncedDocument) return;

        let hasChanges = false;

        if (!document) {
            hasChanges = title.trim().length > 0 || content.trim().length > 0 || newAttachments.length > 0;
        } else {
            // Compare the same values autosave writes. Milkdown strips trailing
            // newlines and the API may return them; treating that as a user edit
            // starts an unsaved/save loop with no visible change.
            const normalizedTitle = title.trim() || 'Untitled';
            hasChanges =
                normalizedTitle !== document.title ||
                pendingContentChanges ||
                JSON.stringify(tags) !== JSON.stringify(document.tags || []) ||
                newAttachments.length > 0 ||
                removedAttachments.length > 0 ||
                persistenceNeedsAttention;
        }


        setGlobalUnsavedChanges(hasChanges);
    }, [title, pendingContentChanges, tags, newAttachments, removedAttachments, document, syncedDocument, setGlobalUnsavedChanges, roomOwnsContent, collaborationPersistence]);

    const contentStats = useMemo(() => {
        const words = content.trim().split(/\s+/).filter((w) => w.length > 0);
        return {
            words: words.length,
            readingTime: Math.ceil(words.length / 200),
            characters: content.length,
        };
    }, [content]);

    const handleAddTag = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            e.preventDefault();
            if (!tags.includes(tagInput.trim())) {
                setTags([...tags, tagInput.trim()]);
            }
            setTagInput('');
        }
    }, [tagInput, tags]);

    const handleRemoveTag = useCallback((tagToRemove: string) => {
        setTags(tags.filter((tag) => tag !== tagToRemove));
    }, [tags]);

    const handleDocumentRestored = useCallback(async () => {
        if (!document?.id) return;

        try {
            const updatedDocument = await getDocument(document.id);
            save(updatedDocument);
            applyPersistedContent(normalizeMarkdown(updatedDocument.content));
            setGlobalUnsavedChanges(false);
            setRefreshTrigger((previous) => previous + 1);
        } catch (err: any) {
            logger.error('Failed to reload document after restore', { error: err.message });
            setError('Failed to reload document. Please refresh the page.');
        }
    }, [document?.id, save, applyPersistedContent, setGlobalUnsavedChanges, setRefreshTrigger]);

    const handleCreateNewFromVersion = useCallback((versionContent: string) => {
        const docName = document?.title || 'Untitled';
        const initialTitle = `${docName}-${new Date().toISOString()}`;
        startNew({ initialContent: versionContent, initialTitle, folderId: document?.folder });
        navigate('/document/new');
    }, [startNew, navigate, document?.title, document?.folder]);

    useEffect(() => {
        setSaveCallback(() => async () => {
            await handleSaveRef.current();
        });
    }, [setSaveCallback]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                e.stopPropagation();
                handleSave();
            }
        };

        window.document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.document.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleSave]);

    const isLoadingDocument = Boolean(
        urlDocumentId
        && urlDocumentId !== 'new'
        && document?.id !== urlDocumentId
        // The first save already selected the new id; do not flash the loading
        // surface (which unmounts the editor) while that atom update settles.
        && promotedDocumentIdRef.current !== urlDocumentId
    );

    return {
        urlDocumentId,
        document,
        setSelectedDocument,
        remoteContentChangeRef,
        sidebarOpen,
        sidebarWidth,
        titleInputRef,
        title,
        setTitle,
        content,
        setContent,
        tags,
        setTags,
        setGlobalUnsavedChanges,
        tagInput,
        setTagInput,
        saving,
        publishing,
        loading,
        error,
        documentNotFound,
        hasUnsavedChanges: hasUnsavedChangesForDisplay,
        isDesktop,
        MOBILE_EDITOR_HEIGHT,
        viewMode: effectiveViewMode,
        setViewMode,
        headerVisible,
        setHeaderVisible,
        headerExpanded,
        isDraggingFile,
        isMouseOverEditor,
        isAutoSaving,
        newAttachments,
        removedAttachments,
        handleAttachmentsChange,
        handleAttachmentRemove,
        handleImmediateAttachmentDelete,
        handleAutoSaveAttachments,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        handleCancel,
        handlePublish,
        handleAddTag,
        handleRemoveTag,
        contentStats,
        handleDocumentRestored,
        handleCreateNewFromVersion,
        isTrashDocument,
        isReadOnly,
        isLoadingDocument,
        editorSurfaceKey,
        collaborationSession,
        collaborators,
        collaborationStatus,
        collaborationPersistence,
        handleEditorSelection,
        handleContentChange,
        flushContent,
        applyExternalContent,
        applyPersistedContent,
    };
}
