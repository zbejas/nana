import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
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
        hasUnsavedChanges,
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
        setContent(normalized);
    }, [setContent]);

    const {
        collaborators,
        status: collaborationStatus,
        canEdit: collaborationCanEdit,
        updateSelection: handleEditorSelection,
    } = useDocumentCollaboration({
        documentId: document?.id,
        initialContent: document?.content ?? initialContent ?? '',
        content,
        enabled: Boolean(document?.id) && !isTrashDocument,
        onRemoteContent: handleRemoteContent,
    });
    const isReadOnly = isTrashDocument || !collaborationCanEdit;

    const { isSavingRef } = useDocumentLoader({
        urlDocumentId,
        document,
        hasUnsavedChanges,
        isTrashDocument,
        initialTitle: initialTitle || '',
        initialContent: initialContent || '',
        onSave: save,
        onReset: reset,
        onShowToast: showToast,
    });

    const {
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
    } = useAttachmentHandlers({
        document,
        onSave: save,
        onShowToast: showToast,
    });

    useAutoSave({
        urlDocumentId,
        document,
        title,
        content,
        tags,
        newAttachments,
        removedAttachments,
        autoSaveDelayMs: autoSaveDelay,
        hasUnsavedChanges,
        isReadOnly,
        folderId,
        creationSessionId,
        isSavingRef,
        onSave: save,
        onApplyMergedContent: setContent,
        onSetIsAutoSaving: setIsAutoSaving,
        onShowToast: showToast,
    });

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
        onSave: save,
        onApplyMergedContent: setContent,
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
    // The document record whose values are already reflected in local state.
    // Same-ID realtime updates arrive through the atom before the local setters,
    // so dirty comparison must ignore that one committed render.
    const [syncedDocument, setSyncedDocument] = useState<Document | null>(document);

    if (document?.id !== lastSyncedDocId || creationSessionId !== lastSyncedSession) {
        setLastSyncedDocId(document?.id);
        setLastSyncedSession(creationSessionId);
        setSyncedDocument(document);
        remoteContentChangeRef.current = null;

        if (document) {
            setTitle(document.title || '');
            setContent(normalizeMarkdown(document.content));
            setTags(document.tags || []);
        } else {
            setTitle(initialTitle || '');
            setContent(initialContent || '');
            setTags([]);
        }
        setNewAttachments([]);
        setRemovedAttachments([]);
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
            if (!hasUnsavedChanges) {
                setTitle(document.title || '');
                setTags(document.tags || []);
            }
            return;
        }

        if (hasUnsavedChanges) {
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
        setContent(nextContent);
        setTags(document.tags || []);
    }, [document, urlDocumentId, hasUnsavedChanges, collaborationStatus]);

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
                !isSameMarkdown(content.trim(), document.content.trim()) ||
                JSON.stringify(tags) !== JSON.stringify(document.tags || []) ||
                newAttachments.length > 0 ||
                removedAttachments.length > 0;
        }


        setGlobalUnsavedChanges(hasChanges);
    }, [title, content, tags, newAttachments, removedAttachments, document, syncedDocument, setGlobalUnsavedChanges]);

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
            setGlobalUnsavedChanges(false);
            setRefreshTrigger((previous) => previous + 1);
        } catch (err: any) {
            logger.error('Failed to reload document after restore', { error: err.message });
            setError('Failed to reload document. Please refresh the page.');
        }
    }, [document?.id, save, setGlobalUnsavedChanges, setRefreshTrigger]);

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

    const isLoadingDocument = Boolean(urlDocumentId && urlDocumentId !== 'new' && document?.id !== urlDocumentId);

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
        hasUnsavedChanges,
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
        collaborators,
        collaborationStatus,
        handleEditorSelection,
    };
}
