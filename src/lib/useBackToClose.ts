import { useEffect, useRef } from 'react';

/**
 * Makes the browser Back button dismiss a temporary overlay (a sheet, drawer,
 * or picker) instead of leaving the page. The overlay's own close path must
 * call the returned `open` state's setter; the synthetic history entry is
 * removed on the way out when the route has not changed.
 *
 * Route changes are left alone: navigating away while the overlay is open
 * must never be undone by a pending `history.back()`.
 */
export function useBackToClose(open: boolean, onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose);
  const pushedRef = useRef(false);
  const openHrefRef = useRef('');

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled || !open) return;

    openHrefRef.current = window.location.href;
    pushedRef.current = true;
    window.history.pushState(
      { ...(window.history.state ?? {}), nanaBackToClose: true },
      '',
      window.location.href,
    );

    const handlePopState = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (!pushedRef.current) return;
      pushedRef.current = false;
      // Only consume the synthetic entry when we are still on the same page.
      // A navigation has its own history entry and must not be reversed.
      if (window.location.href === openHrefRef.current) {
        window.history.back();
      }
    };
  }, [enabled, open]);
}
