import { useRef, useState, type ChangeEvent } from 'react';
import type { RecordModel } from 'pocketbase';
import { CameraIcon, KeyIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import { useToasts } from '../../state/hooks';
import { Avatar, Badge, Button, Card, SectionHeading } from '../ui';
import { ProfileDialog } from './ProfileDialog';

interface AccountTabProps {
  user: RecordModel;
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function AccountTab({ user }: AccountTabProps) {
  const { showToast } = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'profile' | 'password'>('profile');
  const [isUploading, setIsUploading] = useState(false);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar, { thumb: '240x240' }) : null;
  const displayName = user.name || 'Your account';
  const isAdmin = Boolean(user.admin);

  const openDialog = (mode: 'profile' | 'password') => {
    setDialogMode(mode);
    setDialogOpen(true);
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

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
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
              <h2 className="font-display text-2xl leading-tight text-ink">{displayName}</h2>
              <Badge tone={isAdmin ? 'signal' : 'neutral'}>{isAdmin ? 'Administrator' : 'Member'}</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">{user.email}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Joined {new Date(user.created).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          </div>

          <Button variant="secondary" icon={<PencilSquareIcon />} onClick={() => openDialog('profile')}>
            Edit profile
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
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Security"
          description="Update the password used to sign in to this workspace."
          actions={
            <Button variant="secondary" icon={<KeyIcon />} onClick={() => openDialog('password')}>
              Change password
            </Button>
          }
        />
      </Card>

      <ProfileDialog
        open={dialogOpen}
        user={user}
        initialMode={dialogMode}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
