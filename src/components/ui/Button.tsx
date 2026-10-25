import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-[13px] font-medium tracking-[-0.005em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal select-none [&>svg]:h-4 [&>svg]:w-4';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-signal-bright text-on-signal hover:bg-signal-bright-strong active:bg-signal-bright-strong',
  secondary:
    'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-raised',
  ghost: 'text-ink-secondary hover:bg-surface-raised hover:text-ink',
  danger: 'bg-danger text-on-danger hover:opacity-90',
  link: 'px-0 text-signal underline-offset-4 hover:text-signal-strong hover:underline',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px]',
  md: 'h-9 px-4',
  lg: 'h-11 px-5 text-[14px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        base,
        variant !== 'link' && sizes[size],
        variants[variant],
        className
      )}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconRight'> {
  label: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const iconSizes = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

const iconVariants: Record<ButtonVariant, string> = {
  ...variants,
  danger: 'text-danger hover:bg-danger-soft',
};

export function IconButton({
  label,
  children,
  className,
  variant = 'ghost',
  size = 'md',
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal [&>svg]:h-[1.15rem] [&>svg]:w-[1.15rem]',
        iconSizes[size],
        iconVariants[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
