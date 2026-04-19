import { useCallback, useState } from 'react';
import type { Document } from '../../lib/documents';
import type { Folder } from '../../lib/folders';
import {
    getDocumentForPublicShare,
    getFolderForPublicShare,
    updateDocumentPublicShare,
    updateFolderPublicShare,
    type PublicShareUpdateOptions,
} from '../../lib/public-sharing';
import { useToasts } from '../../state/hooks';

type PublicShareTarget =
    | { type: 'document'; record: Document }
    | { type: 'folder'; record: Folder };

export function usePublicShareModalState() {
    const { showToast } = useToasts();
    const [target, setTarget] = useState<PublicShareTarget | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const close = useCallback(() => {
        if (isSaving) {
            return;
        }

        setTarget(null);
    }, [isSaving]);

    const openDocument = useCallback(async (documentId: string) => {
        try {
            const record = await getDocumentForPublicShare(documentId);
            setTarget({ type: 'document', record });
        } catch {
            showToast('Failed to load document sharing settings', 'error');
        }
    }, [showToast]);

    const openFolder = useCallback(async (folderId: string) => {
        try {
            const record = await getFolderForPublicShare(folderId);
            setTarget({ type: 'folder', record });
        } catch {
            showToast('Failed to load folder sharing settings', 'error');
        }
    }, [showToast]);

    const save = useCallback(async (options: PublicShareUpdateOptions) => {
        if (!target) {
            return null;
        }

        setIsSaving(true);

        try {
            if (target.type === 'document') {
                const updatedRecord = await updateDocumentPublicShare(target.record, options);
                setTarget({ type: 'document', record: updatedRecord });
                showToast(options.enabled ? 'Public document link saved' : 'Public document link disabled', 'success');
                return updatedRecord;
            }

            const updatedRecord = await updateFolderPublicShare(target.record, options);
            setTarget({ type: 'folder', record: updatedRecord });
            showToast(options.enabled ? 'Public folder saved' : 'Public folder disabled', 'success');
            return updatedRecord;
        } catch {
            showToast('Failed to update public sharing settings', 'error');
            throw new Error('Failed to update public sharing settings');
        } finally {
            setIsSaving(false);
        }
    }, [showToast, target]);

    return {
        target,
        isSaving,
        isOpen: target !== null,
        openDocument,
        openFolder,
        save,
        close,
    };
}