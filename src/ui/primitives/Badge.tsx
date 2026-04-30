import { type VariantProps, cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

const badgeStyles = cva(
  [
    'inline-flex items-center gap-1 px-2 py-0.5',
    'rounded-[var(--radius-pill)] border',
    'font-body text-xs font-medium',
  ],
  {
    variants: {
      variant: {
        default: 'bg-paper-2 text-ink border-cream-line',
        secondary: 'bg-sage text-sage-ink border-sage',
        outline: 'bg-transparent text-ink border-cream-line',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...rest }, ref) => {
    return <span ref={ref} className={cn(badgeStyles({ variant }), className)} {...rest} />;
  },
);
Badge.displayName = 'Badge';

export const Tag = Badge;
export type TagProps = BadgeProps;
