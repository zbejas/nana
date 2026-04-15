import { useState } from 'react';

export interface InlineInputState {
    type: 'folder' | 'document';
    parentFolderId?: string;
    depth?: number;
}

export function useInlineInputState() {
    const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null);
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

    const clearInlineInput = () => setInlineInput(null);
    const clearRenamingFolder = () => setRenamingFolderId(null);

    return {
        inlineInput,
        setInlineInput,
        clearInlineInput,
        renamingFolderId,
        setRenamingFolderId,
        clearRenamingFolder,
    };
}
