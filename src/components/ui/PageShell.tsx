import type { ReactNode } from 'react';
import { cn } from './cn';

export type PageWidth = 'default' | 'wide' | 'reading';

const widths: Record<PageWidth, string> = {
  default: 'max-w-[1280px]',
  wide: 'max-w-[1600px]',
  reading: 'max-w-[820px]',
};

interface PageShellProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  width?: PageWidth;
  scroll?: 'page' | 'content';
}

/**
 * The one route frame. Every authenticated page shares the same centered field,
 * gutters, and vertical rhythm; pages choose whether the document or the inner
 * content owns the scroll.
 */
export function PageShell({
  children,
  className,
  contentClassName,
  width = 'default',
  scroll = 'page',
}: PageShellProps) {
  return (
    <div
      className={cn(
        scroll === 'page'
          ? 'h-full min-h-0 overflow-y-auto scrollbar-autohide'
          : 'flex h-full min-h-0 flex-col overflow-hidden',
        className
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full flex-col px-5 sm:px-8 lg:px-12',
          scroll === 'page'
            ? 'py-6 sm:py-8 lg:py-10'
            : 'min-h-0 flex-1 py-5 sm:py-7 lg:py-8',
          widths[width],
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
