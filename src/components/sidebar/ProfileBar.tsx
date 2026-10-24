import { useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import { Avatar, IconButton } from '../ui';
import { ProfileContextMenu } from './ProfileContextMenu';

interface ProfileBarProps {
  user: RecordModel;
  onSignOut: () => void;
  onNavigateSettings?: () => void;
}

export function ProfileBar({ user, onSignOut, onNavigateSettings }: ProfileBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLButtonElement>(null);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;
  const anchorRect = profileRef.current?.getBoundingClientRect() ?? null;

  return (
    <div className="border-t border-line p-2.5">
      <div className="flex items-center gap-1">
        <button
          ref={profileRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-raised"
          aria-label="Profile menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Avatar src={avatarUrl} name={user.name || user.email} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-ink">
              {user.name || 'User'}
            </span>
            <span className="block truncate text-[11px] leading-tight text-ink-muted">{user.email}</span>
          </span>
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {onNavigateSettings && (
          <IconButton label="Settings" size="sm" onClick={onNavigateSettings}>
            <Cog6ToothIcon />
          </IconButton>
        )}
      </div>

      <ProfileContextMenu
        isOpen={menuOpen}
        anchorRect={anchorRect}
        onClose={() => setMenuOpen(false)}
        onSignOut={onSignOut}
        onSettings={onNavigateSettings}
        position="above"
      />
    </div>
  );
}
