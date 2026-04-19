import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { useEffect, useLayoutEffect, useState, useRef, lazy, Suspense } from "react";
import { useSetAtom } from 'jotai';
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
import { useAuth } from "./lib/auth";

// Lazy load heavy routes for code splitting
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DocumentEditor = lazy(() => import("./components/DocumentEditor"));
const PublicDocumentPage = lazy(() => import("./pages/PublicDocumentPage"));
const PublicFolderPage = lazy(() => import("./pages/PublicFolderPage"));
import { useSidebar, useDocumentEditor, useDocumentData } from "./state/hooks";
import { initialLoadDoneAtom } from './state/atoms';
import { useSidebarWidth, useLowPowerMode, setLastNonDocumentRoute } from "./lib/settings";
import "./index.css";

const MOBILE_ROUTE_ORDER = ['/timeline', '/folders', '/chat', '/settings'] as const;

function getMobileRouteKey(pathname: string): string {
  if (pathname.startsWith('/document/')) return '/document';
  if (pathname.startsWith('/timeline')) return '/timeline';
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
      <div className="h-screen flex items-center justify-center bg-black/40 backdrop-blur-md">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4 mx-auto"></div>
          <p className="text-gray-400">Loading...</p>
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
  const { isOpen: sidebarOpen, isResizing: sidebarResizing } = useSidebar();
  const { reset } = useDocumentEditor();
  const location = useLocation();
  const sidebarWidth = useSidebarWidth();
  const lowPowerMode = useLowPowerMode();
  
  // Initialize data subscriptions ONCE at top level - DO NOT call this hook anywhere else
  // All data is stored in Jotai atoms and accessible from child components
  useDocumentData();

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
  const COMPACT_SIDEBAR_WIDTH = 80;
  const MOBILE_NAVBAR_HEIGHT = 'var(--mobile-navbar-height, calc(72px + env(safe-area-inset-bottom)))';
  const previousMobilePathRef = useRef(location.pathname);

  // Reload app when returning after long inactivity (tab switch, app switch, sleep/wake)
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
      if (inactiveDuration >= INACTIVE_RELOAD_THRESHOLD_MS) {
        window.location.reload();
        return;
      }

      inactiveSinceRef.current = null;
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
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Reset editor state when navigating away from document routes
  useEffect(() => {
    const persistentRoutes = ['/timeline', '/folders', '/chat'];
    if (!location.pathname.startsWith('/document') && !persistentRoutes.includes(location.pathname)) {
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
  const isPublicRoute = location.pathname.startsWith('/public/');

  useEffect(() => {
    document.body.classList.toggle('public-route-active', isPublicRoute);

    return () => {
      document.body.classList.remove('public-route-active');
    };
  }, [isPublicRoute]);

  const shouldShowSidebar = user && !isStandalonePage;
  const isDocumentRoute = location.pathname.startsWith('/document/');
  const isChatRoute = location.pathname.startsWith('/chat');
  const shouldShowInstallPrompt = shouldShowSidebar && !isDocumentRoute;
  const shouldDockSidebar = !isMobile && window.innerWidth >= 1024;
  const routeDirection = isMobile
    ? getMobileRouteDirection(previousMobilePathRef.current, location.pathname)
    : 'none';

  useEffect(() => {
    if (!isMobile || previousMobilePathRef.current === location.pathname) {
      return;
    }

    previousMobilePathRef.current = location.pathname;
  }, [isMobile, location.pathname]);

  const mobileAnimationName = routeDirection === 'left'
    ? 'mobile-route-enter-from-right'
    : routeDirection === 'right'
      ? 'mobile-route-enter-from-left'
      : null;

  return (
    <div className={`${isMobile ? 'h-[100dvh]' : 'h-screen'} w-full flex flex-col`}>
      {/* <NavigationProgress /> */}
      {shouldShowSidebar && <Sidebar />}
      <div 
        className={`w-full min-w-0 flex-1 flex flex-col overflow-x-hidden ${isMobile && (isDocumentRoute || isChatRoute) ? 'overflow-y-hidden' : isPublicRoute ? 'overflow-y-auto' : 'overflow-y-auto md:overflow-hidden'}`}
        style={{
          paddingLeft: shouldShowSidebar && shouldDockSidebar
            ? (sidebarOpen ? `${sidebarWidth}px` : `${COMPACT_SIDEBAR_WIDTH}px`)
            : '0px',
          paddingBottom: shouldShowSidebar && isMobile && !isDocumentRoute ? MOBILE_NAVBAR_HEIGHT : '0px',
          WebkitOverflowScrolling: isMobile ? 'touch' : undefined,
          transition: sidebarResizing ? 'none' : 'padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div
          key={isMobile ? getMobileRouteKey(location.pathname) : 'desktop-routes'}
          className={`${isPublicRoute ? 'min-h-full' : 'h-full'} w-full min-w-0 flex flex-col`}
          style={{
            animation: isMobile && mobileAnimationName
              ? `${mobileAnimationName} 240ms ease-out`
              : undefined,
          }}
        >
          <Suspense fallback={
            <div className="h-screen flex items-center justify-center bg-black/40 backdrop-blur-md">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4 mx-auto"></div>
                <p className="text-gray-400">Loading...</p>
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
              <Route path="/folders" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/trash" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/trash/:trashFolderId" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/shared" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/folders/:folderId" element={<ProtectedRoute><FolderViewPage /></ProtectedRoute>} />
              <Route path="/timeline" element={<ProtectedRoute><TimelinePage /></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              <Route path="/chat/:conversationId" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/settings/:tab" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/document/:id" element={<ProtectedRoute><DocumentEditor /></ProtectedRoute>} />
            </Routes>
          </Suspense>
        </div>
      </div>
      {shouldShowSidebar && isMobile && (
        <div
          className={`md:hidden fixed inset-0 z-[45] bg-black/20 backdrop-blur-sm pointer-events-none transition-opacity duration-200 ease-in-out ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {shouldShowInstallPrompt && <InstallBanner />}
      <ToastHost />
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
