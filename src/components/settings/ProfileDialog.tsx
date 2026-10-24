import { useEffect, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import { pb } from '../../lib/pocketbase';
import { useToasts } from '../../state/hooks';
import { Button, Dialog, Field, Input, SegmentedControl } from '../ui';

type ProfileMode = 'profile' | 'password';

interface ProfileDialogProps {
  open: boolean;
  user: RecordModel;
  initialMode?: ProfileMode;
  onClose: () => void;
}

export function ProfileDialog({ open, user, initialMode = 'profile', onClose }: ProfileDialogProps) {
  const { showToast } = useToasts();
  const [mode, setMode] = useState<ProfileMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setMode(initialMode);
    setName(user.name || '');
    setEmail(user.email || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setIsSaving(false);
  }, [open, user, initialMode]);

  const handleProfileSave = async () => {
    if (!name.trim()) {
      setError('A display name is required.');
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const profileChanged = name.trim() !== (user.name || '');
      const emailChanged = email.trim().toLowerCase() !== (user.email || '').toLowerCase();

      if (profileChanged) {
        await pb.collection('users').update(user.id, { name: name.trim() });
      }

      if (emailChanged) {
        if (!email.trim() || !email.includes('@')) {
          throw new Error('Enter a valid email address.');
        }
        await pb.collection('users').requestEmailChange(email.trim());
      }

      await pb.collection('users').authRefresh();
      showToast(
        emailChanged ? 'Profile saved. Check your inbox to confirm the new email.' : 'Profile saved',
        'success'
      );
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!currentPassword) {
      setError('Enter your current password.');
      currentPasswordRef.current?.focus();
      return;
    }
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await pb.collection('users').update(user.id, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      });
      await pb.collection('users').authWithPassword(user.email, newPassword);
      showToast('Password updated', 'success');
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your password.');
    } finally {
      setIsSaving(false);
    }
  };

  const isPasswordMode = mode === 'password';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Account"
      title={isPasswordMode ? 'Change password' : 'Edit profile'}
      description={
        isPasswordMode
          ? 'Use at least 8 characters. You stay signed in after the change.'
          : 'Your name is shown across the workspace. Email changes need confirmation.'
      }
      size="md"
      initialFocusRef={isPasswordMode ? currentPasswordRef : nameRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isSaving}
            onClick={() => void (isPasswordMode ? handlePasswordSave() : handleProfileSave())}
          >
            {isPasswordMode ? 'Update password' : 'Save profile'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <SegmentedControl
          label="Edit profile section"
          value={mode}
          onChange={(next) => {
            setMode(next as ProfileMode);
            setError(null);
          }}
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'password', label: 'Password' },
          ]}
        />

        {isPasswordMode ? (
          <div className="space-y-4">
            <Field label="Current password" htmlFor="profile-current-password" error={error}>
              <Input
                id="profile-current-password"
                ref={currentPasswordRef}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field label="New password" htmlFor="profile-new-password">
              <Input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="profile-confirm-password">
              <Input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Display name" htmlFor="profile-name" error={error}>
              <Input
                id="profile-name"
                ref={nameRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </Field>
            <Field label="Email" htmlFor="profile-email" hint="A confirmation link is sent before the address changes.">
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}
