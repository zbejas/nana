import type { ReactNode } from 'react';
import { cn } from './cn';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Every route-level page opens with the same masthead: a display title, one
 * supporting sentence, and actions aligned right, set off by a single rule.
 * The eyebrow prop is accepted for compatibility but no longer rendered.
 */
export function PageHeader({ title, description, actions, className, compact }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5 mb-6',
        compact && 'pb-4',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
