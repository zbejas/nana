import { useAtom, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import {
    selectedDocumentAtom,
    isCreatingDocumentAtom,
    hasUnsavedChangesAtom,
    saveCallbackAtom,
    createInFolderAtom,
    initialDocumentTitleAtom,
    initialDocumentContentAtom,
    creationSessionIdAtom,
    resetEditorAtom,
    startNewDocumentAtom,
    selectDocumentAtom,
    saveDocumentAtom,
} from '../atoms';
import type { Document } from '../../lib/documents/types';

/**
 * Hook for document editor state and actions
 */
export function useDocumentEditor() {
    const [selectedDocument, setSelectedDocument] = useAtom(selectedDocumentAtom);
    const [isCreating, setIsCreating] = useAtom(isCreatingDocumentAtom);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useAtom(hasUnsavedChangesAtom);
    const [saveCallback, setSaveCallback] = useAtom(saveCallbackAtom);
    const [createInFolder, setCreateInFolder] = useAtom(createInFolderAtom);
    const [initialTitle, setInitialTitle] = useAtom(initialDocumentTitleAtom);
    const [initialContent, setInitialContent] = useAtom(initialDocumentContentAtom);
    const [creationSessionId] = useAtom(creationSessionIdAtom);

    const reset = useSetAtom(resetEditorAtom);
    const startNew = useSetAtom(startNewDocumentAtom);
    const select = useSetAtom(selectDocumentAtom);
    const saveDocument = useSetAtom(saveDocumentAtom);
    const save = useCallback((document: Document, options?: { creationSessionId?: number }) => {
        saveDocument({ document, creationSessionId: options?.creationSessionId });
    }, [saveDocument]);

    return {
        selectedDocument,
        setSelectedDocument,
        isCreating,
        setIsCreating,
        hasUnsavedChanges,
        setHasUnsavedChanges,
        saveCallback,
        setSaveCallback,
        createInFolder,
        setCreateInFolder,
        initialTitle,
        setInitialTitle,
        initialContent,
        setInitialContent,
        creationSessionId,
        // Actions
        reset,
        startNew,
        select,
        save,
    };
}
