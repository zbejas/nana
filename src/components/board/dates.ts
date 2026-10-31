const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Small ledger date: "2h ago" within the last day, then "Oct 23" (with a year
 * once the date leaves the current year). Invalid or missing values stay blank.
 */
export function formatRelativeDate(value: string | undefined | null): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff >= 0 && diff < MINUTE) return 'Just now';
  if (diff >= 0 && diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))}m ago`;
  if (diff >= 0 && diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Two-digit ledger counts: 03, 12, 104. */
export function padCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}
