import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { RecordModel } from '../../lib/record-model';
import {
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  ChevronRightIcon,
  ClockIcon,
  FolderIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import { Avatar } from '../ui';
import { useAtom } from 'jotai';
import { chatDockOpenAtom } from '../../state/atoms';
import { ProfileContextMenu } from './ProfileContextMenu';
import { BrandMark } from '../BrandMark';

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
];

function isPathActive(currentPath: string, path: string): boolean {
  if (path === '/timeline') {
    return currentPath === '/timeline' || currentPath.startsWith('/board');
  }

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
  const [chatOpen, setChatOpen] = useAtom(chatDockOpenAtom);
  const chatRoute = location.pathname.startsWith('/chat');
  const chatActive = chatRoute || chatOpen;

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;

  const openView = (item: (typeof viewItems)[number]) => {
    navigate(item.path);
  };

  const toggleChat = () => {
    if (chatRoute) return;
    setChatOpen((open) => !open);
  };

  const viewIsActive = (item: (typeof viewItems)[number]) =>
    isPathActive(location.pathname, item.path);
  // Shared, Chat, Settings, and the document reader live behind the drawer.
  // Mark Menu active there instead of leaving the bottom bar with no selection.
  const menuActive = !viewItems.some((item) => viewIsActive(item));

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

  const itemClass = (active: boolean) =>
    `relative flex h-12 w-full flex-col items-center justify-center gap-1 rounded-control text-[11px] font-medium transition-colors ${
      active
        ? 'bg-surface text-ink'
        : 'text-ink-muted hover:bg-surface/70 hover:text-ink'
    }`;

  const railItemClass = (active: boolean) =>
    `flex h-10 w-10 items-center justify-center rounded-control border transition-colors ${
      active
        ? 'border-line bg-surface text-signal'
        : 'border-transparent text-ink-muted hover:bg-surface/70 hover:text-ink'
    }`;

  const chatRailClass = (active: boolean) =>
    `flex h-10 w-10 items-center justify-center rounded-[10px] border transition-colors ${
      active
        ? 'border-signal/45 bg-signal-soft text-signal'
        : 'border-signal/20 bg-signal-soft/30 text-signal hover:border-signal/35 hover:bg-signal-soft/60'
    }`;

  return (
    <>
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-full w-16 flex-col items-center border-r border-line bg-canvas-deep px-2 py-3 transition-opacity duration-200 ease-out md:flex ${
          isExpanded ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        aria-label="Workspace rail"
      >
        <button
          onClick={onToggleExpanded}
          className="mb-5 flex h-10 w-10 items-center justify-center rounded-control transition-colors hover:bg-surface"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <BrandMark className="h-8 w-8" />
        </button>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={toggleChat}
            className={chatRailClass(chatActive)}
            title="Chat"
            aria-label="Chat"
            aria-pressed={chatActive}
          >
            <ChatBubbleLeftRightIcon className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <div className="mx-auto my-1 h-px w-8 bg-line" aria-hidden="true" />
          {viewItems.map((item) => {
            const Icon = item.icon;
            const isActive = viewIsActive(item);

            return (
              <button
                key={item.key}
                onClick={() => openView(item)}
                className={railItemClass(isActive)}
                title={item.label}
                aria-label={item.label}
                aria-current={isPathActive(location.pathname, item.path) ? 'page' : undefined}
              >
                <Icon className="h-[1.15rem] w-[1.15rem]" />
              </button>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            ref={avatarRef}
            onClick={() => setProfileMenuOpen((prev) => !prev)}
            aria-label="Profile menu"
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-90"
          >
            <Avatar src={avatarUrl} name={user.name || user.email} size="sm" />
          </button>
          <button
            onClick={onToggleExpanded}
            className="flex h-9 w-9 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>

        <ProfileContextMenu
          isOpen={profileMenuOpen}
          anchorRect={avatarRef.current?.getBoundingClientRect() ?? null}
          onClose={() => setProfileMenuOpen(false)}
          onSignOut={onRequestSignOut}
          onSettings={onNavigateSettings}
          position="right"
        />
      </aside>

      <nav
        ref={mobileNavRef}
        className={`fixed bottom-0 left-0 right-0 z-[45] border-t border-line bg-canvas-deep px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 transition-opacity duration-200 md:hidden ${
          isExpanded ? 'opacity-30' : 'opacity-100'
        }`}
        aria-label="Primary"
      >
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={onToggleExpanded}
            className={`${itemClass(menuActive)} h-14`}
            aria-label={isExpanded ? "Close menu" : "Open menu"}
            aria-current={menuActive && !isExpanded ? 'page' : undefined}
          >
            {isExpanded ? <XMarkIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
            <span className="leading-none">Menu</span>
          </button>

          {viewItems.map((item) => {
            const Icon = item.icon;
            const isActive = viewIsActive(item);

            return (
              <button
                key={item.key}
                onClick={() => openView(item)}
                className={`${itemClass(isActive)} h-14`}
                aria-label={item.label}
                aria-current={isPathActive(location.pathname, item.path) ? 'page' : undefined}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-signal' : ''}`} />
                <span className="leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
