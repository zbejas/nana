import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

interface MenuSurfaceProps {
  open: boolean;
  onClose: () => void;
  position: CSSProperties;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * Floating desktop menu. Position is supplied by the caller (pointer position
 * or an anchor rect); this owns the scrim, escape handling, and panel look.
 */
export function MenuSurface({ open, onClose, position, children, className, ariaLabel }: MenuSurfaceProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);

    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.cancelAnimationFrame(frame);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={ariaLabel}
      className={cn(
        'fixed z-[1100] min-w-[13rem] max-w-[18rem] overflow-hidden rounded-control border border-line bg-surface-raised py-1.5 shadow-float outline-none',
        className
      )}
      style={{ ...position, animation: 'pop-in 140ms ease-out both' }}
    >
      {children}
    </div>,
    document.body
  );
}

interface MenuItemProps {
  label: string;
  icon?: ReactNode;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

export function MenuItem({ label, icon, hint, onClick, disabled, tone = 'default' }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40',
        tone === 'danger'
          ? 'text-danger hover:bg-danger-soft'
          : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
        '[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0'
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1.5 border-t border-line" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{children}</p>;
}
