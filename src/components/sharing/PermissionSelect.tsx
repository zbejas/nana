import { useId } from 'react';
import type { AccessRole } from '../../lib/sharing';
import { cn, Select } from '../ui';
import {
  PERMISSION_OPTIONS,
  isSharePermission,
  permissionDescription,
  type PermissionValue,
} from './share-copy';

interface PermissionSelectProps {
  value: AccessRole | PermissionValue;
  onChange?: (permission: 'view' | 'comment' | 'edit') => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  selectClassName?: string;
  size?: 'sm' | 'md';
}

/**
 * Compact permission picker for a person row. Owner and null values are not
 * editable; the native select keeps keyboard and mobile behavior consistent
 * with the rest of the form primitives.
 */
export function PermissionSelect({
  value,
  onChange,
  disabled,
  label = 'Permission',
  className,
  selectClassName,
  size = 'sm',
}: PermissionSelectProps) {
  const id = useId();

  if (!isSharePermission(value)) {
    return (
      <span
        className={cn(
          'inline-flex h-8 items-center rounded-control border border-line bg-surface-sunken px-2.5 text-[12px] font-medium text-ink-muted',
          className
        )}
      >
        {value === 'owner' ? 'Owner' : 'No access'}
      </span>
    );
  }

  return (
    <div className={cn('shrink-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        disabled={disabled || !onChange}
        aria-label={label}
        title={permissionDescription(value)}
        onChange={(event) => {
          const next = event.target.value;
          if (isSharePermission(next)) onChange?.(next);
        }}
        className={cn(
          'w-auto min-w-[7.75rem] pl-2.5 pr-8 text-[12px] font-medium',
          size === 'sm' ? 'h-11 sm:h-8' : 'h-11 sm:h-9',
          selectClassName
        )}
      >
        {PERMISSION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
