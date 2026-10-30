import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { RecordModel } from '../../lib/record-model';
import { CameraIcon, KeyIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import { useToasts } from '../../state/hooks';
import { Avatar, Badge, Button, Card, Field, Input, SectionHeading } from '../ui';

interface AccountTabProps {
  user: RecordModel;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type EditMode = 'profile' | 'password' | null;

export function AccountTab({ user }: AccountTabProps) {
  const { showToast } = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  const [editMode, setEditMode] = useState<EditMode>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar, { thumb: '240x240' }) : null;
  const displayName = user.name || 'Your account';
  const isAdmin = Boolean(user.admin);

  const openProfile = () => {
    setName(user.name || '');
    setEmail(user.email || '');
    setError(null);
    setEditMode((mode) => (mode === 'profile' ? null : 'profile'));
    window.requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  };

  const openPassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setEditMode((mode) => (mode === 'password' ? null : 'password'));
    window.requestAnimationFrame(() => currentPasswordRef.current?.focus({ preventScroll: true }));
  };

  const closeForm = () => {
    if (isSaving) return;
    setEditMode(null);
    setError(null);
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file for your avatar', 'error');
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      showToast('Avatar images must be smaller than 5 MB', 'error');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      await pb.collection('users').update(user.id, formData);
      await pb.collection('users').authRefresh();
      showToast('Avatar updated', 'success');
    } catch {
      showToast('Could not update your avatar', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleProfileSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('A display name is required.');
      nameRef.current?.focus();
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
      setEditMode(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordSave = async (event: FormEvent) => {
    event.preventDefault();
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
      setEditMode(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update your password.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="relative shrink-0">
              <Avatar src={avatarUrl} name={displayName} size="xl" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-surface-raised text-ink-secondary transition-colors hover:border-signal/40 hover:text-signal disabled:opacity-50"
                aria-label="Change avatar"
                title="Change avatar"
              >
                {isUploading ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <CameraIcon className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleAvatarChange(event)}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl leading-tight text-ink">{displayName}</h2>
                <Badge tone={isAdmin ? 'signal' : 'neutral'}>{isAdmin ? 'Administrator' : 'Member'}</Badge>
              </div>
              <p className="mt-1 truncate text-sm text-ink-secondary">{user.email}</p>
              <p className="mt-2 text-xs text-ink-muted">
                Joined{' '}
                {user.created
                  ? new Date(user.created).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
                  : 'recently'}
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            icon={<PencilSquareIcon />}
            onClick={openProfile}
            aria-expanded={editMode === 'profile'}
            className="w-full sm:w-auto"
          >
            {editMode === 'profile' ? 'Close' : 'Edit profile'}
          </Button>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <div>
            <dt className="eyebrow">Display name</dt>
            <dd className="mt-1.5 text-sm text-ink">{user.name || 'Not set'}</dd>
          </div>
          <div>
            <dt className="eyebrow">Email</dt>
            <dd className="mt-1.5 truncate text-sm text-ink">{user.email}</dd>
          </div>
          <div>
            <dt className="eyebrow">Account</dt>
            <dd className="mt-1.5 text-sm text-ink">{user.verified ? 'Verified' : 'Verification pending'}</dd>
          </div>
        </dl>

        {editMode === 'profile' && (
          <form
            onSubmit={(event) => void handleProfileSave(event)}
            className="animate-slideDown mt-6 space-y-4 border-t border-line pt-5"
          >
            <div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Edit profile</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
                Your name is shown across the workspace. Email changes need confirmation.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="account-name">
                <Input
                  id="account-name"
                  ref={nameRef}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (error && event.target.value.trim()) setError(null);
                  }}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>

              <Field
                label="Email"
                htmlFor="account-email"
                hint="A confirmation link is sent before the address changes."
              >
                <Input
                  id="account-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Field>
            </div>

            {error && (
              <p className="text-[12.5px] leading-relaxed text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={closeForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={isSaving}>
                Save profile
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Security"
          description="Update the password used to sign in to this workspace."
          actions={
            <Button
              variant="secondary"
              icon={<KeyIcon />}
              onClick={openPassword}
              aria-expanded={editMode === 'password'}
            >
              {editMode === 'password' ? 'Close' : 'Change password'}
            </Button>
          }
        />

        {editMode === 'password' && (
          <form
            onSubmit={(event) => void handlePasswordSave(event)}
            className="animate-slideDown mt-5 space-y-4 border-t border-line pt-5"
          >
            <p className="text-[12.5px] leading-relaxed text-ink-secondary">
              Use at least 8 characters. You stay signed in after the change.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Current password" htmlFor="account-current-password">
                <Input
                  id="account-current-password"
                  ref={currentPasswordRef}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                    if (error) setError(null);
                  }}
                />
              </Field>

              <Field label="New password" htmlFor="account-new-password">
                <Input
                  id="account-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>

              <Field label="Confirm new password" htmlFor="account-confirm-password">
                <Input
                  id="account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </Field>
            </div>

            {error && (
              <p className="text-[12.5px] leading-relaxed text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={closeForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={isSaving}>
                Update password
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
