import { useEffect, useState } from 'react';

/**
 * The existing chat page pattern: while the mobile keyboard is open, pin the
 * surface to the visual viewport height so the composer stays above the
 * keyboard. Returns `null` when the keyboard is closed.
 */
export function useChatViewportHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHeight(null);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const offset = vv.offsetTop;
      const keyboardHeight = window.innerHeight - vv.height - offset;
      if (keyboardHeight > 120) {
        setHeight(Math.max(vv.height - offset, 0));
        return;
      }
      setHeight(null);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);

  return height;
}

export function useIsMobileChat(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return isMobile;
}
