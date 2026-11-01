import { describe, expect, test } from 'bun:test';
import {
  CHAT_DOCK_EXIT_FALLBACK_MS,
  beginChatDockExitState,
  closedChatDockExitState,
  completedChatDockExitState,
  openChatDockExitState,
  resolveChatDockEntrance,
} from '../../src/lib/chatDockMotion';

describe('chat dock exit state', () => {
  test('records the exit edge from the closed transform variable', () => {
    expect(beginChatDockExitState('-100%')).toEqual({ phase: 'closing', side: 'left' });
    expect(beginChatDockExitState(' -100% ')).toEqual({ phase: 'closing', side: 'left' });
    expect(beginChatDockExitState('')).toEqual({ phase: 'closing', side: 'right' });
    expect(beginChatDockExitState('100%')).toEqual({ phase: 'closing', side: 'right' });
  });

  test('reverses a running exit from either edge', () => {
    expect(resolveChatDockEntrance(beginChatDockExitState('-100%'))).toBe('reverse');
    expect(resolveChatDockEntrance(beginChatDockExitState(''))).toBe('reverse');
  });

  test('starts from the right once the exit has settled', () => {
    expect(resolveChatDockEntrance(completedChatDockExitState())).toBe('from-right');
    expect(resolveChatDockEntrance(closedChatDockExitState())).toBe('from-right');
  });

  test('an open dock is never treated as an in-flight exit', () => {
    const open = openChatDockExitState(beginChatDockExitState('-100%'));
    expect(open).toEqual({ phase: 'open', side: 'left' });
    expect(resolveChatDockEntrance(open)).toBe('from-right');
  });

  test('the fallback is bounded after the exit and visibility delay', () => {
    expect(CHAT_DOCK_EXIT_FALLBACK_MS).toBeGreaterThan(200);
    expect(CHAT_DOCK_EXIT_FALLBACK_MS).toBeLessThanOrEqual(1000);
  });
});
