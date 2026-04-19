import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { RecordModel } from 'pocketbase';
import {
  ChevronRightIcon,
  ChevronLeftIcon,
  FolderIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import { ProfileContextMenu } from './ProfileContextMenu';

interface CompactSidebarProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onRequestSignOut: () => void;
  onNavigateSettings: () => void;
  user: RecordModel;
}

const viewItems = [
  { key: 'timeline', label: 'Timeline', path: '/timeline', icon: ClockIcon },
  { key: 'folders', label: 'Folders', path: '/folders', icon: FolderIcon },
  { key: 'chat', label: 'Chat', path: '/chat', icon: ChatBubbleLeftRightIcon },
];

function isPathActive(currentPath: string, path: string): boolean {
  return currentPath === path || currentPath.startsWith(`${path}/`);
}

export function CompactSidebar({
  isExpanded,
  onToggleExpanded,
  onRequestSignOut,
  onNavigateSettings,
  user,
}: CompactSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const mobileNavRef = useRef<HTMLElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;
  const initials = user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  const surfaceClass = 'border-white/10 bg-white/90 dark:bg-black/55 light:bg-white/90 md:bg-black/50 dark:md:bg-black/50 light:md:bg-white/80';

  const mobileNavSurfaceClass = 'border-white/10 bg-white/90 dark:bg-black/55 light:bg-white/90';

  const baseIconButtonClass =
    'flex items-center justify-center rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-white/20';

  const getItemClass = (isActive: boolean) =>
    `${baseIconButtonClass} ${
      isActive
        ? 'bg-white/10 border-white/20 text-white'
        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
    }`;

  const avatarRect = avatarRef.current?.getBoundingClientRect() ?? null;

  useEffect(() => {
    const updateMobileNavHeight = () => {
      const navHeight = mobileNavRef.current?.offsetHeight ?? 72;
      document.documentElement.style.setProperty('--mobile-navbar-height', `${navHeight}px`);
    };

    updateMobileNavHeight();
    window.addEventListener('resize', updateMobileNavHeight);
    window.visualViewport?.addEventListener('resize', updateMobileNavHeight);

    return () => {
      window.removeEventListener('resize', updateMobileNavHeight);
      window.visualViewport?.removeEventListener('resize', updateMobileNavHeight);
    };
  }, [isExpanded]);

  return (
    <>
      {/* Desktop collapsed rail — always rendered, expanded sidebar slides on top */}
      <aside
        className={`hidden md:flex fixed left-0 top-0 h-full w-20 z-40 flex-col border-r md:backdrop-blur-sm px-2 py-3 transition-opacity duration-300 ${surfaceClass} ${
          isExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
          {/* Top: Profile avatar */}
          <div className="w-full mb-3 flex items-center justify-center py-1">
            <button
              ref={avatarRef}
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              className="w-11 h-11 rounded-full bg-gray-700/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-300 font-medium text-sm overflow-hidden hover:border-white/25 hover:bg-gray-600/50 transition-all"
              title={user.name || user.email}
              aria-label="Profile menu"
              aria-expanded={profileMenuOpen}
              aria-haspopup="true"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={user.name || user.email}
                  className="w-full h-full object-cover"
                />
              ) : (
                initials
              )}
            </button>
          </div>

          {/* Middle: View navigation */}
          <div className="flex flex-col gap-2.5">
            {viewItems.map((item) => {
              const Icon = item.icon;
              const isActive = isPathActive(location.pathname, item.path);

              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.path)}
                  className={`${getItemClass(isActive)} h-12 w-full flex-col gap-0.5`}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] leading-none">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-white/10 my-3" />

          {/* Bottom: Expand sidebar toggle */}
          <div className="mt-auto flex flex-col gap-2.5">
            <button
              onClick={onToggleExpanded}
              className={`${getItemClass(false)} h-12 w-full flex-col gap-0.5`}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRightIcon className="w-5 h-5" />
              <span className="text-[10px] leading-none">Expand</span>
            </button>
          </div>

          {/* Profile context menu (positioned to the right of the avatar) */}
          <ProfileContextMenu
            isOpen={profileMenuOpen}
            anchorRect={avatarRect}
            onClose={() => setProfileMenuOpen(false)}
            onSignOut={onRequestSignOut}
            onSettings={onNavigateSettings}
            position="right"
          />
        </aside>

      {/* Mobile bottom nav */}
      <nav
        ref={mobileNavRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-[45] border-t backdrop-blur-sm px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 transition-opacity duration-200 ease-in-out ${mobileNavSurfaceClass} ${isExpanded ? 'opacity-85' : 'opacity-100'}`}
      >
        <div className="grid grid-cols-[2fr_3fr_3fr_3fr] gap-2">
          <button
            onClick={onToggleExpanded}
            className={`${getItemClass(false)} h-14 flex-col gap-0.5`}
            aria-label={isExpanded ? "Close menu" : "Open menu"}
          >
            {isExpanded ? (
              <ChevronLeftIcon className="w-5 h-5" />
            ) : (
              <ChevronRightIcon className="w-5 h-5" />
            )}
            <span className="text-[10px] leading-none">Menu</span>
          </button>

          {viewItems.map((item) => {
            const Icon = item.icon;
            const isActive = isPathActive(location.pathname, item.path);

            return (
              <button
                key={item.key}
                onClick={() => navigate(item.path)}
                className={`${getItemClass(isActive)} h-14 flex-col gap-0.5`}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
