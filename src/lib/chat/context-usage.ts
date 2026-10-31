import type { ChatUsage } from '../../api/chat/types';

export type ContextUsageTone = 'neutral' | 'signal' | 'warning' | 'danger';

export interface ContextUsageSummary {
  usedTokens: number;
  contextWindow: number | null;
  /** 0–100+, or null when the model has no configured context window. */
  percent: number | null;
  remaining: number | null;
  tone: ContextUsageTone;
}

/** Compact token counts for the composer ring and its details card. */
export function formatTokenCount(value: number): string {
  const tokens = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(tokens);
}

/**
 * The ring uses the last completed model step. A null window means the admin
 * has not configured one, so the UI shows token counts without inventing a
 * percentage.
 */
export function summarizeContextUsage(
  usage: ChatUsage | null | undefined,
  contextWindow: number | null | undefined,
): ContextUsageSummary {
  const usedTokens = usage?.totalTokens ?? 0;
  const window = typeof contextWindow === 'number'
    && Number.isFinite(contextWindow)
    && contextWindow > 0
    ? Math.round(contextWindow)
    : null;

  if (window === null) {
    return { usedTokens, contextWindow: null, percent: null, remaining: null, tone: 'neutral' };
  }

  const percent = (usedTokens / window) * 100;
  return {
    usedTokens,
    contextWindow: window,
    percent,
    remaining: Math.max(0, window - usedTokens),
    tone: percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'signal',
  };
}
