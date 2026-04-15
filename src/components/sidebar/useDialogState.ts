import { useState } from 'react';
import type { Document as AppDocument } from '../../lib/documents';

export interface DeleteDialogConfig {
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
}

export function useDialogState() {
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
    const [pendingDocument, setPendingDocument] = useState<AppDocument | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteDialogConfig, setDeleteDialogConfig] = useState<DeleteDialogConfig | null>(null);
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);

    const openDeleteDialog = (config: DeleteDialogConfig) => {
        setDeleteDialogConfig(config);
        setShowDeleteDialog(true);
    };

    const closeDeleteDialog = () => {
        setShowDeleteDialog(false);
        setDeleteDialogConfig(null);
    };

    return {
        // Unsaved dialog
        showUnsavedDialog,
        setShowUnsavedDialog,
        pendingDocument,
        setPendingDocument,
        // Delete dialog
        showDeleteDialog,
        deleteDialogConfig,
        openDeleteDialog,
        closeDeleteDialog,
        // Logout
        showLogoutDialog,
        setShowLogoutDialog,
    };
}
