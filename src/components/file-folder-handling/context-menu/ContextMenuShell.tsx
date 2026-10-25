import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { MenuSurface, Sheet } from '../../ui';
import { MenuItem } from '../../ui';

interface ContextMenuShellProps {
  open: boolean;
  x: number;
  y: number;
  title: string;
  onClose: () => void;
  children: ReactNode;
  contextMenuRef?: RefObject<HTMLDivElement | null>;
  isClosing?: boolean;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

/**
 * One menu surface for every context menu: a floating panel on desktop, a
 * bottom sheet with comfortable touch rows on mobile.
 */
export function ContextMenuShell({
  open,
  x,
  y,
  title,
  onClose,
  children,
}: ContextMenuShellProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onClose={onClose} title={title}>
        <div className="px-2 pb-2">{children}</div>
      </Sheet>
    );
  }

  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(y, window.innerHeight - 352));

  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      position={{ top, left }}
      ariaLabel={title}
      className="max-h-[min(70vh,22rem)] min-w-[14rem] overflow-y-auto scrollbar-autohide"
    >
      <div className="pb-1">
        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold text-ink-muted">{title}</p>
        {children}
      </div>
    </MenuSurface>
  );
}

interface ContextMenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
}

export function ContextMenuItem({ icon, label, onClick, danger, hint }: ContextMenuItemProps) {
  return <MenuItem icon={icon} label={label} onClick={onClick} tone={danger ? 'danger' : 'default'} hint={hint} />;
}

export function ContextMenuSeparator() {
  return <div className="my-1.5 border-t border-line" role="separator" />;
}
