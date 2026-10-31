import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect, useLayoutEffect, useState, useRef, lazy, Suspense } from "react";
import { useAtomValue, useSetAtom } from 'jotai';
import { SignInPage } from "./pages/SignInPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { FolderViewPage } from "./pages/FolderViewPage";
import { TimelinePage } from "./pages/TimelinePage";
import { ChatPage } from "./pages/ChatPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ConfirmEmailChangePage } from "./pages/ConfirmEmailChangePage";
import { Sidebar } from "./components/Sidebar";
import { InstallBanner } from "./components/pwa/InstallBanner";
import { ToastHost } from "./components/ToastHost";
import { AddToBoardHost } from "./components/board/AddToBoardHost";
import { ChatDock } from "./components/chat/ChatDock";
import { useAuth } from "./lib/auth";
import { resetChatStore } from "./lib/chat/store";
import { clearChatContextCaches } from "./lib/chat/context";

// Lazy load heavy routes for code splitting
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const BoardArchivePage = lazy(() => import("./pages/BoardArchivePage"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const SharedPage = lazy(() => import("./pages/SharedPage"));
const SharedFolderPage = lazy(() => import("./pages/SharedFolderPage"));
const DocumentEditor = lazy(() => import("./components/DocumentEditor"));
const PublicDocumentPage = lazy(() => import("./pages/PublicDocumentPage"));
const PublicFolderPage = lazy(() => import("./pages/PublicFolderPage"));
const PublicBoardPage = lazy(() => import("./pages/PublicBoardPage"));
import { useSidebar, useDocumentEditor, useDocumentData } from "./state/hooks";
import {
  chatConversationIdAtom,
  chatDockHistoryOpenAtom,
  chatDockOpenAtom,
  chatDockResizingAtom,
  initialLoadDoneAtom,
} from './state/atoms';
import {
  CHAT_HISTORY_WIDTH,
  MAX_CHAT_DOCK_WIDTH,
  MIN_CHAT_DOCK_WIDTH,
  setLastNonDocumentRoute,
  useChatDockWidth,
  useSidebarWidth,
} from "./lib/settings";
import "./index.css";

const MOBILE_ROUTE_ORDER = ['/timeline', '/folders', '/chat', '/settings'] as const;

function getMobileRouteKey(pathname: string): string {
  if (pathname.startsWith('/document/')) return '/document';
  if (pathname.startsWith('/timeline')) return '/timeline';
  if (pathname.startsWith('/board')) return '/timeline';
  if (pathname.startsWith('/folders')) return '/folders';
  if (pathname.startsWith('/chat')) return '/chat';
  if (pathname.startsWith('/settings')) return '/settings';
  return pathname;
}

function getMobileRouteDirection(previousPath: string, currentPath: string): 'left' | 'right' | 'none' {
  const previousKey = getMobileRouteKey(previousPath);
  const currentKey = getMobileRouteKey(currentPath);

  if (previousKey === currentKey) {
    return 'none';
  }

  const previousIndex = MOBILE_ROUTE_ORDER.indexOf(previousKey as (typeof MOBILE_ROUTE_ORDER)[number]);
  const currentIndex = MOBILE_ROUTE_ORDER.indexOf(currentKey as (typeof MOBILE_ROUTE_ORDER)[number]);

  if (previousIndex === -1 || currentIndex === -1) {
    return 'none';
  }

  return currentIndex > previousIndex ? 'left' : 'right';
}

// Protected route wrapper component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
          <p className="text-sm text-ink-muted">Opening your workspace…</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
}

function AppContent() {
  const { user } = useAuth();
  const setInitialLoadDone = useSetAtom(initialLoadDoneAtom);
  const { isOpen: sidebarOpen, isResizing: sidebarResizing, toggle: toggleSidebar } = useSidebar();
  const { reset } = useDocumentEditor();
  const location = useLocation();
  const sidebarWidth = useSidebarWidth();
  const chatDockBaseWidth = useChatDockWidth();
  const chatDockOpen = useAtomValue(chatDockOpenAtom);
  const chatDockHistoryOpen = useAtomValue(chatDockHistoryOpenAtom);
  const chatDockResizing = useAtomValue(chatDockResizingAtom);
  const setChatDockOpen = useSetAtom(chatDockOpenAtom);
  const setChatConversationId = useSetAtom(chatConversationIdAtom);

  // Detect public routes early — skip authenticated data loading on public pages
  const isPublicRoute = location.pathname.startsWith('/public/');

  // Initialize data subscriptions ONCE at top level - DO NOT call this hook anywhere else
  // All data is stored in Jotai atoms and accessible from child components
  useDocumentData({ enabled: !isPublicRoute });

  // Ensure startup-dependent pages (like timeline) wait for a fresh init cycle
  // before running their initial fetches.
  useLayoutEffect(() => {
    if (!user?.id) {
      return;
    }

    setInitialLoadDone(false);
  }, [user?.id, setInitialLoadDone]);

  // Detect mobile viewport
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const COMPACT_SIDEBAR_WIDTH = 64;
  const MOBILE_NAVBAR_HEIGHT = 'var(--mobile-navbar-height, calc(64px + env(safe-area-inset-bottom)))';
  const previousMobilePathRef = useRef(location.pathname);
  const previousUserIdRef = useRef<string | null>(user?.id ?? null);

  // Reload app when returning after long inactivity (tab switch, app switch, sleep/wake)
  // Only applies to the document editor — other pages stay fresh via realtime subscriptions
  const isDocumentRouteRef = useRef(location.pathname.startsWith('/document/'));
  useEffect(() => {
    isDocumentRouteRef.current = location.pathname.startsWith('/document/');
  }, [location.pathname]);

  const inactiveSinceRef = useRef<number | null>(null);
  const INACTIVE_RELOAD_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    const markInactive = () => {
      if (!inactiveSinceRef.current) {
        inactiveSinceRef.current = Date.now();
      }
    };

    const maybeReloadAfterInactivity = () => {
      if (!user) return;
      const inactiveSince = inactiveSinceRef.current;
      if (!inactiveSince) return;

      const inactiveDuration = Date.now() - inactiveSince;
      inactiveSinceRef.current = null;

      if (inactiveDuration >= INACTIVE_RELOAD_THRESHOLD_MS && isDocumentRouteRef.current) {
        window.location.reload();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        markInactive();
        return;
      }

      maybeReloadAfterInactivity();
    };

    const handleWindowBlur = () => markInactive();
    const handleWindowFocus = () => maybeReloadAfterInactivity();
    const handlePageHide = () => markInactive();
    const handlePageShow = () => maybeReloadAfterInactivity();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [user]);

  // Listen for viewport changes
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Reset editor state when navigating away from document routes
  useEffect(() => {
    const persistentRoutes = ['/timeline', '/folders', '/chat'];
    const isPersistentRoute =
      persistentRoutes.includes(location.pathname) || location.pathname.startsWith('/board');

    if (!location.pathname.startsWith('/document') && !isPersistentRoute) {
      reset();
    }
  }, [location.pathname, reset]);

  // Track the latest non-document route so editor close can return there
  useEffect(() => {
    if (!user || location.pathname.startsWith('/document/')) {
      return;
    }

    setLastNonDocumentRoute(`${location.pathname}${location.search}`);
  }, [user, location.pathname, location.search]);

  // Hide sidebar on standalone pages (reset, etc.)
  const isStandalonePage = [
    '/reset-password',
    '/confirm-email-change',
    '/onboarding',
    '/'
  ].includes(location.pathname) || location.pathname.startsWith('/public/');


  useEffect(() => {
    document.body.classList.toggle('public-route-active', isPublicRoute);

    return () => {
      document.body.classList.remove('public-route-active');
    };
  }, [isPublicRoute]);

  // Chat state belongs to one account. Signing out (or switching accounts)
  // drops the conversation, its stream, and the persisted dock preference.
  useEffect(() => {
    const previous = previousUserIdRef.current;
    const current = user?.id ?? null;
    if (previous && previous !== current) {
      resetChatStore();
      clearChatContextCaches();
      setChatDockOpen(false);
      setChatConversationId(null);
    }
    previousUserIdRef.current = current;
  }, [user?.id, setChatDockOpen, setChatConversationId]);

  const isDocumentRoute = location.pathname.startsWith('/document/');
  const isChatRoute = location.pathname.startsWith('/chat');
  const shouldShowSidebar = user && !isStandalonePage;
  const shouldShowInstallPrompt = shouldShowSidebar && !isDocumentRoute;
  const shouldDockSidebar = !isMobile && viewportWidth >= 1024;
  const showCompactRail = shouldShowSidebar && !isMobile && !sidebarOpen;
  const sidebarInset = shouldShowSidebar && shouldDockSidebar
    ? (sidebarOpen ? sidebarWidth : COMPACT_SIDEBAR_WIDTH)
    : showCompactRail
      ? COMPACT_SIDEBAR_WIDTH
      : 0;

  const chatDockVisible = shouldShowSidebar && chatDockOpen && !isChatRoute && !isPublicRoute;
  const chatDockMinWidth = chatDockHistoryOpen
    ? MIN_CHAT_DOCK_WIDTH + CHAT_HISTORY_WIDTH
    : MIN_CHAT_DOCK_WIDTH;
  // Leave the route at least 480px wide on desktop. The dock may still grow
  // when the sidebar is collapsed or the window is wide.
  const chatDockMaxWidth = Math.min(
    MAX_CHAT_DOCK_WIDTH,
    Math.max(chatDockMinWidth, viewportWidth - sidebarInset - 480),
  );
  const requestedChatDockWidth = chatDockBaseWidth
    + (chatDockHistoryOpen ? CHAT_HISTORY_WIDTH : 0);
  const chatDockWidth = !isMobile && chatDockVisible
    ? Math.min(requestedChatDockWidth, chatDockMaxWidth)
    : 0;
  const routeDirection = isMobile
    ? getMobileRouteDirection(previousMobilePathRef.current, location.pathname)
    : 'none';

  useEffect(() => {
    if (!isMobile || previousMobilePathRef.current === location.pathname) {
      return;
    }

    previousMobilePathRef.current = location.pathname;
  }, [isMobile, location.pathname]);

  // The editor footer is portalled to <body> and pins itself to the viewport
  // edge. A CSS hook lets the dock shift it without editing the footer.
  useEffect(() => {
    document.body.style.setProperty('--nana-chat-dock-width', `${chatDockWidth}px`);
    document.body.dataset.chatDockOpen = chatDockWidth > 0 ? 'true' : 'false';
    return () => {
      delete document.body.dataset.chatDockOpen;
      document.body.style.removeProperty('--nana-chat-dock-width');
    };
  }, [chatDockWidth]);

  const mobileAnimationName = routeDirection === 'left'
    ? 'mobile-route-enter-from-right'
    : routeDirection === 'right'
      ? 'mobile-route-enter-from-left'
      : null;

  return (
    <div className={`${isMobile ? 'h-[100dvh]' : 'h-screen'} flex w-full flex-col bg-canvas`}>
      {/* <NavigationProgress /> */}
      {shouldShowSidebar && <Sidebar />}
      <div 
        className={`flex w-full min-w-0 flex-1 flex-col overflow-x-hidden ${isMobile && (isDocumentRoute || isChatRoute) ? 'overflow-y-hidden' : isPublicRoute ? 'overflow-y-auto' : 'overflow-y-auto md:overflow-hidden'}`}
        style={{
          paddingLeft: `${sidebarInset}px`,
          paddingRight: chatDockWidth > 0 ? `${chatDockWidth}px` : '0px',
          paddingBottom: shouldShowSidebar && isMobile && !isDocumentRoute ? MOBILE_NAVBAR_HEIGHT : '0px',
          transition: sidebarResizing || chatDockResizing
            ? 'none'
            : 'padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding-right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          key={isMobile ? getMobileRouteKey(location.pathname) : 'desktop-routes'}
          className={`${isPublicRoute ? 'min-h-full' : 'h-full'} flex w-full min-w-0 flex-col`}
          style={{
            animation: isMobile && mobileAnimationName
              ? `${mobileAnimationName} 240ms ease-out`
              : undefined,
          }}
        >
          <Suspense fallback={
            <div className="flex h-full items-center justify-center bg-canvas">
              <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
                <p className="text-sm text-ink-muted">Loading…</p>
              </div>
            </div>
          }>
            <Routes>
              <Route path="/" element={<SignInPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/confirm-email-change" element={<ConfirmEmailChangePage />} />
              <Route path="/public/document/:shareToken" element={<PublicDocumentPage />} />
              <Route path="/public/folder/:shareToken" element={<PublicFolderPage />} />
              <Route path="/public/board/:shareToken" element={<PublicBoardPage />} />
              <Route path="/folders" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/trash" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/trash/:trashFolderId" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/shared" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/:folderId" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/shared" element={<ProtectedRoute><SharedPage /></ProtectedRoute>} />
              <Route path="/shared/folders/:folderId" element={<ProtectedRoute><SharedFolderPage /></ProtectedRoute>} />
              <Route path="/timeline" element={<ProtectedRoute><TimelinePage /></ProtectedRoute>} />
              <Route path="/board" element={<Navigate to="/timeline" replace />} />
              <Route path="/board/archive" element={<ProtectedRoute><BoardArchivePage /></ProtectedRoute>} />
              <Route path="/board/:boardId" element={<ProtectedRoute><BoardPage /></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              <Route path="/chat/:conversationId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/settings/:tab" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/settings/:tab/:section" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/document/:id" element={<ProtectedRoute><DocumentEditor /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      {shouldShowSidebar && !shouldDockSidebar && (
        <div
          className={`lg:hidden fixed inset-0 z-[45] bg-scrim transition-opacity duration-200 ease-in-out ${
            sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}
      {shouldShowInstallPrompt && <InstallBanner />}
      <ToastHost />
      <AddToBoardHost />
      {shouldShowSidebar && (
        <ChatDock width={chatDockWidth} maxWidth={chatDockMaxWidth} />
      )}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
