import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { cn } from './cn';

const controlBase =
  'w-full rounded-control border border-line bg-surface text-ink transition-colors duration-150 placeholder:text-ink-muted hover:border-line-strong focus:border-signal/70 focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-signal/10 disabled:cursor-not-allowed disabled:opacity-50';

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
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-[13px] font-medium text-ink">
          {label}
          {optional && <span className="text-[11.5px] font-normal text-ink-muted">Optional</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  invalid?: boolean;
}

export function Input({ className, invalid, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(controlBase, 'h-9 px-3 text-sm', invalid && 'border-danger/60', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
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
      className={cn(controlBase, 'resize-y px-3 py-2.5 text-sm leading-relaxed', invalid && 'border-danger/60', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ className, children, ref, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(controlBase, 'h-9 appearance-none pl-3 pr-9 text-sm', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  );
}
