import { useEffect } from 'react';

interface SidebarSwipeZoneProps {
  isOpen: boolean;
  isMobile: boolean;
  swipeStartX: number | null;
  swipeCurrentX: number | null;
  setSwipeStartX: (x: number | null) => void;
  setSwipeCurrentX: (x: number | null) => void;
  onToggle: () => void;
}

export function SidebarSwipeZone({
  isOpen,
  isMobile,
  swipeStartX,
  swipeCurrentX,
  setSwipeStartX,
  setSwipeCurrentX,
  onToggle,
}: SidebarSwipeZoneProps) {
  useEffect(() => {
    if (isOpen || !isMobile) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch && touch.clientX < 100) {
        setSwipeStartX(touch.clientX);
        setSwipeCurrentX(touch.clientX);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (swipeStartX === null) return;
      const touch = e.touches[0];
      if (touch) {
        setSwipeCurrentX(touch.clientX);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (swipeStartX === null || swipeCurrentX === null) {
        setSwipeStartX(null);
        setSwipeCurrentX(null);
        return;
      }
      const deltaX = swipeCurrentX - swipeStartX;
      if (deltaX > 80) {
        onToggle();
      }
      setSwipeStartX(null);
      setSwipeCurrentX(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, isMobile, swipeStartX, swipeCurrentX, setSwipeStartX, setSwipeCurrentX, onToggle]);

  return null;
}
