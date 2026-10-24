import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { cn } from './cn';
import { IconButton } from './Button';
import { useLayer } from './Dialog';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Mobile bottom sheet, the touch counterpart to Dialog and the host for
 * context menus and pickers on small screens.
 */
export function Sheet({ open, onClose, title, description, children, footer, className }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  const { zIndex, isTop } = useLayer(open);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    return () => {
      const restore = previousFocus.current;
      if (restore && document.contains(restore)) {
        restore.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTop()) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose, isTop]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center" style={{ zIndex }}>
      <div
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[4px]"
        style={{ animation: exiting ? 'scrim-in 180ms ease-in reverse both' : 'scrim-in 180ms ease-out both' }}
        aria-hidden="true"
        onPointerDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Menu'}
        className={cn(
          'relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface pb-[env(safe-area-inset-bottom)] text-ink shadow-float',
          className
        )}
        style={{ animation: exiting ? 'sheet-out 180ms ease-in forwards' : 'sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-3">
            <div className="min-w-0">
              {title && <h2 className="font-display text-lg text-ink">{title}</h2>}
              {description && <p className="mt-1 text-sm text-ink-secondary">{description}</p>}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1">
              <XMarkIcon />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-autohide">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
