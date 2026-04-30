import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/ui/cn';

const iconButtonStyles = cva(
  [
    'inline-flex items-center justify-center',
    'h-10 w-10 shrink-0',
    'rounded-[var(--radius-md)] border border-transparent',
    'transition-colors duration-[var(--duration-fast)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'select-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-saffron text-saffron-ink hover:shadow-press',
        secondary: 'bg-sage text-sage-ink hover:shadow-press',
        ghost: 'bg-transparent text-ink hover:bg-paper-2',
        outline: 'bg-transparent text-ink border-cream-line hover:bg-paper-2',
      },
    },
    defaultVariants: {
      variant: 'ghost',
    },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> &
  VariantProps<typeof iconButtonStyles> & {
    label: string;
    icon?: ReactNode;
    children?: ReactNode;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, label, icon, children, type, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        className={cn(iconButtonStyles({ variant }), className)}
        {...rest}
      >
        <span aria-hidden="true" className="inline-flex">
          {icon ?? children}
        </span>
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
