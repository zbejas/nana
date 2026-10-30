import { useId, type FormEventHandler, type ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { cn } from './cn';
import { IconButton } from './Button';

interface InlineFormProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
  /** Submitting turns the panel into a real form so Enter and requestSubmit work. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  formId?: string;
  ariaLabel?: string;
}

/**
 * A flat, in-page form panel. This is the replacement for data-entry dialogs:
 * the form appears where the thing it edits lives, with no scrim or focus trap.
 */
export function InlineForm({
  title,
  description,
  children,
  footer,
  actions,
  onClose,
  closeLabel = 'Close form',
  className,
  bodyClassName,
  footerClassName,
  onSubmit,
  formId,
  ariaLabel,
}: InlineFormProps) {
  const titleId = useId();
  const descriptionId = useId();
  const wrapperClass = cn(
    'animate-slideDown overflow-hidden rounded-panel border border-line bg-surface text-ink',
    className
  );

  const header = (title || description || actions || onClose) && (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
      <div className="min-w-0">
        {title && (
          <h2
            id={titleId}
            className="break-words text-[16px] font-semibold leading-snug tracking-[-0.015em] text-ink"
          >
            {title}
          </h2>
        )}
        {description && (
          <p
            id={descriptionId}
            className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-secondary"
          >
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {onClose && (
          <IconButton label={closeLabel} size="md" onClick={onClose} className="-mr-1 -mt-1">
            <XMarkIcon />
          </IconButton>
        )}
      </div>
    </div>
  );

  const body = (
    <div className={cn('px-5 py-5 sm:px-6', bodyClassName)}>{children}</div>
  );

  const footerNode = footer && (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5 sm:px-6',
        footerClassName
      )}
    >
      {footer}
    </div>
  );

  if (onSubmit) {
    return (
      <form
        id={formId}
        onSubmit={onSubmit}
        className={wrapperClass}
        aria-label={!title ? ariaLabel : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
      >
        {header}
        {body}
        {footerNode}
      </form>
    );
  }

  return (
    <section
      className={wrapperClass}
      aria-label={!title ? ariaLabel : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
    >
      {header}
      {body}
      {footerNode}
    </section>
  );
}
