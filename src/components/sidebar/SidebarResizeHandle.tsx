import { useEffect, useRef } from 'react';
import { setSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from '../../lib/settings';

interface SidebarResizeHandleProps {
  isMobile: boolean;
  sidebarWidth: number;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}

export function SidebarResizeHandle({ isMobile, sidebarWidth, onResizeStart, onResizeEnd }: SidebarResizeHandleProps) {
  const isDraggingRef = useRef(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      
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

    const handleMouseUp = () => {
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
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      // Cleanup any pending animation frame
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [onResizeEnd]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
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
      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group z-50 hover:bg-blue-500/50 transition-colors"
      onMouseDown={handleMouseDown}
    >
      {/* Visual indicator on hover */}
      <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500/0 group-hover:bg-blue-500/50 transition-colors" />
    </div>
  );
}
