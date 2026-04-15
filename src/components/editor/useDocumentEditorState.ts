import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getDocument, type Document } from '../../lib/documents';
import { useDocumentEditor, useSidebar, useToasts } from '../../state/hooks';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DocEditor');
import { type ViewMode } from './EditorHeader';
import {
    useSidebarWidth,
    useLowPowerMode,
    useAutoSaveDelay,
    setAutoSaveDelay,
    MIN_AUTO_SAVE_DELAY,
} from '../../lib/settings';
import { useDocumentLoader } from './useDocumentLoader';
import { useAutoSave } from './useAutoSave';
import { useAttachmentHandlers } from './useAttachmentHandlers';
import { useDocumentActions } from './useDocumentActions';

export function useDocumentEditorState() {
    const navigate = useNavigate();
    const { id: urlDocumentId } = useParams<{ id: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        selectedDocument: document,
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
    const { showToast: showAppToast } = useToasts();
    const sidebarWidth = useSidebarWidth();
    const lowPowerMode = useLowPowerMode();
    const autoSaveDelay = useAutoSaveDelay();

    const titleInputRef = useRef<HTMLInputElement>(null);
    const [shouldSelectTitle, setShouldSelectTitle] = useState(false);
    const [title, setTitle] = useState(document?.title || initialTitle || '');
    const [content, setContent] = useState(document?.content || initialContent || '');
    const [tags, setTags] = useState<string[]>(document?.tags || []);
    const [tagInput, setTagInput] = useState('');
    const [published, setPublished] = useState(document?.published || false);
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
    const publishedRef = useRef(published);
    const prevDocumentIdRef = useRef(document?.id);

    useEffect(() => { titleRef.current = title; }, [title]);
    useEffect(() => { contentRef.current = content; }, [content]);
    useEffect(() => { tagsRef.current = tags; }, [tags]);
    useEffect(() => { publishedRef.current = published; }, [published]);

    const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
        showAppToast(message, type);
    }, [showAppToast]);

    const isTrashDocument = searchParams.get('trash') === 'true';

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
        published,
        newAttachments,
        removedAttachments,
        autoSaveDelayMs: autoSaveDelay,
        hasUnsavedChanges,
        isReadOnly: isTrashDocument,
        folderId,
        creationSessionId,
        isSavingRef,
        onSave: save,
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
        published,
        newAttachments,
        removedAttachments,
        folderId,
        isSavingRef,
        onSave: save,
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
        const saved = localStorage.getItem('editorViewMode') as ViewMode | null;
        if (saved && ['text', 'preview', 'split'].includes(saved)) {
            return saved;
        }
        return window.innerWidth < 768 ? 'text' : 'split';
    };

    const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode());
    const [headerVisible, setHeaderVisible] = useState(true);
    const headerExpanded = isDesktop || headerVisible;

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('editorViewMode', viewMode);
        }
    }, [viewMode]);

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

    if (document?.id !== lastSyncedDocId || creationSessionId !== lastSyncedSession) {
        setLastSyncedDocId(document?.id);
        setLastSyncedSession(creationSessionId);

        if (document) {
            setTitle(document.title || '');
            setContent(document.content);
            setTags(document.tags || []);
            setPublished(document.published);
        } else {
            setTitle(initialTitle || '');
            setContent(initialContent || '');
            setTags([]);
            setPublished(false);
        }
        setNewAttachments([]);
        setRemovedAttachments([]);
        setGlobalUnsavedChanges(false);
    }

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
            return;
        }

        if (hasUnsavedChanges) {
            logger.debug('Skipping realtime state sync - user has unsaved changes');
            return;
        }

        setTitle(document.title || '');
        setContent(document.content);
        setTags(document.tags || []);
        setPublished(document.published);
    }, [document, urlDocumentId, hasUnsavedChanges]);

    useEffect(() => {
        let hasChanges = false;

        if (!document) {
            hasChanges = title.trim().length > 0 || content.trim().length > 0 || newAttachments.length > 0;
        } else {
            hasChanges =
                title !== document.title ||
                content !== document.content ||
                published !== document.published ||
                JSON.stringify(tags) !== JSON.stringify(document.tags || []) ||
                newAttachments.length > 0 ||
                removedAttachments.length > 0;
        }

        setGlobalUnsavedChanges(hasChanges);
    }, [title, content, tags, published, newAttachments, removedAttachments, document, setGlobalUnsavedChanges]);

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
        } catch (err: any) {
            logger.error('Failed to reload document after restore', { error: err.message });
            setError('Failed to reload document. Please refresh the page.');
        }
    }, [document?.id, save, setGlobalUnsavedChanges]);

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
        sidebarOpen,
        sidebarWidth,
        lowPowerMode,
        titleInputRef,
        title,
        setTitle,
        content,
        setContent,
        tags,
        setTags,
        tagInput,
        setTagInput,
        published,
        setPublished,
        saving,
        publishing,
        loading,
        error,
        documentNotFound,
        hasUnsavedChanges,
        isDesktop,
        MOBILE_EDITOR_HEIGHT,
        viewMode,
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
        isLoadingDocument,
    };
}
