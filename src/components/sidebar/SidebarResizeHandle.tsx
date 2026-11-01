import { useEffect, useRef } from 'react';
import { setSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from '../../lib/settings';

interface SidebarResizeHandleProps {
  isMobile: boolean;
  sidebarWidth: number;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}

export function SidebarResizeHandle({ isMobile, sidebarWidth, onResizeStart, onResizeEnd }: SidebarResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  useEffect(() => {
    const finishDrag = () => {
      if (!isDraggingRef.current) return;

      // Cancel any pending animation frame
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Apply final width if there's a pending one
      if (pendingWidthRef.current !== null) {
        setSidebarWidth(pendingWidthRef.current);
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

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

      const deltaX = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + deltaX;

      // Clamp the width
      const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      pendingWidthRef.current = clampedWidth;

      // Use requestAnimationFrame to batch updates
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) {
            setSidebarWidth(pendingWidthRef.current);
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
    // pointercancel, focus loss, and a hidden tab all end it so the layout
    // cannot stay stuck with transitions disabled. The parent may re-render
    // while the drag is active, so the callbacks are read through refs and the
    // listeners are installed once for the life of the handle.
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

      // Cleanup any pending animation frame
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (isDraggingRef.current) finishDrag();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is a convenience; window listeners still finish it.
    }
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    onResizeStart();
  };

  // Don't render on mobile
  if (isMobile) return null;

  return (
    <div
      ref={handleRef}
      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group z-50 hover:bg-signal-soft transition-colors"
      data-sidebar-resize-handle
      onPointerDown={handlePointerDown}
    >
      {/* Visual indicator on hover */}
      <div className="absolute right-0 top-0 bottom-0 w-1 bg-signal-soft group-hover:bg-signal-soft transition-colors" />
    </div>
  );
}
