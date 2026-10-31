import type { ReactNode } from 'react';
import {
  ChevronRightIcon,
  DocumentTextIcon,
  FolderIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import type { AccessRole, ShareTargetType } from '../../lib/sharing';
import { Badge, cn } from '../ui';
import { PermissionBadge } from './PermissionBadge';
import type { PermissionValue } from './share-copy';

const TYPE_ICONS = {
  document: DocumentTextIcon,
  folder: FolderIcon,
  board: ViewColumnsIcon,
} as const;

interface SharedItemRowProps {
  type: ShareTargetType;
  title: string;
  subtitle?: ReactNode;
  permission?: AccessRole | PermissionValue;
  inherited?: boolean;
  activity?: string;
  activityTitle?: string;
  onOpen: () => void;
  menu?: ReactNode;
  className?: string;
}

/**
 * One shared-record row for both "Shared with me" and a shared folder. The
 * main target is a single button with the chevron inside it; the overflow menu
 * is a sibling so there is never a button inside a button and no hover-only
 * action.
 */
export function SharedItemRow({
  type,
  title,
  subtitle,
  permission,
  inherited,
  activity,
  activityTitle,
  onOpen,
  menu,
  className,
}: SharedItemRowProps) {
  const Icon = TYPE_ICONS[type];

  return (
    <li
      className={cn(
        'relative flex min-h-[64px] items-stretch border-b border-line last:border-b-0',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal sm:px-4"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted [&>svg]:h-[18px] [&>svg]:w-[18px]">
          <Icon aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate text-[13.5px] font-medium leading-snug text-ink">
              {title}
            </span>
            {permission && <PermissionBadge permission={permission} />}
            {inherited && (
              <span title="Access comes from a shared folder" className="inline-flex">
                <Badge tone="neutral">Inherited</Badge>
              </span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] leading-relaxed text-ink-muted">
            {subtitle}
            {subtitle && activity && <span aria-hidden="true">·</span>}
            {activity && (
              <span className="tabular-nums" title={activityTitle}>
                {activity}
              </span>
            )}
          </span>
        </span>

        <ChevronRightIcon
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
      </button>

      {menu && <div className="flex items-center pr-1.5 sm:pr-2">{menu}</div>}
    </li>
  );
}
