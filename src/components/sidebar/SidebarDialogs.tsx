import { ConfirmDialog } from "../ui";

interface SidebarDialogsProps {
  showUnsavedDialog: boolean;
  onUnsavedSave: () => Promise<void>;
  onUnsavedDiscard: () => void;
  onUnsavedCancel: () => void;

  showDeleteDialog: boolean;
  deleteDialogConfig: {
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
  } | null;
  onDeleteCancel: () => void;

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
      <ConfirmDialog
        open={showUnsavedDialog}
        title="Unsaved changes"
        description="Save the current note before leaving?"
        confirmLabel="Save note"
        extraAction={{ label: "Discard", onClick: onUnsavedDiscard, variant: "danger" }}
        onConfirm={() => void onUnsavedSave()}
        onCancel={onUnsavedCancel}
      />

      {deleteDialogConfig && (
        <ConfirmDialog
          open={showDeleteDialog}
          title={deleteDialogConfig.title}
          description={deleteDialogConfig.message}
          confirmLabel="Move to trash"
          tone="danger"
          onConfirm={() => {
            void deleteDialogConfig.onConfirm().finally(onDeleteCancel);
          }}
          onCancel={onDeleteCancel}
        />
      )}

      <ConfirmDialog
        open={showLogoutDialog}
        title="Sign out"
        description="Your local work is synced. You can sign back in at any time."
        confirmLabel="Sign out"
        onConfirm={onLogoutConfirm}
        onCancel={onLogoutCancel}
      />
    </>
  );
}
