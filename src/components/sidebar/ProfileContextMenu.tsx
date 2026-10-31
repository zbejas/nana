import {
  ArrowRightOnRectangleIcon,
  Cog6ToothIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
import { MenuItem, MenuSeparator, MenuSurface } from '../ui';
import { useTheme } from '../../lib/theme';

interface ProfileContextMenuProps {
  isOpen: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSignOut: () => void;
  onSettings?: () => void;
  position?: 'below' | 'above' | 'right';
}

export function ProfileContextMenu({
  isOpen,
  anchorRect,
  onClose,
  onSignOut,
  onSettings,
  position = 'below',
}: ProfileContextMenuProps) {
  const { resolved, setTheme } = useTheme();

  if (!isOpen || !anchorRect) return null;

  const style: React.CSSProperties =
    position === 'right'
      ? { top: Math.max(8, anchorRect.top), left: anchorRect.right + 8 }
      : position === 'above'
        ? { bottom: Math.max(8, window.innerHeight - anchorRect.top + 6), left: anchorRect.left }
        : { top: anchorRect.bottom + 6, left: anchorRect.left };

  return (
    <MenuSurface open={isOpen} onClose={onClose} position={style} ariaLabel="Profile menu" className="min-w-[13rem]">
      {onSettings && (
        <MenuItem
          icon={<Cog6ToothIcon />}
          label="Settings"
          onClick={() => {
            onSettings();
            onClose();
          }}
        />
      )}
      <MenuItem
        icon={resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
        label={resolved === 'dark' ? 'Light appearance' : 'Dark appearance'}
        hint={resolved === 'dark' ? 'Day' : 'Night'}
        onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
      />
      <MenuSeparator />
      <MenuItem
        icon={<ArrowRightOnRectangleIcon />}
        label="Sign out"
        tone="danger"
        onClick={() => {
          onSignOut();
          onClose();
        }}
      />
    </MenuSurface>
  );
}
