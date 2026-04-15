import { ConfirmDialog } from "../modals/ConfirmDialog";

interface SidebarDialogsProps {
  // Unsaved changes dialog
  showUnsavedDialog: boolean;
  onUnsavedSave: () => Promise<void>;
  onUnsavedDiscard: () => void;
  onUnsavedCancel: () => void;

  // Delete confirmation dialog
  showDeleteDialog: boolean;
  deleteDialogConfig: {
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null;
  onDeleteCancel: () => void;

  // Logout dialog
  showLogoutDialog: boolean;
  onLogoutConfirm: () => void;
  onLogoutCancel: () => void;
}

export function SidebarDialogs({
  showUnsavedDialog,
  onUnsavedSave,
  onUnsavedDiscard,
  onUnsavedCancel,
  showDeleteDialog,
  deleteDialogConfig,
  onDeleteCancel,
  showLogoutDialog,
  onLogoutConfirm,
  onLogoutCancel,
}: SidebarDialogsProps) {
  return (
    <>
      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        isOpen={showUnsavedDialog}
        title="Unsaved Changes"
        message="You have unsaved changes in the current document."
        onSave={onUnsavedSave}
        onDiscard={onUnsavedDiscard}
        onCancel={onUnsavedCancel}
        saveLabel="Save"
        discardLabel="Discard"
        cancelLabel="Cancel"
      />

      {/* Delete Confirmation Dialog */}
      {deleteDialogConfig && (
        <ConfirmDialog
          isOpen={showDeleteDialog}
          title={deleteDialogConfig.title}
          message={deleteDialogConfig.message}
          onSave={onDeleteCancel}
          onDiscard={async () => {
            await deleteDialogConfig.onConfirm();
            onDeleteCancel();
          }}
          onCancel={onDeleteCancel}
          saveLabel="Keep"
          discardLabel="Delete"
          cancelLabel=""
        />
      )}

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showLogoutDialog}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        onSave={onLogoutConfirm}
        onDiscard={() => {}}
        onCancel={onLogoutCancel}
        saveLabel="Sign Out"
        discardLabel=""
        cancelLabel="Cancel"
      />
    </>
  );
}
