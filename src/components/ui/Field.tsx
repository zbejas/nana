import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ChevronDownIcon, ExclamationCircleIcon } from '@heroicons/react/20/solid';
import { cn } from './cn';

const controlBase =
  'w-full rounded-control border border-line bg-surface-sunken text-ink caret-signal transition-[background-color,border-color,box-shadow,color] duration-150 placeholder:text-ink-muted hover:border-line-strong focus:border-signal/60 focus:bg-surface focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-signal/10 disabled:cursor-not-allowed disabled:bg-surface-sunken/60 disabled:opacity-55';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}

export function Field({ label, hint, error, htmlFor, children, className, optional }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-baseline gap-2 text-[12.5px] font-medium leading-none text-ink"
        >
          {label}
          {optional && (
            <span className="text-[11px] font-normal text-ink-muted">Optional</span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-danger">
          <ExclamationCircleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[11.5px] leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  invalid?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export function Input({
  className,
  invalid,
  icon,
  trailing,
  ref,
  ...rest
}: InputProps) {
  const input = (
    <input
      ref={ref}
      className={cn(
        controlBase,
        'h-10 px-3.5 text-[13.5px]',
        Boolean(icon) && 'pl-10',
        Boolean(trailing) && 'pr-11',
        invalid && 'border-danger/60 focus:border-danger/70 focus:ring-danger/10',
        className
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );

  if (!icon && !trailing) {
    return input;
  }

  return (
    <div className="relative">
      {icon && (
        <span
          className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-ink-muted [&>svg]:h-4 [&>svg]:w-4"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      {input}
      {trailing && (
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
          {trailing}
        </span>
      )}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  invalid?: boolean;
}

export function Textarea({ className, invalid, ref, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        controlBase,
        'min-h-24 resize-y px-3.5 py-3 text-[13.5px] leading-relaxed',
        invalid && 'border-danger/60 focus:border-danger/70 focus:ring-danger/10',
        className
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
  invalid?: boolean;
}

export function Select({ className, children, ref, invalid, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          controlBase,
          'h-10 appearance-none pl-3.5 pr-10 text-[13.5px]',
          invalid && 'border-danger/60 focus:border-danger/70 focus:ring-danger/10',
          className
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  );
}
