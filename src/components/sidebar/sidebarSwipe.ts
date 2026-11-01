/** A horizontal drag has to clear this many pixels before it owns the gesture. */
export const SIDEBAR_SWIPE_START_PX = 8;

/** Past this share of the drawer width a release dismisses it. */
export const SIDEBAR_SWIPE_CLOSE_RATIO = 0.28;

/** The distance threshold stops growing on wide drawers. */
export const SIDEBAR_SWIPE_CLOSE_MAX_PX = 96;

/** Leftward release velocity in pixels per millisecond that dismisses the drawer. */
export const SIDEBAR_SWIPE_CLOSE_VELOCITY = 0.45;

export function clampSidebarOffset(offset: number, width: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return 0;
  return Math.min(0, Math.max(-width, offset));
}

export function sidebarSwipeProgress(offset: number, width: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return 0;
  return Math.min(1, Math.max(0, -offset / width));
}

/**
 * The drawer closes on a deliberate pull or a quick left flick. A slow, short
 * drag settles back so a small accidental movement never dismisses it.
 */
export function shouldCloseSidebarSwipe(offset: number, width: number, velocity: number): boolean {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return false;

  const distanceThreshold = Math.min(
    SIDEBAR_SWIPE_CLOSE_MAX_PX,
    width * SIDEBAR_SWIPE_CLOSE_RATIO,
  );

  return offset <= -distanceThreshold
    || (Number.isFinite(velocity) && velocity <= -SIDEBAR_SWIPE_CLOSE_VELOCITY);
}
