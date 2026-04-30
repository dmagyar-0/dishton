import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/ui/cn';

const buttonStyles = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-body font-medium tracking-tight',
    'rounded-[var(--radius-md)] border border-transparent',
    'transition-[transform,box-shadow,background-color,color] duration-[var(--duration-fast)]',
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none',
    'select-none',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-saffron text-saffron-ink shadow-press',
          'hover:-translate-y-px hover:shadow-press-lg',
          'active:translate-y-0',
          'disabled:hover:translate-y-0',
        ],
        secondary: [
          'bg-sage text-sage-ink shadow-press',
          'hover:-translate-y-px hover:shadow-press-lg',
          'active:translate-y-0',
          'disabled:hover:translate-y-0',
        ],
        ghost: ['bg-transparent text-ink', 'hover:bg-paper-2'],
        destructive: [
          'bg-pomegranate text-paper shadow-press',
          'hover:-translate-y-px hover:shadow-press-lg',
          'active:translate-y-0',
          'disabled:hover:translate-y-0',
        ],
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & {
    loading?: boolean;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
  };

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-[spin_var(--duration-slow)_linear_infinite]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      data-testid="button-spinner"
    >
      <path d="M12 3 a 9 9 0 0 1 9 9" />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, loading, disabled, leftIcon, rightIcon, children, type, ...rest },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn(buttonStyles({ variant, size }), className)}
        disabled={disabled || loading}
        data-loading={loading ? '' : undefined}
        {...rest}
      >
        {loading ? <Spinner /> : leftIcon}
        {children !== undefined && <span className={cn(loading && 'opacity-80')}>{children}</span>}
        {!loading && rightIcon}
      </button>
    );
  },
);
Button.displayName = 'Button';
