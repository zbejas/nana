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
 * Every route-level page opens with the same masthead: a small context label,
 * a display-serif title, one supporting sentence, and actions aligned right.
 */
export function PageHeader({ eyebrow, title, description, actions, className, compact }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-4',
        compact ? 'mb-5' : 'mb-7',
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2.5">{eyebrow}</p>}
        <h1 className="font-display text-[1.75rem] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
