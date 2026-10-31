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
        'inline-flex items-center gap-1.5 rounded-[5px] border px-1.5 py-0.5 text-[11.5px] font-medium leading-5',
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
 * A quiet panel rather than an empty table row: an optional neutral icon, a
 * title, and one next step. Compact drops the panel chrome for dialogs and
 * inline contexts.
 */
export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'w-full',
        compact
          ? 'px-0 py-4'
          : 'rounded-panel border border-line bg-surface px-6 py-10 text-center sm:px-8',
        className
      )}
    >
      {icon && !compact && (
        <span className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
      )}
      <h3
        className={cn(
          'text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink',
          compact && 'text-[16px]'
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-1.5 max-w-[56ch] text-[13.5px] leading-relaxed text-ink-secondary',
            !compact && 'mx-auto'
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <div
          className={cn(
            'mt-5 flex flex-wrap items-center gap-2',
            !compact && 'justify-center'
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}
