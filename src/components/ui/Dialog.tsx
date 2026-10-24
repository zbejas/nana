import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { cn } from './cn';
import { IconButton } from './Button';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClasses: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-6xl',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// A single stack shared by dialogs and sheets keeps nested modals and their
// scrims in the right order, no matter which component opened them.
const openLayers: symbol[] = [];
let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  if (scrollLocks === 1) {
    document.body.style.overflow = 'hidden';
  }
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = '';
  }
}

export function useLayer(open: boolean) {
  const [zIndex, setZIndex] = useState(1000);
  const tokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (!open) return;

    const token = Symbol('layer');
    tokenRef.current = token;
    openLayers.push(token);
    setZIndex(1000 + openLayers.length * 20);
    lockScroll();

    return () => {
      const index = openLayers.indexOf(token);
      if (index !== -1) {
        openLayers.splice(index, 1);
      }
      if (tokenRef.current === token) {
        tokenRef.current = null;
      }
      unlockScroll();
    };
  }, [open]);

  const isTop = useCallback(() => {
    return tokenRef.current !== null && openLayers[openLayers.length - 1] === tokenRef.current;
  }, []);

  return { zIndex, isTop };
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  showClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
  bare?: boolean;
  ariaLabel?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showClose = true,
  initialFocusRef,
  className,
  bodyClassName,
  bare = false,
  ariaLabel,
}: DialogProps) {
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { zIndex, isTop } = useLayer(open);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Keep the panel mounted through its exit animation.
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
    }, 160);

    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Focus management: remember the trigger, focus inside, restore on close.
  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement | null;

    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const restore = previousFocus.current;
      if (restore && document.contains(restore)) {
        restore.focus({ preventScroll: true });
      }
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;

      if (event.key === 'Escape' && closeOnEsc) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose, closeOnEsc, isTop]);

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-6"
      style={{ zIndex }}
    >
      <div
        className="absolute inset-0 bg-scrim"
        style={{
          animation: exiting
            ? 'scrim-in 160ms ease-in reverse both'
            : 'scrim-in 200ms ease-out both',
        }}
        aria-hidden="true"
        onPointerDown={() => {
          if (closeOnBackdrop) {
            onClose();
          }
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={!title ? ariaLabel : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden border border-line bg-surface text-ink shadow-float outline-none',
          'rounded-t-sheet sm:max-h-[calc(100dvh-3rem)] sm:rounded-panel',
          sizeClasses[size],
          className
        )}
        style={{
          animation: exiting
            ? 'dialog-out 160ms ease-in forwards'
            : 'dialog-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {!bare && (title || showClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 sm:py-5">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-ink">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-ink-secondary">
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <IconButton label="Close dialog" size="sm" onClick={onClose} className="-mr-1 -mt-1">
                <XMarkIcon />
              </IconButton>
            )}
          </div>
        )}

        {children !== undefined && children !== null && (
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto scrollbar-autohide',
              !bare && (bodyClassName ?? 'px-5 py-5 sm:px-6'),
              bare && bodyClassName
            )}
          >
            {children}
          </div>
        )}

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
