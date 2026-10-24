import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'signal' | 'warning' | 'success' | 'danger' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-raised text-ink-secondary',
  signal: 'border-signal/25 bg-signal-soft text-signal',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  success: 'border-success/25 bg-success-soft text-success',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  outline: 'border-line-strong bg-transparent text-ink-secondary',
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}

export function Badge({ children, tone = 'neutral', className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5',
        tones[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-muted/30 border-t-signal',
        className
      )}
    />
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * A quiet editorial block rather than an empty panel: full width, left aligned,
 * bounded by hairlines. The icon prop is accepted for compatibility and
 * intentionally not rendered.
 */
export function EmptyState({ eyebrow, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'w-full border-y border-line text-left',
        compact ? 'px-1 py-[18px]' : 'px-2 py-7',
        className
      )}
    >
      {eyebrow && (
        <p className="font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.08em] text-ink-muted">
          {eyebrow}
        </p>
      )}
      <h3
        className={cn(
          'font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink',
          eyebrow && 'mt-2'
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-ink-secondary">{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
