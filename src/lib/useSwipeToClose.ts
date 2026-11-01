import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  clampSwipeOffset,
  resolveSwipeIntent,
  shouldCloseSwipe,
  swipeProgress,
  type SwipeDirection,
} from './swipeToClose';

interface UseSwipeToCloseOptions {
  enabled: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: (offset: number) => void;
  direction?: SwipeDirection;
  /** When set, the 0..1 pull progress is published on <html> for a scrim. */
  progressVariable?: string;
  ignoreTarget?: (target: EventTarget | null, panel: HTMLElement) => boolean;
}

interface PanelDrag {
  source: 'pointer' | 'touch';
  pointerId?: number;
  touchId?: number;
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

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isMarkedIgnored(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-swipe-ignore]'));
}

export function useSwipeToClose({
  enabled,
  panelRef,
  onClose,
  direction = 'left',
  progressVariable,
  ignoreTarget,
}: UseSwipeToCloseOptions) {
  const dragRef = useRef<PanelDrag | null>(null);
  const suppressClickRef = useRef(false);
  const clickResetTimerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const configRef = useRef({ onClose, direction, progressVariable, ignoreTarget });
  configRef.current = { onClose, direction, progressVariable, ignoreTarget };

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
    const panel = panelRef.current;
    if (panel) {
      panel.removeAttribute('data-swipe-dragging');
      panel.style.removeProperty('--nana-swipe-drag-x');
    }
    if (configRef.current.progressVariable) {
      document.documentElement.removeAttribute('data-sidebar-dragging');
      document.documentElement.style.removeProperty(configRef.current.progressVariable);
    }
  }, [panelRef]);

  const setDragOffset = useCallback((panel: HTMLElement, drag: PanelDrag, offset: number) => {
    drag.offset = offset;
    panel.style.setProperty('--nana-swipe-drag-x', `${offset}px`);

    const variable = configRef.current.progressVariable;
    if (!variable) return;
    document.documentElement.setAttribute('data-sidebar-dragging', 'true');
    document.documentElement.style.setProperty(
      variable,
      `${swipeProgress(offset, drag.width)}`,
    );
  }, []);

  const beginDrag = useCallback((
    source: PanelDrag['source'],
    pointerId: number | undefined,
    clientX: number,
    clientY: number,
    touchId?: number,
  ) => {
    const panel = panelRef.current;
    if (!panel) return;

    const width = panel.getBoundingClientRect().width;
    if (width <= 0) return;

    if (dragRef.current) {
      dragRef.current = null;
      resetDragVisuals();
    }

    clearClickReset();
    suppressClickRef.current = false;

    dragRef.current = {
      source,
      ...(pointerId === undefined ? {} : { pointerId }),
      ...(touchId === undefined ? {} : { touchId }),
      startX: clientX,
      startY: clientY,
      startTranslate: 0,
      lastX: clientX,
      lastAt: performance.now(),
      velocity: 0,
      lastVelocity: 0,
      width,
      offset: 0,
      engaged: false,
    };
  }, [clearClickReset, panelRef, resetDragVisuals]);

  const engageDrag = useCallback((
    panel: HTMLElement,
    drag: PanelDrag,
    clientX: number,
    clientY: number,
    deltaX: number,
  ) => {
    const now = performance.now();
    const currentTranslate = readTranslateX(panel);
    const engagedTranslate = clampSwipeOffset(
      currentTranslate + deltaX,
      drag.width,
      configRef.current.direction,
    );

    // Re-anchor to where the panel is now plus the movement that crossed the
    // threshold. This keeps the panel from jumping back to the pointerdown
    // position when the user catches an opening panel, and does not lose the
    // first drag step.
    drag.startX = clientX;
    drag.startY = clientY;
    drag.startTranslate = engagedTranslate;
    drag.offset = engagedTranslate;
    drag.lastX = clientX;
    drag.lastAt = now;
    drag.velocity = 0;
    drag.lastVelocity = 0;
    drag.engaged = true;

    armClickSuppression();
    panel.setAttribute('data-swipe-dragging', 'true');
    setDragOffset(panel, drag, engagedTranslate);

    if (drag.source === 'pointer' && drag.pointerId !== undefined) {
      try {
        panel.setPointerCapture(drag.pointerId);
      } catch {
        // The browser may already own the gesture; pointermove still follows.
      }
    }
  }, [armClickSuppression, setDragOffset]);

  const updateDrag = useCallback((
    panel: HTMLElement,
    drag: PanelDrag,
    clientX: number,
    clientY: number,
  ): boolean => {
    const deltaX = clientX - drag.startX;
    const deltaY = clientY - drag.startY;

    if (!drag.engaged) {
      const intent = resolveSwipeIntent(deltaX, deltaY, configRef.current.direction);
      if (intent === 'pending') return false;
      if (intent === 'vertical') {
        dragRef.current = null;
        return false;
      }
      if (intent === 'wrong-direction') {
        dragRef.current = null;
        armClickSuppression();
        return false;
      }

      engageDrag(panel, drag, clientX, clientY, deltaX);
      return true;
    }

    const now = performance.now();
    const elapsed = now - drag.lastAt;
    if (elapsed > 0) {
      const instantVelocity = (clientX - drag.lastX) / elapsed;
      drag.lastVelocity = instantVelocity;
      drag.velocity = drag.velocity === 0
        ? instantVelocity
        : drag.velocity * 0.55 + instantVelocity * 0.45;
    }
    drag.lastX = clientX;
    drag.lastAt = now;

    const offset = clampSwipeOffset(
      drag.startTranslate + (clientX - drag.startX),
      drag.width,
      configRef.current.direction,
    );
    setDragOffset(panel, drag, offset);
    return true;
  }, [armClickSuppression, engageDrag, setDragOffset]);

  const finishDrag = useCallback((source: PanelDrag['source'], pointerId?: number) => {
    const drag = dragRef.current;
    if (!drag || drag.source !== source) return;
    if (source === 'pointer' && drag.pointerId !== pointerId) return;

    dragRef.current = null;
    if (!drag.engaged) return;

    const panel = panelRef.current;
    if (panel && source === 'pointer' && pointerId !== undefined) {
      try {
        if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId);
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
    const velocity = settled
      ? 0
      : configRef.current.direction === 'left' || drag.offset < 0
        ? Math.min(drag.velocity, drag.lastVelocity)
        : Math.max(drag.velocity, drag.lastVelocity);
    const close = shouldCloseSwipe(
      drag.offset,
      drag.width,
      velocity,
      configRef.current.direction,
    );

    if (close) {
      // Keep the panel pinned at the release point until the closed state has
      // committed. The enabled=false effect removes the drag attribute and
      // lets the normal close transition finish the slide.
      if (configRef.current.progressVariable) {
        document.documentElement.removeAttribute('data-sidebar-dragging');
      }
      configRef.current.onClose(drag.offset);
      return;
    }

    resetDragVisuals();
  }, [armClickSuppression, panelRef, resetDragVisuals]);

  useEffect(() => {
    if (enabled) return;
    dragRef.current = null;
    resetDragVisuals();
  }, [enabled, resetDragVisuals]);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerUp = (event: PointerEvent) => finishDrag('pointer', event.pointerId);
    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.source !== 'pointer' || drag.pointerId !== event.pointerId) return;
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

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !enabled) return;

    const shouldIgnore = (target: EventTarget | null) => {
      if (isTextEntry(target) || isMarkedIgnored(target)) return true;
      const custom = configRef.current.ignoreTarget;
      return custom ? custom(target, panel) : false;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!enabledRef.current) return;
      if (event.touches.length !== 1) {
        if (dragRef.current?.source === 'touch') {
          dragRef.current = null;
          suppressClickRef.current = false;
          clearClickReset();
          resetDragVisuals();
        }
        return;
      }
      if (dragRef.current?.source === 'pointer') return;
      if (shouldIgnore(event.target)) return;

      const touch = event.touches[0];
      if (!touch) return;
      beginDrag('touch', undefined, touch.clientX, touch.clientY, touch.identifier);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!enabledRef.current) return;
      const drag = dragRef.current;
      if (!drag || drag.source !== 'touch') return;
      if (event.touches.length !== 1) {
        dragRef.current = null;
        resetDragVisuals();
        return;
      }

      const touch = drag.touchId === undefined
        ? event.touches[0]
        : Array.from(event.touches).find((item) => item.identifier === drag.touchId);
      if (!touch) {
        dragRef.current = null;
        resetDragVisuals();
        return;
      }
      const shouldPrevent = updateDrag(panel, drag, touch.clientX, touch.clientY);
      if (shouldPrevent && event.cancelable) event.preventDefault();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.source !== 'touch') return;
      if (
        drag.touchId !== undefined
        && !Array.from(event.changedTouches).some((touch) => touch.identifier === drag.touchId)
      ) {
        return;
      }
      finishDrag('touch');
    };
    const handleTouchCancel = () => {
      if (dragRef.current?.source !== 'touch') return;
      dragRef.current = null;
      suppressClickRef.current = false;
      clearClickReset();
      resetDragVisuals();
    };

    panel.addEventListener('touchstart', handleTouchStart, { passive: true });
    panel.addEventListener('touchmove', handleTouchMove, { passive: false });
    panel.addEventListener('touchend', handleTouchEnd);
    panel.addEventListener('touchcancel', handleTouchCancel);
    return () => {
      panel.removeEventListener('touchstart', handleTouchStart);
      panel.removeEventListener('touchmove', handleTouchMove);
      panel.removeEventListener('touchend', handleTouchEnd);
      panel.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [
    beginDrag,
    clearClickReset,
    enabled,
    finishDrag,
    panelRef,
    resetDragVisuals,
    updateDrag,
  ]);

  useEffect(() => () => {
    dragRef.current = null;
    resetDragVisuals();
    clearClickReset();
  }, [clearClickReset, resetDragVisuals]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || !event.isPrimary) return;
    if (event.pointerType === 'touch') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isTextEntry(event.target) || isMarkedIgnored(event.target)) return;

    const panel = panelRef.current;
    if (!panel) return;
    if (configRef.current.ignoreTarget?.(event.target, panel)) return;

    beginDrag('pointer', event.pointerId, event.clientX, event.clientY);
  }, [beginDrag, enabled, panelRef]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      if (!dragRef.current) return;
      dragRef.current = null;
      resetDragVisuals();
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.source !== 'pointer' || drag.pointerId !== event.pointerId) return;

    const panel = panelRef.current;
    if (!panel) return;

    if (updateDrag(panel, drag, event.clientX, event.clientY) && event.cancelable) {
      event.preventDefault();
    }
  }, [panelRef, resetDragVisuals, updateDrag]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishDrag('pointer', event.pointerId);
  }, [finishDrag]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.source !== 'pointer' || drag.pointerId !== event.pointerId) return;

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
