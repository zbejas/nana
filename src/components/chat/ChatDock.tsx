import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import {
  ChatBubbleLeftRightIcon,
  LockClosedIcon,
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
import { ChatScopeTabs, noteChatUnavailableMessage } from './ChatScopeTabs';
import { ChatThread } from './ChatThread';
import { getAiEditing, setAiEditing } from '../../lib/chat/presence';
import {
  getChatSnapshot,
  loadNoteChatStatus,
  refreshStatus,
  setActiveConversation,
  setChatMode,
  setChatScope,
  startNewConversation,
  useChatStore,
} from '../../lib/chat/store';
import { deriveChatContext } from '../../lib/chat/context';
import { useChatViewportHeight, useIsMobileChat } from '../../lib/chat/viewport';
import { findChatModel } from '../../lib/chat/models';
import { useBackToClose } from '../../lib/useBackToClose';
import { useSwipeToClose } from '../../lib/useSwipeToClose';
import {
  CHAT_DOCK_EXIT_FALLBACK_MS,
  beginChatDockExitState,
  closedChatDockExitState,
  completedChatDockExitState,
  openChatDockExitState,
  resolveChatDockEntrance,
  type ChatDockExitState,
} from '../../lib/chatDockMotion';
import { sharingRealtimeTickAtom } from '../../state/sharing';

interface ChatDockProps {
  /** Total dock width. Includes the history column when it is open. */
  width: number;
  /** Maximum dock width at the current viewport size. */
  maxWidth: number;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isHorizontallyScrollable(target: EventTarget | null, panel: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== panel) {
    if (element instanceof HTMLElement) {
      const overflowX = window.getComputedStyle(element).overflowX;
      if (
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay')
        && element.scrollWidth > element.clientWidth + 1
      ) {
        return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}

function isChatDockHidden(panel: HTMLElement): boolean {
  return window.getComputedStyle(panel).visibility === 'hidden';
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
  const conversation = useChatStore((snapshot) => snapshot.conversation);
  const mode = useChatStore((snapshot) => snapshot.mode);
  const scope = useChatStore((snapshot) => snapshot.scope);
  const noteChatStatus = useChatStore((snapshot) => snapshot.noteChatStatus);
  const noteChatLoading = useChatStore((snapshot) => snapshot.noteChatLoading);
  const noteChatError = useChatStore((snapshot) => snapshot.noteChatError);
  const status = useChatStore((snapshot) => snapshot.status);
  const selectedModelId = useChatStore((snapshot) => snapshot.selectedModelId);
  const statusLoading = useChatStore((snapshot) => snapshot.statusLoading);
  const statusError = useChatStore((snapshot) => snapshot.statusError);
  const editing = useChatStore((snapshot) => snapshot.editing);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const visibleRef = useRef(false);
  const previousVisibleRef = useRef<boolean | null>(null);
  const exitStateRef = useRef<ChatDockExitState>(closedChatDockExitState());
  const exitFallbackRef = useRef<number | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const lastConversationAtom = useRef<string | null>(null);
  const previousPathRef = useRef(location.pathname);
  const noteChoice = useRef<Set<string>>(new Set());
  const routeContext = useMemo(
    () => deriveChatContext(location.pathname),
    [location.pathname],
  );
  const noteId = routeContext?.type === 'document' ? routeContext.id : null;
  const previousNoteId = useRef<string | null>(noteId);
  const sharingTick = useAtomValue(sharingRealtimeTickAtom);

  const isChatRoute = location.pathname.startsWith('/chat');
  const visible = open && !isChatRoute;
  visibleRef.current = visible;
  const viewportHeight = useChatViewportHeight(isMobile && visible);
  const historyVisible = historyOpen && !isMobile;
  const historyWidth = historyVisible ? CHAT_HISTORY_WIDTH : 0;
  const baseWidth = Math.max(MIN_CHAT_DOCK_WIDTH, width - historyWidth);
  const maxBaseWidth = Math.max(MIN_CHAT_DOCK_WIDTH, maxWidth - historyWidth);
  const askOnly = scope === 'note' && noteChatStatus?.canEdit === false;
  const noteDisabledReason = noteId
    && scope === 'personal'
    && !noteChatLoading
    && !noteChatStatus?.enabled
    && (noteChatStatus || noteChatError)
    ? noteChatUnavailableMessage(noteChatStatus?.reason ?? null, false, noteChatError)
    : null;

  const handleResizeStart = useCallback(() => setResizing(true), [setResizing]);
  const handleResizeEnd = useCallback(() => setResizing(false), [setResizing]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (visible) setFocusSignal((value) => value + 1);
  }, [visible]);

  // The dock is a right-side panel on desktop and a full-screen surface on a
  // phone. A real pathname change closes it so it cannot cover the newly
  // opened route; mounting on an open route keeps it open.
  useEffect(() => {
    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    if (!isMobile) return;
    setOpen(false);
    setHistoryOpen(false);
    setHistorySheetOpen(false);
  }, [isMobile, location.pathname, setHistoryOpen, setOpen]);

  // The mobile chat surface and the sidebar drawer cannot both own the screen.
  // Opening the dock dismisses the navigation drawer.
  useEffect(() => {
    if (isMobile && visible && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, visible, sidebarOpen, setSidebarOpen]);

  // Back dismisses the history sheet first, then closes the full-screen dock.
  // Returning true keeps the synthetic entry armed for the next Back; closing
  // the dock leaves normal history navigation in place. The dock adopts the
  // mobile menu drawer's guard when chat opens from that drawer.
  useBackToClose(
    isMobile && visible,
    () => {
      if (historySheetOpen) {
        setHistorySheetOpen(false);
        return true;
      }
      setOpen(false);
      setHistoryOpen(false);
      setHistorySheetOpen(false);
      return false;
    },
    true,
    { reuseExisting: true },
  );

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

  // Rehydrate the persisted personal conversation when the dock is opened.
  useEffect(() => {
    if (!open || scope === 'note') return;
    const persisted = conversationIdAtom;
    if (persisted && lastConversationAtom.current !== persisted) {
      lastConversationAtom.current = persisted;
      setActiveConversation(persisted);
    }
  }, [open, conversationIdAtom, scope]);

  // Load shared-chat availability when the note changes or the dock opens.
  // Leaving a note route always returns the dock to the personal chat.
  useEffect(() => {
    const previous = previousNoteId.current;
    previousNoteId.current = noteId;
    if (scope === 'note' && previous !== noteId) {
      setChatScope('personal');
    }
    if (!open || !noteId) return;

    let cancelled = false;
    void loadNoteChatStatus(noteId).then((status) => {
      if (cancelled || !status) return;
      const current = getChatSnapshot();
      if (current.scope !== 'personal') return;
      if (noteChoice.current.has(noteId) && (status.enabled || status.conversation)) {
        setChatScope('note');
      }
    });

    return () => {
      cancelled = true;
    };
    // scope is read at trigger time; status changes must not re-run this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, open, sharingTick]);

  // A view-only shared note cannot offer Work mode.
  useEffect(() => {
    if (askOnly && mode === 'edit') setChatMode('ask');
  }, [askOnly, mode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return;
      // The mobile menu drawer owns the screen; its Chat action is the entry.
      if (isMobile && sidebarOpen) {
        event.preventDefault();
        return;
      }
      if (document.querySelector('[data-dialog-layer]')) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, setOpen, sidebarOpen]);

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

  // On phones the dock is a full-screen modal surface. Keep Tab inside it;
  // nested sheets, dialogs, and menus own their own focus while they are on
  // top.
  useEffect(() => {
    if (!isMobile || !visible) return;

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (document.querySelector('[data-dialog-layer],[role="menu"]')) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab, true);
    return () => document.removeEventListener('keydown', handleTab, true);
  }, [isMobile, visible]);

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

  const close = useCallback(() => {
    setOpen(false);
    setHistoryOpen(false);
    setHistorySheetOpen(false);
  }, [setHistoryOpen, setOpen]);

  const closeFromSwipe = useCallback((offset: number) => {
    const panel = panelRef.current;
    if (panel) {
      if (offset < 0) {
        // Exit in the pull direction. The closed-state transform reads this
        // variable until the exit-end handler parks the hidden surface on the
        // right for the next entrance.
        panel.style.setProperty('--nana-chat-closed-x', '-100%');
      } else {
        panel.style.removeProperty('--nana-chat-closed-x');
      }
    }
    close();
  }, [close]);

  const swipe = useSwipeToClose({
    enabled: isMobile && visible,
    panelRef,
    onClose: closeFromSwipe,
    direction: 'both',
    ignoreTarget: isHorizontallyScrollable,
  });

  const clearExitFallback = useCallback(() => {
    if (exitFallbackRef.current === null) return;
    window.clearTimeout(exitFallbackRef.current);
    exitFallbackRef.current = null;
  }, []);

  const parkClosedOnRight = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // The surface is hidden here; move it to the right with transitions off so
    // the next open cannot start on the edge the close left behind.
    panel.style.transition = 'none';
    panel.style.removeProperty('--nana-chat-closed-x');
    void panel.offsetWidth;
    panel.style.removeProperty('transition');
  }, []);

  const scheduleExitFallback = useCallback(() => {
    clearExitFallback();
    exitFallbackRef.current = window.setTimeout(() => {
      exitFallbackRef.current = null;
      // A normal open clears this timer. If it still fires while the dock is
      // visible, the surface is not exiting and the state must not move.
      if (visibleRef.current) return;
      const panel = panelRef.current;
      exitStateRef.current = completedChatDockExitState();
      if (panel && isChatDockHidden(panel)) parkClosedOnRight();
    }, CHAT_DOCK_EXIT_FALLBACK_MS);
  }, [clearExitFallback, parkClosedOnRight]);

  const settleOpenState = useCallback(() => {
    const panel = panelRef.current;
    panel?.style.removeProperty('--nana-chat-closed-x');
    exitStateRef.current = openChatDockExitState(exitStateRef.current);
    clearExitFallback();
  }, [clearExitFallback]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;
    if (!panel) return;

    if (!visible) {
      if (wasVisible === true) {
        // The close commit is the only place that decides the exit side. It is
        // recorded before the transform runs, so a reopen never has to infer
        // progress from a pixel threshold.
        exitStateRef.current = beginChatDockExitState(
          panel.style.getPropertyValue('--nana-chat-closed-x'),
        );
        scheduleExitFallback();
      }
      return;
    }

    const entrance = wasVisible === false
      ? resolveChatDockEntrance(exitStateRef.current)
      : 'from-right';
    // Clearing the exit side has no visual effect while open; it only changes
    // the closed-state target so an in-flight reversal heads to zero.
    settleOpenState();
    if (wasVisible !== false || entrance === 'reverse') return;

    // The previous exit finished (or its state expired), so the next entrance
    // starts on the right. Pin for one style flush so it cannot begin on the
    // side the last close used.
    panel.style.transition = 'none';
    panel.style.transform = 'translateX(100%)';
    void panel.offsetWidth;
    panel.style.removeProperty('transform');
    panel.style.removeProperty('transition');
  }, [scheduleExitFallback, settleOpenState, visible]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const completeExit = () => {
      exitStateRef.current = completedChatDockExitState();
      clearExitFallback();
      if (!visibleRef.current) parkClosedOnRight();
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== panel) return;
      if (event.propertyName === 'transform') {
        if (visibleRef.current) {
          // The open transition (including a mid-exit reversal) owns motion.
          settleOpenState();
          return;
        }
        // The exit slide is done. The visibility delay may land a frame later,
        // but this surface has left; the next open starts from the right.
        exitStateRef.current = completedChatDockExitState();
        clearExitFallback();
        if (isChatDockHidden(panel)) parkClosedOnRight();
        return;
      }
      if (event.propertyName === 'visibility' && !visibleRef.current) {
        completeExit();
      }
    };

    const handleTransitionCancel = (event: TransitionEvent) => {
      if (event.target !== panel || event.propertyName !== 'transform') return;
      if (!visibleRef.current) {
        // A transition can cancel while the dock is still closed. If it is
        // already hidden, settle immediately; otherwise the bounded fallback
        // owns the dropped exit.
        if (isChatDockHidden(panel)) completeExit();
        return;
      }
      // A reopen interrupted the exit transition; it is no longer closing.
      settleOpenState();
    };

    panel.addEventListener('transitionend', handleTransitionEnd);
    panel.addEventListener('transitioncancel', handleTransitionCancel);
    return () => {
      panel.removeEventListener('transitionend', handleTransitionEnd);
      panel.removeEventListener('transitioncancel', handleTransitionCancel);
    };
  }, [clearExitFallback, parkClosedOnRight, settleOpenState]);

  useEffect(() => () => clearExitFallback(), [clearExitFallback]);

  const newChat = () => {
    if (noteId) noteChoice.current.delete(noteId);
    startNewConversation();
    setHistorySheetOpen(false);
    setResetSignal((value) => value + 1);
    setFocusSignal((value) => value + 1);
  };

  const selectScope = (next: 'personal' | 'note') => {
    if (next === 'note') {
      if (!noteId) return;
      noteChoice.current.add(noteId);
    } else if (noteId) {
      noteChoice.current.delete(noteId);
    }
    setChatScope(next);
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

  const selectedModel = findChatModel(status, selectedModelId);
  let statusText = 'Assistant';
  if (status?.configured === false) statusText = 'Not configured';
  else if (selectedModel) statusText = selectedModel.label;
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
        aria-modal={isMobile && visible ? 'true' : 'false'}
        aria-label="Nana chat"
        aria-hidden={!visible}
        inert={!visible}
        className={cn(
          'nana-chat-dock nana-swipe-panel fixed bottom-0 right-0 top-0 z-[46] flex max-w-full flex-col overflow-hidden border-line bg-surface text-ink shadow-float md:border-l',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        data-state={visible ? 'open' : 'closed'}
        style={isMobile
          ? {
            width: '100%',
            touchAction: 'pan-y pinch-zoom',
            ...(viewportHeight ? { height: `${viewportHeight}px`, bottom: 0 } : {}),
          }
          : { width: `${width}px`, ...(resizing ? { transition: 'none' } : {}) }}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
        onClickCapture={swipe.onClickCapture}
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
                <NanaMark size={32} />
                <div className="min-w-0 flex-1">
                  <h2
                    className="truncate text-[14px] font-semibold leading-none tracking-[-0.015em] text-ink"
                    title={conversation?.title || 'Chat'}
                  >
                    {conversation?.title?.trim() || 'Chat'}
                  </h2>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-muted" title={selectedModel?.provider ?? status?.provider ?? undefined}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
                    <span className="truncate">{statusText}</span>
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={newChat}
                    aria-label="New chat"
                    title={scope === 'note' ? 'Start a new personal chat' : 'New chat'}
                    className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:h-8 sm:w-8"
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
                      'flex h-11 w-11 items-center justify-center rounded-control transition-colors sm:h-8 sm:w-8',
                      (isMobile ? historySheetOpen : historyOpen)
                        ? 'bg-signal-soft text-signal'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                    )}
                  >
                    <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close chat"
                    title="Close chat"
                    className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:h-8 sm:w-8"
                  >
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="px-3 pb-2.5 pt-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5">
                  {noteId && (
                    <>
                      <ChatScopeTabs
                        scope={scope}
                        onChange={selectScope}
                        noteReady={Boolean(noteChatStatus)}
                        noteEnabled={noteChatStatus?.enabled === true}
                        noteLoading={noteChatLoading}
                        noteReason={noteChatStatus?.reason ?? null}
                        noteError={noteChatError}
                        className="shrink-0"
                      />
                      <span className="hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
                    </>
                  )}
                  {askOnly ? (
                    <span
                      className="inline-flex h-[30px] items-center rounded-control border border-line bg-surface-sunken px-2.5 text-[12px] font-medium text-ink-muted"
                      title="Shared chats on this note are read-only"
                    >
                      Ask only
                    </span>
                  ) : (
                    <SegmentedControl
                      label="Chat mode"
                      size="sm"
                      className="chat-mode-control max-w-full"
                      value={mode}
                      onChange={setChatMode}
                      options={[
                        {
                          value: 'edit',
                          label: 'Work',
                          title: scope === 'note'
                            ? 'Work — Nana can read and change this note'
                            : 'Work — Nana can read and change folders, notes, boards, and tasks',
                        },
                        {
                          value: 'ask',
                          label: 'Ask',
                          title: scope === 'note'
                            ? 'Ask — Nana only reads this note'
                            : 'Ask — Nana only reads notes and boards',
                        },
                      ]}
                    />
                  )}
                </div>
                {noteDisabledReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-snug text-ink-muted">
                    <LockClosedIcon className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{noteDisabledReason}</span>
                  </p>
                )}
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

      {isMobile && !visible && !isChatRoute && !sidebarOpen && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Chat"
          aria-controls="nana-chat-dock"
          aria-expanded={open}
          className="fixed z-40 flex h-11 w-11 items-center justify-center rounded-full bg-signal-bright text-on-signal shadow-float transition-transform hover:bg-signal-bright-strong active:scale-95"
          style={{
            bottom: 'calc(var(--mobile-navbar-height, 4.5rem) + 0.75rem)',
            right: '0.75rem',
          }}
        >
          <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

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
