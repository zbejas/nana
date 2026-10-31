import type { AccessRole } from '../../lib/sharing';
import { Badge } from '../ui';
import {
  permissionDescription,
  permissionLabel,
  type PermissionValue,
} from './share-copy';

interface PermissionBadgeProps {
  permission: AccessRole | PermissionValue | null | undefined;
  className?: string;
}

/**
 * Grantee permissions use the outline badge; the owner keeps the neutral
 * badge so "Owner" never reads like another grant level.
 */
export function PermissionBadge({ permission, className }: PermissionBadgeProps) {
  const owner = permission === 'owner';
  return (
    <span title={permissionDescription(permission)} className="inline-flex">
      <Badge tone={owner ? 'neutral' : 'outline'} className={className}>
        {permissionLabel(permission)}
      </Badge>
    </span>
  );
}
