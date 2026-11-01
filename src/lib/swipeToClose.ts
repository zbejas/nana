export type SwipeDirection = 'left' | 'both';

export type SwipeIntent = 'pending' | 'horizontal' | 'vertical' | 'wrong-direction';

/** A horizontal drag has to clear this many pixels before it owns the gesture. */
export const SWIPE_START_PX = 10;

/** A clearly vertical drag has to clear this many pixels before it becomes a scroll. */
export const SWIPE_VERTICAL_CANCEL_PX = 18;

/** How much more vertical than horizontal a movement must be to become a scroll. */
export const SWIPE_VERTICAL_RATIO = 1.4;

/** Past this share of the panel width a release dismisses it. */
export const SWIPE_CLOSE_RATIO = 0.28;

/** The distance threshold stops growing on wide panels. */
export const SWIPE_CLOSE_MAX_PX = 96;

/** Outward release velocity in pixels per millisecond that dismisses the panel. */
export const SWIPE_CLOSE_VELOCITY = 0.45;

/**
 * Real fingers rarely move in a perfect horizontal line. Keep waiting through
 * the first diagonal pixels instead of cancelling the gesture on the first
 * vertical sample; only a clearly vertical pull becomes a scroll.
 */
export function resolveSwipeIntent(
  deltaX: number,
  deltaY: number,
  direction: SwipeDirection = 'left',
): SwipeIntent {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX < SWIPE_START_PX && absY < SWIPE_START_PX) return 'pending';
  if (absY >= SWIPE_VERTICAL_CANCEL_PX && absY > absX * SWIPE_VERTICAL_RATIO) {
    return 'vertical';
  }
  if (absX <= absY) return 'pending';
  if (direction === 'left' && deltaX >= 0) return 'wrong-direction';
  return 'horizontal';
}

export function clampSwipeOffset(
  offset: number,
  width: number,
  direction: SwipeDirection = 'left',
): number {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return 0;
  if (direction === 'left') return Math.min(0, Math.max(-width, offset));
  return Math.max(-width, Math.min(width, offset));
}

export function swipeProgress(offset: number, width: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(offset) / width));
}

/**
 * A panel closes on a deliberate pull or a quick outward flick. A slow, short
 * drag settles back so a small accidental movement never dismisses it.
 */
export function shouldCloseSwipe(
  offset: number,
  width: number,
  velocity: number,
  direction: SwipeDirection = 'left',
): boolean {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return false;
  if (direction === 'left' && offset > 0) return false;

  const distanceThreshold = Math.min(
    SWIPE_CLOSE_MAX_PX,
    width * SWIPE_CLOSE_RATIO,
  );
  if (Math.abs(offset) >= distanceThreshold) return true;

  if (!Number.isFinite(velocity) || Math.abs(velocity) < SWIPE_CLOSE_VELOCITY) {
    return false;
  }

  if (direction === 'left') return velocity <= -SWIPE_CLOSE_VELOCITY;
  if (offset < 0) return velocity <= -SWIPE_CLOSE_VELOCITY;
  if (offset > 0) return velocity >= SWIPE_CLOSE_VELOCITY;
  return false;
}
