import { describe, expect, test } from 'bun:test';
import {
  SWIPE_CLOSE_MAX_PX,
  SWIPE_CLOSE_RATIO,
  clampSwipeOffset,
  isSingleTouchGesture,
  resolveSwipeIntent,
  shouldCloseSwipe,
  swipeProgress,
} from '../../src/lib/swipeToClose';

describe('swipe gesture intent', () => {
  test('waits through diagonal movement before choosing an axis', () => {
    expect(resolveSwipeIntent(4, 4)).toBe('pending');
    expect(resolveSwipeIntent(8, 8)).toBe('pending');
    expect(resolveSwipeIntent(12, 14)).toBe('pending');
    expect(resolveSwipeIntent(30, 30)).toBe('pending');
    expect(resolveSwipeIntent(-14, -12)).toBe('horizontal');
    expect(resolveSwipeIntent(-14, 12)).toBe('horizontal');
  });

  test('does not let a downward-leading sample kill a later horizontal pull', () => {
    expect(resolveSwipeIntent(-5, 20)).toBe('pending');
    expect(resolveSwipeIntent(-5, 20, 'both')).toBe('pending');
    expect(resolveSwipeIntent(-8, 22)).toBe('pending');
    expect(resolveSwipeIntent(-20, 30)).toBe('vertical');
    expect(resolveSwipeIntent(-40, 32)).toBe('horizontal');
    expect(resolveSwipeIntent(-40, 32, 'both')).toBe('horizontal');
  });

  test('yields to a clearly vertical scroll', () => {
    expect(resolveSwipeIntent(5, 26)).toBe('vertical');
    expect(resolveSwipeIntent(-6, 40)).toBe('vertical');
    expect(resolveSwipeIntent(0, 60)).toBe('vertical');
    expect(resolveSwipeIntent(-10, 14)).toBe('pending');
  });

  test('only accepts the configured horizontal directions', () => {
    expect(resolveSwipeIntent(-20, 5, 'left')).toBe('horizontal');
    expect(resolveSwipeIntent(20, 5, 'left')).toBe('wrong-direction');
    expect(resolveSwipeIntent(20, 5, 'both')).toBe('horizontal');
    expect(resolveSwipeIntent(-20, 5, 'both')).toBe('horizontal');
    expect(resolveSwipeIntent(24, 20, 'left')).toBe('wrong-direction');
  });

  test('cancels the gesture when a second finger lands', () => {
    expect(isSingleTouchGesture(1)).toBe(true);
    expect(isSingleTouchGesture(0)).toBe(false);
    expect(isSingleTouchGesture(2)).toBe(false);
  });
});

describe('swipe geometry', () => {
  test('clamps a panel pull according to its direction', () => {
    expect(clampSwipeOffset(0, 320, 'left')).toBe(0);
    expect(clampSwipeOffset(-40, 320, 'left')).toBe(-40);
    expect(clampSwipeOffset(-500, 320, 'left')).toBe(-320);
    expect(clampSwipeOffset(24, 320, 'left')).toBe(0);
    expect(clampSwipeOffset(40, 320, 'both')).toBe(40);
    expect(clampSwipeOffset(500, 320, 'both')).toBe(320);
    expect(clampSwipeOffset(-500, 320, 'both')).toBe(-320);
    expect(clampSwipeOffset(-40, 0, 'left')).toBe(0);
  });

  test('turns either pull direction into progress', () => {
    expect(swipeProgress(0, 320)).toBe(0);
    expect(swipeProgress(-80, 320)).toBe(0.25);
    expect(swipeProgress(80, 320)).toBe(0.25);
    expect(swipeProgress(-500, 320)).toBe(1);
    expect(swipeProgress(0, 0)).toBe(0);
  });

  test('dismisses on a deliberate pull or a quick outward flick', () => {
    const threshold = Math.min(
      SWIPE_CLOSE_MAX_PX,
      400 * SWIPE_CLOSE_RATIO,
    );

    expect(shouldCloseSwipe(-threshold - 1, 400, 0, 'left')).toBe(true);
    expect(shouldCloseSwipe(-20, 400, -0.5, 'left')).toBe(true);
    expect(shouldCloseSwipe(-20, 400, 0, 'left')).toBe(false);
    expect(shouldCloseSwipe(-threshold + 1, 400, 0, 'left')).toBe(false);
    expect(shouldCloseSwipe(threshold + 1, 400, 0, 'left')).toBe(false);
    expect(shouldCloseSwipe(-500, 0, -1, 'left')).toBe(false);
  });

  test('dismisses a two-sided panel in the direction of the pull', () => {
    expect(shouldCloseSwipe(120, 400, 0, 'both')).toBe(true);
    expect(shouldCloseSwipe(-120, 400, 0, 'both')).toBe(true);
    expect(shouldCloseSwipe(20, 400, 0.5, 'both')).toBe(true);
    expect(shouldCloseSwipe(-20, 400, -0.5, 'both')).toBe(true);
    expect(shouldCloseSwipe(20, 400, -0.5, 'both')).toBe(false);
    expect(shouldCloseSwipe(-20, 400, 0.5, 'both')).toBe(false);
  });
});
