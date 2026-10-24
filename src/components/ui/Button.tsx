import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember select-none';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-ember text-on-ember hover:bg-ember-strong active:bg-ember shadow-[0_1px_0_0_rgb(255_255_255/0.12)_inset]',
  secondary:
    'border border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-surface-sunken',
  ghost: 'text-ink-secondary hover:bg-surface-raised hover:text-ink',
  danger:
    'border border-danger bg-danger text-on-danger hover:border-danger/90 hover:bg-danger/90',
  link: 'px-0 text-ember underline-offset-4 hover:text-ember-strong hover:underline',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
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
        variant === 'link' && 'text-sm',
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
  sm: 'h-8 w-8',
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
        'inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember [&>svg]:h-[1.15rem] [&>svg]:w-[1.15rem]',
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
