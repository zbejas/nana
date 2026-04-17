import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { Document } from '../lib/documents';
import type { FolderTreeNode } from '../lib/folders';

// ============================================================================
// UI State Atoms
// ============================================================================

/**
 * Controls sidebar open/closed state
 * Persisted to localStorage
 */
export const sidebarOpenAtom = atomWithStorage<boolean>(
    'sidebar-open',
    true,
    {
        getItem: (key, initialValue) => {
            if (typeof window !== 'undefined' && window.innerWidth < 768) {
                return false;
            }

            const value = localStorage.getItem(key);
            if (value === null) {
                return initialValue;
            }

            try {
                const parsed = JSON.parse(value);
                return typeof parsed === 'boolean' ? parsed : initialValue;
            } catch {
                return initialValue;
            }
        },
        setItem: (key, value) => {
            localStorage.setItem(key, JSON.stringify(value));
        },
        removeItem: (key) => {
            localStorage.removeItem(key);
        }
    },
    { getOnInit: true }
);

/**
 * Tracks if the sidebar is currently being resized
 * Used to disable transitions during resize for smooth performance
 */
export const sidebarResizingAtom = atom(false);

/**
 * Controls which document is currently selected for editing
 */
export const selectedDocumentAtom = atom<Document | null>(null);

/**
 * Indicates if we're in document creation mode
 */
export const isCreatingDocumentAtom = atom(false);

/**
 * Tracks if the current document has unsaved changes
 */
export const hasUnsavedChangesAtom = atom(false);

/**
 * Callback to trigger save from outside the editor
 */
export const saveCallbackAtom = atom<(() => Promise<void>) | null>(null);

/**
 * Folder ID for new document creation (if creating within a folder)
 */
export const createInFolderAtom = atom<string | undefined>(undefined);

/**
 * Initial document title for new document creation
 */
export const initialDocumentTitleAtom = atom<string | undefined>(undefined);

/**
 * Initial document content for new document creation (e.g., from version)
 */
export const initialDocumentContentAtom = atom<string | undefined>(undefined);

/**
 * Monotonically-increasing counter bumped every time a new-document session
 * starts.  Used to detect stale auto-save callbacks that complete after the
 * user has already started another new document.
 */
export const creationSessionIdAtom = atom(0);

// ============================================================================
// Data State Atoms
// ============================================================================

/**
 * Folder tree structure
 */
export const foldersAtom = atom<FolderTreeNode[]>([]);

/**
 * Root-level documents (documents without folders)
 */
export const rootDocumentsAtom = atom<Document[]>([]);

/**
 * Documents organized by folder ID
 */
export const folderDocumentsAtom = atom<Map<string, Document[]>>(new Map());

/**
 * Recent documents (loaded separately for quick access)
 */
export const recentDocumentsAtom = atom<Document[]>([]);

/**
 * Trash documents (soft-deleted)
 */
export const trashDocumentsAtom = atom<Document[]>([]);

/**
 * Trash folders (soft-deleted)
 */
export const trashFoldersAtom = atom<FolderTreeNode[]>([]);

/**
 * Global loading lock to prevent concurrent data fetches
 */
export const isDataLoadingAtom = atom(false);

/**
 * Track if initial data load has completed
 * Stored per-session (cleared on window close)
 */
export const initialLoadDoneAtom = atomWithStorage<boolean>('initial-load-done', false, {
    getItem: (key, initialValue) => {
        const value = sessionStorage.getItem(key);
        if (!value) return initialValue;
        try {
            return JSON.parse(value);
        } catch {
            return initialValue;
        }
    },
    setItem: (key, value) => {
        sessionStorage.setItem(key, JSON.stringify(value));
    },
    removeItem: (key) => {
        sessionStorage.removeItem(key);
    }
});

/**
 * Set of expanded folder IDs
 * Persisted to localStorage
 */
export const expandedFoldersAtom = atomWithStorage<Set<string>>(
    'expanded-folders',
    new Set<string>(),
    {
        getItem: (key, initialValue) => {
            const value = localStorage.getItem(key);
            if (!value) return initialValue;
            try {
                return new Set<string>(JSON.parse(value));
            } catch {
                return initialValue;
            }
        },
        setItem: (key, value) => {
            localStorage.setItem(key, JSON.stringify(Array.from(value)));
        },
        removeItem: (key) => {
            localStorage.removeItem(key);
        }
    }
);

/**
 * Set of expanded trash folder IDs
 * Persisted to localStorage
 */
export const expandedTrashFoldersAtom = atomWithStorage<Set<string>>(
    'expanded-trash-folders',
    new Set<string>(),
    {
        getItem: (key, initialValue) => {
            const value = localStorage.getItem(key);
            if (!value) return initialValue;
            try {
                return new Set<string>(JSON.parse(value));
            } catch {
                return initialValue;
            }
        },
        setItem: (key, value) => {
            localStorage.setItem(key, JSON.stringify(Array.from(value)));
        },
        removeItem: (key) => {
            localStorage.removeItem(key);
        }
    }
);

/**
 * Refresh trigger - increment to trigger data refresh
 */
export const refreshTriggerAtom = atom(0);

/**
 * Incremented whenever a realtime document event is received.
 * Timeline listens to this for silent refreshes.
 */
export const timelineRealtimeTickAtom = atom(0);

/**
 * Set of folder IDs whose documents have been loaded
 * Used for lazy loading - only fetch folder contents when expanded
 */
export const loadedFoldersAtom = atom<Set<string>>(new Set<string>());

/**
 * Set of trash folder IDs whose documents have been loaded
 * Used for lazy loading trash folders
 */
export const loadedTrashFoldersAtom = atom<Set<string>>(new Set<string>());

/**
 * Map of folder IDs currently being loaded
 * Prevents duplicate fetch requests
 */
export const loadingFoldersAtom = atom<Set<string>>(new Set<string>());

/**
 * Map of trash folder IDs currently being loaded
 */
export const loadingTrashFoldersAtom = atom<Set<string>>(new Set<string>());

/**
 * Atom to store the loadFolderDocuments function
 * This is set by useDocumentData and accessed by components
 */
export const loadFolderDocumentsAtom = atom<((folderId: string, isTrash?: boolean) => Promise<void>) | null>(null);

// ============================================================================
// Derived/Action Atoms
// ============================================================================

/**
 * Action atom to reset editor state
 */
export const resetEditorAtom = atom(
    null,
    (_get, set) => {
        set(selectedDocumentAtom, null);
        set(isCreatingDocumentAtom, false);
        set(createInFolderAtom, undefined);
        set(initialDocumentTitleAtom, undefined);
        set(initialDocumentContentAtom, undefined);
    }
);

/**
 * Action atom to start creating a new document
 */
export const startNewDocumentAtom = atom(
    null,
    (get, set, params?: { folderId?: string; initialTitle?: string; initialContent?: string }) => {
        set(selectedDocumentAtom, null);
        set(isCreatingDocumentAtom, true);
        set(creationSessionIdAtom, get(creationSessionIdAtom) + 1);
        set(createInFolderAtom, params?.folderId);
        set(initialDocumentTitleAtom, params?.initialTitle);
        set(initialDocumentContentAtom, params?.initialContent);
    }
);

/**
 * Action atom to select a document for editing
 */
export const selectDocumentAtom = atom(
    null,
    (_get, set, document: Document) => {
        set(selectedDocumentAtom, document);
        set(isCreatingDocumentAtom, false);
        set(createInFolderAtom, undefined);
        set(initialDocumentTitleAtom, undefined);
    }
);

interface SaveDocumentRequest {
    document: Document;
    creationSessionId?: number;
}

/**
 * Action atom to handle document save
 */
export const saveDocumentAtom = atom(
    null,
    (get, set, { document, creationSessionId }: SaveDocumentRequest) => {
        // While creating a new document, only the active creation session is
        // allowed to promote a saved document into the editor. This prevents
        // stale loader/realtime updates from re-selecting the previously open
        // document after the user has switched to /document/new.
        if (get(isCreatingDocumentAtom)) {
            if (
                creationSessionId === undefined ||
                creationSessionId !== get(creationSessionIdAtom)
            ) {
                return;
            }
        }
        set(selectedDocumentAtom, document);
        set(isCreatingDocumentAtom, false);
        set(createInFolderAtom, undefined);
        set(initialDocumentTitleAtom, undefined);
        set(initialDocumentContentAtom, undefined);
        // Don't trigger refresh - real-time subscriptions handle this
    }
);

/**
 * Action atom to toggle folder expansion
 */
export const toggleFolderAtom = atom(
    null,
    async (get, set, folderId: string) => {
        const currentExpanded = await get(expandedFoldersAtom);
        const expanded = new Set(currentExpanded);
        if (expanded.has(folderId)) {
            expanded.delete(folderId);
        } else {
            expanded.add(folderId);
        }
        set(expandedFoldersAtom, expanded);
    }
);

/**
 * Action atom to toggle trash folder expansion
 */
export const toggleTrashFolderAtom = atom(
    null,
    async (get, set, folderId: string) => {
        const currentExpanded = await get(expandedTrashFoldersAtom);
        const expanded = new Set(currentExpanded);
        if (expanded.has(folderId)) {
            expanded.delete(folderId);
        } else {
            expanded.add(folderId);
        }
        set(expandedTrashFoldersAtom, expanded);
    }
);

/**
 * Action atom to toggle sidebar
 */
export const toggleSidebarAtom = atom(
    null,
    (get, set) => {
        set(sidebarOpenAtom, !get(sidebarOpenAtom));
    }
);

// ============================================================================
// Toast State Atoms
// ============================================================================

export type ToastType = 'error' | 'success' | 'info';

export type AppToast = {
    id: number;
    message: string;
    type: ToastType;
};

const MAX_VISIBLE_TOASTS = 3;

export const toastsAtom = atom<AppToast[]>([]);
export const nextToastIdAtom = atom(1);

export const showToastAtom = atom(
    null,
    (get, set, payload: { message: string; type?: ToastType }) => {
        const message = payload.message.trim();
        if (!message) {
            return;
        }

        const type = payload.type || 'info';
        const currentToasts = get(toastsAtom);
        const alreadyVisible = currentToasts.some((toast) => toast.message === message && toast.type === type);
        if (alreadyVisible) {
            return;
        }

        const id = get(nextToastIdAtom);
        const nextToasts = [...currentToasts, { id, message, type }];
        const visibleToasts = nextToasts.length > MAX_VISIBLE_TOASTS
            ? nextToasts.slice(nextToasts.length - MAX_VISIBLE_TOASTS)
            : nextToasts;

        set(nextToastIdAtom, id + 1);
        set(toastsAtom, visibleToasts);
    }
);

export const removeToastAtom = atom(
    null,
    (get, set, id: number) => {
        set(
            toastsAtom,
            get(toastsAtom).filter((toast) => toast.id !== id)
        );
    }
);
