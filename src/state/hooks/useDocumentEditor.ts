import { useAtom, useSetAtom } from 'jotai';
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
    const save = useSetAtom(saveDocumentAtom);

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
