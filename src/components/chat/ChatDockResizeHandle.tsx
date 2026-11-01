import { useEffect, useRef } from 'react';
import {
  MAX_CHAT_DOCK_WIDTH,
  MIN_CHAT_DOCK_WIDTH,
  setChatDockWidth,
} from '../../lib/settings';

interface ChatDockResizeHandleProps {
  /** Width of the chat pane, excluding the history column. */
  width: number;
  /** Maximum base width allowed at the current viewport size. */
  maxWidth: number;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}

const KEYBOARD_STEP = 16;

/**
 * The chat dock grows from its left edge. Dragging left widens it; dragging
 * right narrows it. The width is persisted with the chat dock preference and
 * the layout suppresses transitions while a drag is active.
 */
export function ChatDockResizeHandle({
  width,
  maxWidth,
  onResizeStart,
  onResizeEnd,
}: ChatDockResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const maxWidthRef = useRef(maxWidth);
  const onResizeEndRef = useRef(onResizeEnd);
  maxWidthRef.current = maxWidth;
  onResizeEndRef.current = onResizeEnd;

  useEffect(() => {
    const clamp = (value: number) => Math.max(
      MIN_CHAT_DOCK_WIDTH,
      Math.min(Math.min(MAX_CHAT_DOCK_WIDTH, maxWidthRef.current), value),
    );

    const finishDrag = () => {
      if (!isDraggingRef.current) return;

      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (pendingWidthRef.current !== null) {
        setChatDockWidth(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }

      isDraggingRef.current = false;
      const pointerId = activePointerIdRef.current;
      activePointerIdRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const handle = handleRef.current;
      if (handle && pointerId !== null) {
        try {
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        } catch {
          // The browser may have released capture already.
        }
      }

      onResizeEndRef.current();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) return;

      const nextWidth = startWidthRef.current + (startXRef.current - event.clientX);
      pendingWidthRef.current = clamp(nextWidth);

      if (rafIdRef.current === null) {
        rafIdRef.current = window.requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) {
            setChatDockWidth(pendingWidthRef.current);
            pendingWidthRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finishDrag();
    };

    // Pointer capture keeps the drag alive outside the window; pointerup,
    // pointercancel, focus loss, and a hidden tab all end it so the dock and
    // the route inset cannot stay stuck with transitions disabled. The parent
    // re-renders as the width changes, so callbacks and the viewport limit are
    // read through refs and the listeners are installed once.
    document.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    window.addEventListener('blur', finishDrag);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      window.removeEventListener('blur', finishDrag);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (isDraggingRef.current) finishDrag();
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a convenience; window listeners still finish it.
    }
    isDraggingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    onResizeStart();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const limit = Math.min(MAX_CHAT_DOCK_WIDTH, maxWidth);
    let nextWidth: number | null = null;

    if (event.key === 'ArrowLeft') nextWidth = width + KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') nextWidth = width - KEYBOARD_STEP;
    else if (event.key === 'Home') nextWidth = MIN_CHAT_DOCK_WIDTH;
    else if (event.key === 'End') nextWidth = limit;

    if (nextWidth === null) return;
    event.preventDefault();
    setChatDockWidth(Math.max(MIN_CHAT_DOCK_WIDTH, Math.min(limit, nextWidth)));
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-label="Resize Nana chat"
      aria-controls="nana-chat-dock"
      aria-orientation="vertical"
      aria-valuemin={MIN_CHAT_DOCK_WIDTH}
      aria-valuemax={Math.min(MAX_CHAT_DOCK_WIDTH, maxWidth)}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize chat"
      className="group absolute bottom-0 left-0 top-0 z-50 w-1 cursor-col-resize transition-colors hover:bg-signal-soft focus-visible:bg-signal-soft focus-visible:outline-none"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute bottom-0 left-0 top-0 w-px bg-transparent transition-colors group-hover:bg-signal/50 group-focus-visible:bg-signal/50" />
    </div>
  );
}
