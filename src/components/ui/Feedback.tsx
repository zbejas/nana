import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'ember' | 'brass' | 'sage' | 'danger' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-raised text-ink-secondary',
  ember: 'border-ember/25 bg-ember-soft text-ember',
  brass: 'border-brass/25 bg-brass-soft text-brass',
  sage: 'border-sage/25 bg-sage-soft text-sage',
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
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-muted/30 border-t-ember',
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

export function EmptyState({ icon, eyebrow, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-panel border border-dashed border-line-strong/70 bg-surface/40 text-center',
        compact ? 'px-6 py-10' : 'px-6 py-16',
        className
      )}
    >
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-ember/20 bg-ember-soft text-ember [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      )}
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-secondary">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
