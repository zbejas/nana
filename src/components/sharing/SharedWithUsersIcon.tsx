import { UsersIcon } from '@heroicons/react/24/outline';

interface SharedWithUsersIconProps {
  className?: string;
}

/** Status marker for a record the owner has shared directly with people. */
export function SharedWithUsersIcon({ className = 'h-3 w-3' }: SharedWithUsersIconProps) {
  return (
    <UsersIcon
      className={`${className} shrink-0 text-signal`}
      aria-label="Shared with people"
    />
  );
}
