import { describe, expect, test } from 'bun:test';
import {
  formatTokenCount,
  summarizeContextUsage,
} from '../../src/lib/chat/context-usage';

describe('context usage', () => {
  test('formats compact token counts', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1_000)).toBe('1k');
    expect(formatTokenCount(12_400)).toBe('12.4k');
    expect(formatTokenCount(128_000)).toBe('128k');
    expect(formatTokenCount(1_000_000)).toBe('1m');
    expect(formatTokenCount(1_250_000)).toBe('1.3m');
    expect(formatTokenCount(Number.NaN)).toBe('0');
  });

  test('computes percentage, remaining, and tone against the model window', () => {
    const usage = { inputTokens: 24_000, outputTokens: 1_000, totalTokens: 25_000 };
    expect(summarizeContextUsage(usage, 128_000)).toEqual({
      usedTokens: 25_000,
      contextWindow: 128_000,
      percent: 19.53125,
      remaining: 103_000,
      tone: 'signal',
    });
    expect(summarizeContextUsage({ ...usage, totalTokens: 100_000 }, 128_000).tone).toBe('warning');
    expect(summarizeContextUsage({ ...usage, totalTokens: 120_000 }, 128_000).tone).toBe('danger');
  });

  test('does not invent a percentage without a context window', () => {
    expect(summarizeContextUsage({ inputTokens: 20, outputTokens: 2, totalTokens: 22 }, null)).toEqual({
      usedTokens: 22,
      contextWindow: null,
      percent: null,
      remaining: null,
      tone: 'neutral',
    });
  });
});
