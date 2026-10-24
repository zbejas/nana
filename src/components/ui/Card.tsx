import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  as?: 'div' | 'section' | 'article';
  interactive?: boolean;
}

export function Card({ as: Tag = 'div', interactive, className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-panel border border-line bg-surface panel-hairline',
        interactive && 'transition-colors duration-150 hover:border-line-strong hover:bg-surface-raised',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeading({ eyebrow, title, description, actions, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="font-display text-xl leading-tight text-ink">{title}</h2>
        {description && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
