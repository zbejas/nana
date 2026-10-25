import type { ReactNode } from 'react';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { cn } from './cn';

interface PageHeaderProps {
  back?: { label: string; onClick: () => void };
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * The one masthead. Every route opens with the same title scale, supporting
 * sentence, optional meta strip, and right-aligned actions, set off by a
 * single hairline. No decorative rule: hierarchy comes from type and space.
 */
export function PageHeader({
  back,
  title,
  description,
  meta,
  actions,
  className,
  compact,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'mb-7 border-b border-line pb-5 sm:mb-8 sm:pb-6',
        compact && 'mb-5 pb-4',
        className
      )}
    >
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="mb-3 inline-flex h-7 items-center gap-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {back.label}
        </button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-[1.08] tracking-[-0.032em] text-ink sm:text-[2.125rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-secondary">
              {description}
            </p>
          )}
          {meta && (
            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-muted">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
