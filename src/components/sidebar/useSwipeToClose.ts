import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  SIDEBAR_SWIPE_START_PX,
  clampSidebarOffset,
  shouldCloseSidebarSwipe,
  sidebarSwipeProgress,
} from './sidebarSwipe';

interface UseSwipeToCloseOptions {
  enabled: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

interface DrawerDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startTranslate: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  lastVelocity: number;
  width: number;
  offset: number;
  engaged: boolean;
}

const CLICK_SUPPRESSION_MS = 320;
const VELOCITY_SETTLE_MS = 120;

function readTranslateX(element: HTMLElement): number {
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;

  try {
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return 0;
  }
}

function isResizeHandle(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-sidebar-resize-handle]'));
}

export function useSwipeToClose({ enabled, drawerRef, onClose }: UseSwipeToCloseOptions) {
  const dragRef = useRef<DrawerDrag | null>(null);
  const suppressClickRef = useRef(false);
  const clickResetTimerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearClickReset = useCallback(() => {
    if (clickResetTimerRef.current === null) return;
    window.clearTimeout(clickResetTimerRef.current);
    clickResetTimerRef.current = null;
  }, []);

  const armClickSuppression = useCallback(() => {
    suppressClickRef.current = true;
    clearClickReset();
    clickResetTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      clickResetTimerRef.current = null;
    }, CLICK_SUPPRESSION_MS);
  }, [clearClickReset]);

  const resetDragVisuals = useCallback(() => {
    const drawer = drawerRef.current;
    if (drawer) {
      drawer.removeAttribute('data-drawer-dragging');
      drawer.style.removeProperty('--nana-sidebar-drag-x');
    }
    document.documentElement.removeAttribute('data-sidebar-dragging');
    document.documentElement.style.removeProperty('--nana-sidebar-swipe-progress');
  }, [drawerRef]);

  const finishDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;

    if (!drag.engaged) return;

    const drawer = drawerRef.current;
    if (drawer) {
      try {
        if (drawer.hasPointerCapture(pointerId)) {
          drawer.releasePointerCapture(pointerId);
        }
      } catch {
        // Capture may already be released by the browser.
      }
    }

    armClickSuppression();

    if (!enabledRef.current) {
      resetDragVisuals();
      return;
    }

    const settled = performance.now() - drag.lastAt > VELOCITY_SETTLE_MS;
    const velocity = settled ? 0 : Math.min(drag.velocity, drag.lastVelocity);

    if (shouldCloseSidebarSwipe(drag.offset, drag.width, velocity)) {
      // Keep the drawer pinned at the release point until the closed state has
      // committed. The enabled=false effect removes the drag attribute and
      // lets the normal close transition finish the slide.
      document.documentElement.removeAttribute('data-sidebar-dragging');
      onClose();
      return;
    }

    resetDragVisuals();
  }, [armClickSuppression, drawerRef, onClose, resetDragVisuals]);

  useEffect(() => {
    if (enabled) return;

    dragRef.current = null;
    resetDragVisuals();
  }, [enabled, resetDragVisuals]);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerUp = (event: PointerEvent) => finishDrag(event.pointerId);
    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      suppressClickRef.current = false;
      clearClickReset();
      resetDragVisuals();
    };
    const handleBlur = () => {
      dragRef.current = null;
      suppressClickRef.current = false;
      clearClickReset();
      resetDragVisuals();
    };

    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [clearClickReset, enabled, finishDrag, resetDragVisuals]);

  useEffect(() => () => {
    dragRef.current = null;
    resetDragVisuals();
    clearClickReset();
  }, [clearClickReset, resetDragVisuals]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isResizeHandle(event.target)) return;

    const drawer = drawerRef.current;
    if (!drawer) return;

    const width = drawer.getBoundingClientRect().width;
    if (width <= 0) return;

    if (dragRef.current) {
      dragRef.current = null;
      resetDragVisuals();
    }

    clearClickReset();
    suppressClickRef.current = false;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTranslate: 0,
      lastX: event.clientX,
      lastAt: performance.now(),
      velocity: 0,
      lastVelocity: 0,
      width,
      offset: 0,
      engaged: false,
    };
  }, [clearClickReset, drawerRef, enabled, resetDragVisuals]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      if (!dragRef.current) return;
      dragRef.current = null;
      resetDragVisuals();
      return;
    }

    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const drawer = drawerRef.current;
    if (!drawer) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.engaged) {
      if (Math.abs(deltaX) < SIDEBAR_SWIPE_START_PX && Math.abs(deltaY) < SIDEBAR_SWIPE_START_PX) {
        return;
      }
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        dragRef.current = null;
        return;
      }
      if (deltaX >= 0) {
        dragRef.current = null;
        armClickSuppression();
        return;
      }

      // The drawer may have been opening or settling when this gesture began.
      // Re-anchor to where it is now, plus the movement that crossed the
      // threshold, so the first drag frame cannot jump back to the pointerdown
      // position and no movement is lost between steps.
      const now = performance.now();
      const currentTranslate = Math.min(0, readTranslateX(drawer));
      const engagedTranslate = clampSidebarOffset(currentTranslate + deltaX, drag.width);
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startTranslate = engagedTranslate;
      drag.offset = engagedTranslate;
      drag.lastX = event.clientX;
      drag.lastAt = now;
      drag.velocity = 0;
      drag.lastVelocity = 0;
      drag.engaged = true;

      armClickSuppression();
      drawer.style.setProperty('--nana-sidebar-drag-x', `${engagedTranslate}px`);
      drawer.setAttribute('data-drawer-dragging', 'true');
      document.documentElement.setAttribute('data-sidebar-dragging', 'true');
      document.documentElement.style.setProperty(
        '--nana-sidebar-swipe-progress',
        `${sidebarSwipeProgress(engagedTranslate, drag.width)}`,
      );

      try {
        drawer.setPointerCapture(event.pointerId);
      } catch {
        // The browser may already own the gesture; pointermove still follows.
      }
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const elapsed = now - drag.lastAt;
    if (elapsed > 0) {
      const instantVelocity = (event.clientX - drag.lastX) / elapsed;
      drag.lastVelocity = instantVelocity;
      drag.velocity = drag.velocity === 0
        ? instantVelocity
        : drag.velocity * 0.55 + instantVelocity * 0.45;
    }
    drag.lastX = event.clientX;
    drag.lastAt = now;

    const dragDeltaX = event.clientX - drag.startX;
    const offset = clampSidebarOffset(drag.startTranslate + dragDeltaX, drag.width);
    drag.offset = offset;
    drawer.style.setProperty('--nana-sidebar-drag-x', `${offset}px`);
    document.documentElement.style.setProperty(
      '--nana-sidebar-swipe-progress',
      `${sidebarSwipeProgress(offset, drag.width)}`,
    );
  }, [armClickSuppression, drawerRef, resetDragVisuals]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishDrag(event.pointerId);
  }, [finishDrag]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    dragRef.current = null;
    suppressClickRef.current = false;
    clearClickReset();
    resetDragVisuals();
  }, [clearClickReset, resetDragVisuals]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    // Keep keyboard and assistive-technology activation working even if it
    // lands inside the short post-drag window.
    if (event.detail === 0) return;

    suppressClickRef.current = false;
    clearClickReset();
    event.preventDefault();
    event.stopPropagation();
  }, [clearClickReset]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}
