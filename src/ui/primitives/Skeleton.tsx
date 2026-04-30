import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(({ className, ...rest }, ref) => {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="skeleton"
      className={cn(
        'block bg-paper-2 rounded-[var(--radius-md)]',
        'animate-[pulse_var(--duration-slow)_ease-in-out_infinite]',
        className,
      )}
      {...rest}
    />
  );
});
Skeleton.displayName = 'Skeleton';
