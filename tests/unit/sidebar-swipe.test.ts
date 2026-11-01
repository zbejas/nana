import { describe, expect, test } from 'bun:test';
import {
  SIDEBAR_SWIPE_CLOSE_MAX_PX,
  SIDEBAR_SWIPE_CLOSE_RATIO,
  clampSidebarOffset,
  shouldCloseSidebarSwipe,
  sidebarSwipeProgress,
} from '../../src/components/sidebar/sidebarSwipe';

describe('sidebar swipe geometry', () => {
  test('clamps a drawer pull between open and fully closed', () => {
    expect(clampSidebarOffset(0, 320)).toBe(0);
    expect(clampSidebarOffset(-40, 320)).toBe(-40);
    expect(clampSidebarOffset(-500, 320)).toBe(-320);
    expect(clampSidebarOffset(24, 320)).toBe(0);
    expect(clampSidebarOffset(-40, 0)).toBe(0);
  });

  test('turns the pull into scrim progress', () => {
    expect(sidebarSwipeProgress(0, 320)).toBe(0);
    expect(sidebarSwipeProgress(-80, 320)).toBe(0.25);
    expect(sidebarSwipeProgress(-500, 320)).toBe(1);
    expect(sidebarSwipeProgress(0, 0)).toBe(0);
  });

  test('dismisses on a deliberate pull or a quick left flick', () => {
    const threshold = Math.min(
      SIDEBAR_SWIPE_CLOSE_MAX_PX,
      320 * SIDEBAR_SWIPE_CLOSE_RATIO,
    );

    expect(shouldCloseSidebarSwipe(-threshold - 1, 320, 0)).toBe(true);
    expect(shouldCloseSidebarSwipe(-20, 320, -0.5)).toBe(true);
    expect(shouldCloseSidebarSwipe(-20, 320, 0)).toBe(false);
    expect(shouldCloseSidebarSwipe(-threshold + 1, 320, 0)).toBe(false);
    expect(shouldCloseSidebarSwipe(-500, 0, -1)).toBe(false);
  });

  test('uses the distance cap on wide drawers', () => {
    const wideThreshold = Math.min(
      SIDEBAR_SWIPE_CLOSE_MAX_PX,
      1400 * SIDEBAR_SWIPE_CLOSE_RATIO,
    );

    expect(wideThreshold).toBe(SIDEBAR_SWIPE_CLOSE_MAX_PX);
    expect(shouldCloseSidebarSwipe(-wideThreshold + 1, 1400, 0)).toBe(false);
    expect(shouldCloseSidebarSwipe(-wideThreshold, 1400, 0)).toBe(true);
  });
});
