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
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const clamp = (value: number) => Math.max(
      MIN_CHAT_DOCK_WIDTH,
      Math.min(Math.min(MAX_CHAT_DOCK_WIDTH, maxWidth), value),
    );

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;

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
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', finishDrag);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', finishDrag);
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onResizeEnd();
      }
    };
  }, [maxWidth, onResizeEnd]);

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
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
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute bottom-0 left-0 top-0 w-px bg-transparent transition-colors group-hover:bg-signal/50 group-focus-visible:bg-signal/50" />
    </div>
  );
}
