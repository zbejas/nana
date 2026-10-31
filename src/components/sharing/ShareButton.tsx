import { ShareIcon } from '@heroicons/react/24/outline';
import type { ButtonSize, ButtonVariant } from '../ui';
import { Button, IconButton } from '../ui';
import type { ShareTargetType } from '../../lib/sharing';
import { SharePanel } from './SharePanel';
import { useSharePanel } from './useSharePanel';

export interface ShareButtonProps {
  targetType: ShareTargetType;
  targetId: string;
  targetTitle: string;
  folderId?: string;
  folderName?: string;
  onChanged?: () => void;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  /** Small icon-only header action; label still becomes the accessible name. */
  iconOnly?: boolean;
}

/**
 * A drop-in share entry point. It owns its panel, so a page can render the
 * button in a header or menu without adding separate open state. The parent
 * should pass its folder id when known so inherited access can be explained.
 */
export function ShareButton({
  targetType,
  targetId,
  targetTitle,
  folderId,
  folderName,
  onChanged,
  label = 'Share',
  variant = 'secondary',
  size = 'md',
  className,
  disabled,
  iconOnly = false,
}: ShareButtonProps) {
  const { target, openSharePanel, closeSharePanel } = useSharePanel();

  const openPanel = () => {
    openSharePanel({
      targetType,
      targetId,
      targetTitle,
      folderId,
      folderName,
      onChanged,
    });
  };

  return (
    <>
      {iconOnly ? (
        <IconButton
          label={label}
          size="md"
          className={className}
          onClick={openPanel}
          disabled={disabled}
        >
          <ShareIcon />
        </IconButton>
      ) : (
        <Button
          variant={variant}
          size={size}
          className={className}
          icon={<ShareIcon />}
          onClick={openPanel}
          disabled={disabled}
        >
          {label}
        </Button>
      )}

      {target && (
        <SharePanel
          open
          onClose={closeSharePanel}
          targetType={target.targetType}
          targetId={target.targetId}
          targetTitle={target.targetTitle}
          folderId={target.folderId}
          folderName={target.folderName}
          onChanged={target.onChanged}
        />
      )}
    </>
  );
}
