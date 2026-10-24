import { useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useToasts } from '../../../state/hooks';
import { Button, Checkbox, ConfirmDialog, Dialog, Field, IconButton, Input } from '../../ui';

interface EditUserFormProps {
  isOpen: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    admin?: boolean;
  };
  onSubmit: (userData: {
    name: string;
    password?: string;
    oldPassword?: string;
    sendPasswordEmail?: boolean;
    admin?: boolean;
  }) => Promise<void>;
  onRequestEmailChange?: (newEmail: string) => Promise<void>;
  onCancel: () => void;
  isUpdating: boolean;
  isSelfService?: boolean; // If true, requires old password for password changes
  isCurrentUserVerified?: boolean;
}

export function EditUserForm({ isOpen, user, onSubmit, onRequestEmailChange, onCancel, isUpdating, isSelfService = false, isCurrentUserVerified = false }: EditUserFormProps) {
  const [formData, setFormData] = useState({
    name: user.name,
    newEmail: user.email,
    oldPassword: '',
    password: '',
    confirmPassword: '',
    sendPasswordEmail: false,
    admin: user.admin || false,
  });
  const [showEmailChangeConfirm, setShowEmailChangeConfirm] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [temporaryPasswordReveal, setTemporaryPasswordReveal] = useState(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToasts();

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  // Generate random password (12 characters with symbols)
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData((prev) => ({ ...prev, password, confirmPassword: password }));

    if (!showPasswords) {
      setTemporaryPasswordReveal(true);
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
      revealTimeoutRef.current = setTimeout(() => {
        setTemporaryPasswordReveal(false);
      }, 500);
    }
  };

  const hasEmailChanged = formData.newEmail !== user.email;

  const handleEmailChangeRequest = async () => {
    if (!onRequestEmailChange || !hasEmailChanged) return;
    await onRequestEmailChange(formData.newEmail);
    setShowEmailChangeConfirm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords match if password is being changed
    if (formData.password && formData.password !== formData.confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    // Validate old password is provided for self-service password changes
    if (isSelfService && formData.password && !formData.oldPassword) {
      showToast('Please enter your current password', 'error');
      return;
    }

    // Prepare update data
    const updateData: { name: string; password?: string; oldPassword?: string; sendPasswordEmail?: boolean; admin?: boolean } = {
      name: formData.name,
    };

    // Only include password if it's being changed
    if (formData.password) {
      updateData.password = formData.password;
      // Include oldPassword for self-service changes
      if (isSelfService) {
        updateData.oldPassword = formData.oldPassword;
      } else {
        // Include sendPasswordEmail only for admin changes
        updateData.sendPasswordEmail = formData.sendPasswordEmail;
      }
    }

    // Include admin field only when a verified admin is editing another user
    if (!isSelfService && isCurrentUserVerified) {
      updateData.admin = formData.admin;
    }

    await onSubmit(updateData);
  };

  const passwordsDoNotMatch = !!formData.password && formData.password !== formData.confirmPassword;

  return (
    <>
      <Dialog
        open={isOpen}
        onClose={onCancel}
        title="Edit user"
        description={
          isSelfService
            ? 'Update your name, email, or password.'
            : "Update this person's name, email, access, or password."
        }
        size="md"
        initialFocusRef={nameRef}
        closeOnBackdrop={!isUpdating}
        closeOnEsc={!isUpdating}
        showClose={!isUpdating}
        footer={
          <>
            <Button variant="secondary" onClick={onCancel} disabled={isUpdating}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-user-form"
              variant="primary"
              loading={isUpdating}
              disabled={isUpdating || passwordsDoNotMatch}
            >
              {isUpdating ? 'Updating...' : 'Update User'}
            </Button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-5">
          {/* Email Change Section */}
          {onRequestEmailChange && (
            <Field
              label="Email address"
              htmlFor="edit-user-email"
              hint={
                isSelfService
                  ? "You'll receive a confirmation email with a link. You'll need your password to complete the change."
                  : 'User will receive a confirmation email to verify the new address'
              }
            >
              <div className="flex items-start gap-2">
                <Input
                  id="edit-user-email"
                  type="email"
                  value={formData.newEmail}
                  onChange={(e) => setFormData({ ...formData, newEmail: e.target.value })}
                  className="min-w-0 flex-1"
                  placeholder="user@example.com"
                  disabled={isUpdating}
                />
                {hasEmailChanged && (
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    icon={<EnvelopeIcon />}
                    onClick={() => setShowEmailChangeConfirm(true)}
                    disabled={isUpdating}
                  >
                    Send
                  </Button>
                )}
              </div>
            </Field>
          )}

          {/* Name */}
          <Field label="Full name" htmlFor="edit-user-name">
            <Input
              id="edit-user-name"
              ref={nameRef}
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              required
              autoComplete="off"
              disabled={isUpdating}
            />
          </Field>

          {/* Admin Toggle (only for verified admin editing other users) */}
          {!isSelfService && isCurrentUserVerified && (
            <Checkbox
              id="admin-checkbox"
              checked={formData.admin}
              onChange={(checked) => setFormData({ ...formData, admin: checked })}
              disabled={isUpdating}
              label={
                <span className="flex items-center gap-2">
                  <ShieldCheckIcon className="h-4 w-4 text-signal" aria-hidden="true" />
                  Administrator privileges
                </span>
              }
              description={
                <>
                  <ExclamationTriangleIcon
                    className="mr-1 inline h-3.5 w-3.5 text-warning"
                    aria-hidden="true"
                  />
                  Admins have full access to manage users, documents, and system settings.
                </>
              }
            />
          )}

          {/* Password Section */}
          <div className="space-y-4 border-t border-line pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-ink">
                Change password <span className="font-normal text-ink-muted">(optional)</span>
              </h3>
              {!isSelfService && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="[&>svg]:h-3.5 [&>svg]:w-3.5"
                  icon={<ArrowPathIcon />}
                  onClick={generatePassword}
                  disabled={isUpdating}
                  title="Generate random password"
                >
                  Generate
                </Button>
              )}
            </div>

            <div className="space-y-4">
              {/* Current Password (only for self-service) */}
              {isSelfService && (
                <Field
                  label="Current password"
                  htmlFor="edit-user-old-password"
                  hint="Required to change your password"
                >
                  <Input
                    id="edit-user-old-password"
                    type={showPasswords ? 'text' : 'password'}
                    value={formData.oldPassword}
                    onChange={(e) => setFormData({ ...formData, oldPassword: e.target.value })}
                    placeholder="Enter your current password"
                    required={!!formData.password}
                    autoComplete="current-password"
                    disabled={isUpdating}
                  />
                </Field>
              )}

              <Field
                label="New password"
                htmlFor="edit-user-password"
                hint={formData.password ? 'Must be at least 8 characters long' : undefined}
              >
                <div className="relative">
                  <Input
                    id="edit-user-password"
                    type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pr-11"
                    placeholder="Leave blank to keep current password"
                    minLength={8}
                    autoComplete="new-password"
                    disabled={isUpdating}
                  />
                  <IconButton
                    label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                    size="sm"
                    onClick={() => {
                      const nextShow = !showPasswords;
                      setShowPasswords(nextShow);
                      if (nextShow) {
                        setTemporaryPasswordReveal(false);
                        if (revealTimeoutRef.current) {
                          clearTimeout(revealTimeoutRef.current);
                        }
                      }
                    }}
                    disabled={isUpdating}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  >
                    {showPasswords ? <EyeSlashIcon /> : <EyeIcon />}
                  </IconButton>
                </div>
              </Field>

              {formData.password && (
                <Field
                  label="Confirm new password"
                  htmlFor="edit-user-confirm-password"
                  error={passwordsDoNotMatch ? 'Passwords do not match' : undefined}
                >
                  <Input
                    id="edit-user-confirm-password"
                    type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    placeholder="Confirm your new password"
                    required={!!formData.password}
                    minLength={8}
                    disabled={isUpdating}
                  />
                </Field>
              )}

              {/* Send Password Email Checkbox (only for admin) */}
              {!isSelfService && (
                <Checkbox
                  id="edit-user-send-password-email"
                  checked={formData.sendPasswordEmail}
                  onChange={(checked) => setFormData({ ...formData, sendPasswordEmail: checked })}
                  disabled={isUpdating}
                  label="Send password to user via email"
                  description="User will receive an email with their new password"
                />
              )}
            </div>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={isOpen && showEmailChangeConfirm}
        title="Confirm email change request"
        description={
          <>
            Send a confirmation link to{' '}
            <span className="font-medium text-ink">{formData.newEmail}</span>?{' '}
            {isSelfService
              ? "You'll need your password to complete the change."
              : 'The user must click the link in that email to verify the new address.'}
          </>
        }
        confirmLabel={isUpdating ? 'Sending...' : 'Send confirmation'}
        busy={isUpdating}
        onConfirm={() => void handleEmailChangeRequest()}
        onCancel={() => setShowEmailChangeConfirm(false)}
      />
    </>
  );
}
