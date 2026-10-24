import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useContentSizeBytes } from './useContentSize';

const BYTES_PER_MB = 1024 * 1024;

/** Practical editing limit: above this the markdown editor gets slow. */
export const CONTENT_SIZE_WARNING_BYTES = 5 * BYTES_PER_MB;

/** Must stay in sync with `0000015_raise_content_size_limit.js`. */
export const CONTENT_SIZE_HARD_LIMIT_BYTES = 100 * BYTES_PER_MB;

function formatMegabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

interface ContentSizeWarningProps {
  content: string;
}

export function ContentSizeWarning({ content }: ContentSizeWarningProps) {
  const bytes = useContentSizeBytes(content);

  if (bytes <= CONTENT_SIZE_WARNING_BYTES) {
    return null;
  }

  const overHardLimit = bytes > CONTENT_SIZE_HARD_LIMIT_BYTES;

  return (
    <div
      role={overHardLimit ? 'alert' : 'status'}
      aria-live={overHardLimit ? 'assertive' : 'polite'}
      className={`mx-3 mt-2 flex shrink-0 items-start gap-2.5 rounded-control border px-3 py-2.5 text-xs sm:mx-4 ${
        overHardLimit
          ? 'border-danger/35 bg-danger-soft text-danger'
          : 'border-warning/30 bg-warning-soft text-warning'
      }`}
    >
      <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          This note is {formatMegabytes(bytes)}
          {overHardLimit ? ` — over the ${formatMegabytes(CONTENT_SIZE_HARD_LIMIT_BYTES)} limit.` : '.'}
        </p>
        <p className="opacity-80">
          {overHardLimit
            ? 'It will not save. Upload the original file as an attachment instead.'
            : 'Notes over 5 MB can be slow to edit. For large files, upload the original file as an attachment instead.'}
        </p>
      </div>
    </div>
  );
}
