import { useEffect, useRef } from 'react';

/**
 * Makes the browser Back button dismiss a temporary overlay (a sheet, drawer,
 * or picker) instead of leaving the page. The overlay's own close path must
 * call the returned `open` state's setter; the synthetic history entry is
 * removed on the way out when the route has not changed.
 *
 * `onClose` may return `true` to keep the synthetic entry armed after closing
 * a nested layer, so the next Back closes the layer underneath (for example a
 * history sheet inside a full-screen chat dock). Any other return, including
 * `undefined`, leaves no guard behind.
 *
 * Route changes are left alone: navigating away while the overlay is open
 * must never be undone by a pending `history.back()`.
 */
export interface BackToCloseOptions {
  /**
   * Adopt an existing `nanaBackToClose` history entry instead of pushing a
   * new one. Use this when another surface (the mobile menu drawer) already
   * pushed a guard that this overlay should take over.
   */
  reuseExisting?: boolean;
}

export function useBackToClose(
  open: boolean,
  onClose: () => void | boolean,
  enabled = true,
  options: BackToCloseOptions = {},
) {
  const onCloseRef = useRef(onClose);
  const pushedRef = useRef(false);
  const openHrefRef = useRef('');
  const reuseExisting = options.reuseExisting === true;

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled || !open) return;

    const currentState = window.history.state as { nanaBackToClose?: unknown } | null;
    const reuse = reuseExisting && currentState?.nanaBackToClose === true;
    openHrefRef.current = window.location.href;
    pushedRef.current = true;
    if (!reuse) {
      window.history.pushState(
        { ...(window.history.state ?? {}), nanaBackToClose: true },
        '',
        window.location.href,
      );
    }

    const handlePopState = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      if (onCloseRef.current() === true) {
        pushedRef.current = true;
        openHrefRef.current = window.location.href;
        window.history.pushState(
          { ...(window.history.state ?? {}), nanaBackToClose: true },
          '',
          window.location.href,
        );
      }
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
  }, [enabled, open, reuseExisting]);
}
