import { useRef, useState, useCallback } from 'react';
import type { RecordModel } from 'pocketbase';
import { pb } from '../../lib/pocketbase';
import { ProfileContextMenu } from './ProfileContextMenu';

interface ProfileBarProps {
  user: RecordModel;
  onSignOut: () => void;
  onNavigateSettings?: () => void;
}

export function ProfileBar({ user, onSignOut, onNavigateSettings }: ProfileBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;
  const initials = user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  const handleProfileClick = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const anchorRect = profileRef.current?.getBoundingClientRect() ?? null;

  return (
    <div className="px-3 pt-3 pb-2">
      <div
        ref={profileRef}
        className="flex items-center gap-3 cursor-pointer rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors"
        role="button"
        tabIndex={0}
        onClick={handleProfileClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleProfileClick();
          }
        }}
        aria-label="Profile menu"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gray-700/60 border border-white/10 flex items-center justify-center text-gray-300 font-medium text-xs overflow-hidden flex-shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name || user.email}
              className="w-full h-full object-cover"
            />
          ) : (
            initials
          )}
        </div>

        {/* Name & email */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-200 truncate leading-tight">{user.name || 'User'}</p>
          <p className="text-[11px] text-gray-500 truncate leading-tight">{user.email}</p>
        </div>

        {/* Chevron indicator */}
        <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Profile context menu */}
      <ProfileContextMenu
        isOpen={menuOpen}
        anchorRect={anchorRect}
        onClose={() => setMenuOpen(false)}
        onSignOut={onSignOut}
        onSettings={onNavigateSettings}
        position="below"
      />
    </div>
  );
}
