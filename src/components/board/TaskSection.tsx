import type { ReactNode } from 'react';
import { cn } from '../ui';

interface TaskSectionProps {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/** One inspector section with a consistent h3 and count/action row. */
export function TaskSection({ title, count, action, children, className, id }: TaskSectionProps) {
  return (
    <section id={id} className={cn('task-section', className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="task-section__header">
        <h3 id={id ? `${id}-title` : undefined} className="task-section__title">
          {title}
          {typeof count === 'number' && (
            <>
              {' '}
              <span className="ml-0.5 font-normal tabular-nums text-ink-muted">{count}</span>
            </>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
