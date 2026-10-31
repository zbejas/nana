import { useEffect, useRef } from 'react';
import type { AIChatModelOption } from '../../lib/ai/types';
import type { ChatUsage } from '../../api/chat/types';
import {
  formatTokenCount,
  summarizeContextUsage,
  type ContextUsageTone,
} from '../../lib/chat/context-usage';

interface ChatContextUsageProps {
  usage?: ChatUsage | null;
  model: AIChatModelOption | null;
  className?: string;
}

const RING_SIZE = 32;
const RING_STROKE = 2.6;

function toneClass(tone: ContextUsageTone): string {
  if (tone === 'danger') return 'text-danger';
  if (tone === 'warning') return 'text-warning';
  if (tone === 'signal') return 'text-signal';
  return 'text-ink-muted';
}

function barClass(tone: ContextUsageTone): string {
  if (tone === 'danger') return 'bg-danger';
  if (tone === 'warning') return 'bg-warning';
  return 'bg-signal-bright';
}

function ContextRing({
  percent,
  tone,
  size = RING_SIZE,
  stroke = RING_STROKE,
}: {
  percent: number | null;
  tone: ContextUsageTone;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.min(1, Math.max(0, percent / 100));
  const visibleFill = filled > 0 && filled < 0.02 ? 0.02 : filled;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={`h-full w-full -rotate-90 ${toneClass(tone)}`}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="text-line"
        stroke="currentColor"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - visibleFill)}
        className={percent === null ? 'opacity-30' : ''}
      />
    </svg>
  );
}

function formatPercent(percent: number | null): string {
  if (percent === null) return '';
  if (percent > 0 && percent < 1) return '<1%';
  if (percent > 100) return '100%+';
  return `${Math.round(percent)}%`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink-secondary">{value}</dd>
    </div>
  );
}

/**
 * Small context-window donut in the composer toolbar. Clicking opens a
 * non-modal details card; the usage belongs to the final model step of the
 * latest reply, which is the context carried into the next turn.
 */
export function ChatContextUsage({ usage, model, className = '' }: ChatContextUsageProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summary = summarizeContextUsage(usage, model?.contextWindow);
  const usedLabel = formatTokenCount(summary.usedTokens);
  const windowLabel = summary.contextWindow === null
    ? null
    : formatTokenCount(summary.contextWindow);
  const percentLabel = formatPercent(summary.percent);
  const hasUsage = Boolean(usage && summary.usedTokens > 0);
  const title = !hasUsage
    ? 'Context usage · no reply yet'
    : summary.contextWindow === null
      ? `Context usage · ${usedLabel} tokens`
      : `Context usage · ${percentLabel} of ${windowLabel} tokens`;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.open = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const details = detailsRef.current;
      if (event.key !== 'Escape' || !details?.open) return;
      event.preventDefault();
      details.open = false;
      details.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        aria-label={title}
        title={title}
        className={`flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 [&::-webkit-details-marker]:hidden ${className}`}
      >
        <span className="h-[22px] w-[22px]">
          <ContextRing percent={summary.percent} tone={summary.tone} />
        </span>
      </summary>

      <div
        role="dialog"
        aria-label="Context usage"
        className="absolute bottom-full right-0 z-30 mb-1.5 w-[17rem] max-w-[calc(100vw-2rem)] rounded-panel border border-line bg-surface-raised p-3.5 text-[11.5px] leading-relaxed text-ink-secondary shadow-float"
      >
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 shrink-0">
            <ContextRing percent={summary.percent} tone={summary.tone} size={44} stroke={3.2} />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-ink">Context usage</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-muted">
              {model?.label ?? 'Current model'}
            </p>
          </div>
        </div>

        {!hasUsage ? (
          <p className="mt-3 border-t border-line pt-3 text-ink-muted">
            No token usage yet. Nana records this after the first reply.
          </p>
        ) : summary.contextWindow === null ? (
          <>
            <p className="mt-3 border-t border-line pt-3 text-[17px] font-semibold tabular-nums text-ink">
              {usedLabel} <span className="text-[11.5px] font-normal text-ink-muted">tokens used</span>
            </p>
            <p className="mt-1.5 text-ink-muted">
              This model has no context window configured, so a percentage is unavailable.
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <p className="text-[20px] font-semibold tabular-nums leading-none text-ink">
                {percentLabel}
              </p>
              <p className="text-[11px] tabular-nums text-ink-muted">
                {usedLabel} / {windowLabel}
              </p>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
              <div
                className={`h-full rounded-full ${barClass(summary.tone)}`}
                style={{ width: `${Math.min(100, Math.max(0, summary.percent ?? 0))}%` }}
              />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <DetailRow label="Input" value={formatTokenCount(usage?.inputTokens ?? 0)} />
              <DetailRow label="Output" value={formatTokenCount(usage?.outputTokens ?? 0)} />
              <DetailRow label="Remaining" value={formatTokenCount(summary.remaining ?? 0)} />
              <DetailRow label="Window" value={windowLabel ?? '—'} />
              {usage?.reasoningTokens ? (
                <DetailRow label="Reasoning" value={formatTokenCount(usage.reasoningTokens)} />
              ) : null}
              {usage?.cachedInputTokens ? (
                <DetailRow label="Cached" value={formatTokenCount(usage.cachedInputTokens)} />
              ) : null}
            </dl>
            <p className="mt-3 border-t border-line pt-2.5 text-[10.5px] text-ink-muted">
              From the final step of Nana&rsquo;s latest reply.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
