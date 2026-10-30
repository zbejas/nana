import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import {
  ChatBubbleLeftRightIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { SegmentedControl, Sheet, cn } from '../ui';
import {
  chatDockHistoryOpenAtom,
  chatDockOpenAtom,
  chatDockResizingAtom,
  sidebarOpenAtom,
} from '../../state/atoms';
import { CHAT_HISTORY_WIDTH, MIN_CHAT_DOCK_WIDTH } from '../../lib/settings';
import { ChatDockResizeHandle } from './ChatDockResizeHandle';
import { NanaMark } from './NanaMark';
import { ChatHistory } from './ChatHistory';
import { ChatThread } from './ChatThread';
import { getAiEditing, setAiEditing } from '../../lib/chat/presence';
import {
  refreshStatus,
  setActiveConversation,
  setChatMode,
  startNewConversation,
  useChatStore,
} from '../../lib/chat/store';
import { useChatViewportHeight, useIsMobileChat } from '../../lib/chat/viewport';

interface ChatDockProps {
  /** Total dock width. Includes the history column when it is open. */
  width: number;
  /** Maximum dock width at the current viewport size. */
  maxWidth: number;
}

/**
 * The one persistent chat surface. Mounted in AppContent outside the keyed
 * route tree, so changing pages never unmounts the conversation or stream.
 */
export function ChatDock({ width, maxWidth }: ChatDockProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobileChat();
  const [open, setOpen] = useAtom(chatDockOpenAtom);
  const [historyOpen, setHistoryOpen] = useAtom(chatDockHistoryOpenAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [resizing, setResizing] = useAtom(chatDockResizingAtom);
  const conversationIdAtom = useChatStore((snapshot) => snapshot.conversationId);
  const mode = useChatStore((snapshot) => snapshot.mode);
  const status = useChatStore((snapshot) => snapshot.status);
  const statusLoading = useChatStore((snapshot) => snapshot.statusLoading);
  const statusError = useChatStore((snapshot) => snapshot.statusError);
  const editing = useChatStore((snapshot) => snapshot.editing);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const lastConversationAtom = useRef<string | null>(null);

  const isChatRoute = location.pathname.startsWith('/chat');
  const visible = open && !isChatRoute;
  const viewportHeight = useChatViewportHeight(isMobile && visible);
  const historyVisible = historyOpen && !isMobile;
  const historyWidth = historyVisible ? CHAT_HISTORY_WIDTH : 0;
  const baseWidth = Math.max(MIN_CHAT_DOCK_WIDTH, width - historyWidth);
  const maxBaseWidth = Math.max(MIN_CHAT_DOCK_WIDTH, maxWidth - historyWidth);

  const handleResizeStart = useCallback(() => setResizing(true), [setResizing]);
  const handleResizeEnd = useCallback(() => setResizing(false), [setResizing]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (visible) setFocusSignal((value) => value + 1);
  }, [visible]);

  // A full-width mobile dock and the sidebar overlay cannot both own the
  // screen. Opening the dock dismisses the navigation drawer.
  useEffect(() => {
    if (isMobile && visible && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, visible, sidebarOpen, setSidebarOpen]);

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      if (!status && !statusLoading) void refreshStatus();
    } else {
      setHistoryOpen(false);
      setHistorySheetOpen(false);
      const restore = previousFocus.current;
      if (restore && document.contains(restore)) {
        restore.focus({ preventScroll: true });
      }
    }
    // status/statusLoading are intentionally read at toggle time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Rehydrate the persisted conversation when the dock is opened.
  useEffect(() => {
    if (!open) return;
    const persisted = conversationIdAtom;
    if (persisted && lastConversationAtom.current !== persisted) {
      lastConversationAtom.current = persisted;
      setActiveConversation(persisted);
    }
  }, [open, conversationIdAtom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return;
      if (document.querySelector('[data-dialog-layer]')) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!visible) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-dialog-layer]')) return;
      const active = document.activeElement;
      if (!panelRef.current || !active || !panelRef.current.contains(active)) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [visible, setOpen]);

  // Mirror the store's write activity into the shared editor presence API.
  useEffect(() => {
    if (!editing) {
      const recentEdit = getAiEditing();
      if (recentEdit?.targetId && Date.now() - recentEdit.startedAt < 3000) {
        return;
      }
      setAiEditing(null);
      return;
    }
    setAiEditing({
      ...(editing.targetType ? { targetType: editing.targetType } : {}),
      ...(editing.targetId ? { targetId: editing.targetId } : {}),
      ...(editing.title ? { title: editing.title } : {}),
      ...(conversationIdAtom ? { conversationId: conversationIdAtom } : {}),
      startedAt: Date.now(),
    });
  }, [editing, conversationIdAtom]);

  const close = () => {
    setOpen(false);
    setHistoryOpen(false);
    setHistorySheetOpen(false);
  };

  const newChat = () => {
    startNewConversation();
    setHistorySheetOpen(false);
    setResetSignal((value) => value + 1);
    setFocusSignal((value) => value + 1);
  };

  const openHistory = () => {
    if (isMobile) setHistorySheetOpen(true);
    else setHistoryOpen((value) => !value);
  };

  const selectConversation = (id: string) => {
    setActiveConversation(id);
    setHistorySheetOpen(false);
    setResetSignal((value) => value + 1);
    setFocusSignal((value) => value + 1);
  };

  let statusText = 'Assistant';
  if (status?.configured === false) statusText = 'Not configured';
  else if (status?.model) statusText = status.model;
  else if (statusLoading) statusText = 'Checking status…';
  else if (statusError) statusText = 'Status unavailable';

  const statusDot = status?.configured === false
    ? 'bg-warning'
    : status?.configured === true
      ? 'bg-success'
      : 'bg-ink-muted';

  return (
    <>
      <aside
        id="nana-chat-dock"
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Nana chat"
        aria-hidden={!visible}
        inert={!visible}
        className={cn(
          'fixed bottom-0 right-0 top-0 z-[46] flex max-w-full flex-col border-line bg-surface text-ink transition-[transform,width] duration-200 ease-out',
          isMobile ? 'w-full' : 'border-l shadow-float',
          visible ? 'translate-x-0' : 'pointer-events-none invisible translate-x-full',
        )}
        data-state={visible ? 'open' : 'closed'}
        style={isMobile
          ? {
            width: '100%',
            ...(viewportHeight ? { height: `${viewportHeight}px`, bottom: 0 } : {
              bottom: 'var(--mobile-navbar-height, calc(4.5rem + env(safe-area-inset-bottom)))',
            }),
          }
          : { width: `${width}px`, ...(resizing ? { transition: 'none' } : {}) }}
      >
        {!isMobile && visible && (
          <ChatDockResizeHandle
            width={baseWidth}
            maxWidth={maxBaseWidth}
            onResizeStart={handleResizeStart}
            onResizeEnd={handleResizeEnd}
          />
        )}
        <div className="flex h-full min-h-0 w-full">
          {historyVisible && (
            <div className="hidden w-64 shrink-0 flex-col border-r border-line bg-canvas-deep md:flex">
              <ChatHistory
                activeConversationId={conversationIdAtom}
                onSelect={selectConversation}
                onNewChat={newChat}
                onClose={() => setHistoryOpen(false)}
              />
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="shrink-0 border-b border-line">
              <div className="flex items-center gap-2 px-3 pt-[max(0.625rem,env(safe-area-inset-top))]">
                <NanaMark size={24} />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-semibold leading-none tracking-[-0.015em] text-ink">
                    Nana
                  </h2>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-muted" title={status?.provider ?? undefined}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
                    <span className="truncate">{statusText}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close chat"
                  title="Close chat"
                  className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:h-8 sm:w-8"
                >
                  <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-1 px-3 pb-2.5 pt-2">
                <SegmentedControl
                  label="Chat mode"
                  size="sm"
                  value={mode}
                  onChange={setChatMode}
                  options={[
                    { value: 'edit', label: 'Work', title: 'Work — Nana can read and change folders, notes, boards, and tasks' },
                    { value: 'ask', label: 'Ask', title: 'Ask — Nana only reads notes and boards' },
                  ]}
                />
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={newChat}
                    aria-label="New chat"
                    title="New chat"
                    className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:h-7 sm:w-7"
                  >
                    <PlusIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={openHistory}
                    aria-label="Chat history"
                    title="Chat history"
                    aria-pressed={isMobile ? historySheetOpen : historyOpen}
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-control transition-colors sm:h-7 sm:w-7',
                      (isMobile ? historySheetOpen : historyOpen)
                        ? 'bg-signal-soft text-signal'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                    )}
                  >
                    <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </header>

            <ChatThread
              variant="dock"
              focusSignal={focusSignal}
              resetSignal={resetSignal}
              onOpenSettings={() => {
                setOpen(false);
                navigate('/settings/admin/ai');
              }}
            />
          </div>
        </div>
      </aside>

      {isMobile && (
        <Sheet
          open={historySheetOpen}
          onClose={() => setHistorySheetOpen(false)}
          title="Chat history"
        >
          <div className="h-[70dvh] min-h-0">
            <ChatHistory
              compactHeader
              activeConversationId={conversationIdAtom}
              onSelect={selectConversation}
              onNewChat={newChat}
              onClose={() => setHistorySheetOpen(false)}
            />
          </div>
        </Sheet>
      )}
    </>
  );
}
