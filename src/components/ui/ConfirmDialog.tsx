import type { ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Button, type ButtonVariant } from './Button';

interface ExtraAction {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  extraAction?: ExtraAction;
}

/**
 * The single confirmation affordance in Nana. Destructive actions use the
 * danger tone, everything else the signal primary. No green "Delete" buttons.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
  busy = false,
  extraAction,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      showClose={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          {extraAction && (
            <Button variant={extraAction.variant ?? 'secondary'} onClick={extraAction.onClick} disabled={busy}>
              {extraAction.label}
            </Button>
          )}
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
