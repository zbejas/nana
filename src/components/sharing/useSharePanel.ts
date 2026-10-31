import { useCallback, useState } from 'react';
import type { ShareTargetType } from '../../lib/sharing';

export interface SharePanelTarget {
  targetType: ShareTargetType;
  targetId: string;
  targetTitle: string;
  folderId?: string;
  folderName?: string;
  onChanged?: () => void;
}

/**
 * Optional open/close state for surfaces that need to trigger the share panel
 * from a menu item instead of rendering a ShareButton. The state is local, so a
 * page owns exactly one panel when it uses this hook.
 */
export function useSharePanel() {
  const [target, setTarget] = useState<SharePanelTarget | null>(null);

  const openSharePanel = useCallback((next: SharePanelTarget) => {
    setTarget(next);
  }, []);

  const closeSharePanel = useCallback(() => {
    setTarget(null);
  }, []);

  return {
    target,
    isOpen: target !== null,
    openSharePanel,
    closeSharePanel,
  };
}
