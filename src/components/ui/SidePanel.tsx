import {
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

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
  ariaLabel?: string;
  className?: string;
  bodyClassName?: string;
  closeOnOutside?: boolean;
  closeOnEsc?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A non-modal inspector that slides in from the right. There is no scrim and
 * no scroll lock: the page stays available. Used for share settings and
 * pickers where a centred dialog would interrupt the task.
 */
export function SidePanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  ariaLabel,
  className,
  bodyClassName,
  closeOnOutside = true,
  closeOnEsc = true,
  initialFocusRef,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);
  // The panel is only truly full-width below 640px; from 640px it keeps its
  // desktop inspector bounded width and stays non-modal.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        panelRef.current;
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
      if (event.key === 'Escape' && closeOnEsc) {
        // A centred alert dialog on top owns Escape. Closing the inspector
        // underneath it would destroy the context the dialog is confirming.
        if (document.querySelector('[data-dialog-layer],[role="menu"]')) return;
        event.preventDefault();
        onClose();
        return;
      }

      // Below 640px the panel covers the page, so it behaves as a modal even
      // though the desktop inspector deliberately leaves the board available.
      if (!isMobile || event.key !== 'Tab') return;
      if (document.querySelector('[data-dialog-layer],[role="menu"]')) return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
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

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutside) return;
      const panel = panelRef.current;
      const target = event.target;
      if (!panel || !(target instanceof Node)) return;
      if (panel.contains(target)) return;
      // A nested alert dialog owns the interaction; closing the inspector
      // underneath it would destroy the context the dialog is confirming.
      if (target instanceof Element && target.closest('[data-dialog-layer]')) return;
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, closeOnEsc, closeOnOutside, onClose, isMobile]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal={isMobile ? 'true' : 'false'}
      aria-label={ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      tabIndex={-1}
      className={cn(
        'fixed inset-y-0 right-0 z-[1000] flex w-full flex-col border-l border-line bg-surface text-ink shadow-float outline-none',
        width === 'lg' ? 'sm:max-w-[32rem]' : 'sm:max-w-[26rem]',
        className
      )}
      style={{ animation: 'panel-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-4">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="break-words text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink"
          >
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mt-1.5 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-secondary"
            >
              {description}
            </p>
          )}
        </div>
        <IconButton
          label="Close panel"
          size="md"
          onClick={onClose}
          className="-mr-1 -mt-1 h-11 w-11 sm:h-9 sm:w-9"
        >
          <XMarkIcon />
        </IconButton>
      </header>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-autohide px-5 py-5',
          bodyClassName
        )}
      >
        {children}
      </div>

      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {footer}
        </footer>
      )}
    </aside>,
    document.body
  );
}
