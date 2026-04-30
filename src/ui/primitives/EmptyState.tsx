import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/ui/cn';

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, title, description, action, icon, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        className={cn(
          'flex flex-col items-center justify-center gap-3 py-12 text-center',
          'border border-dashed border-cream-line rounded-[var(--radius-lg)] bg-paper',
          className,
        )}
        {...rest}
      >
        {icon && (
          <span aria-hidden="true" className="text-ink-muted">
            {icon}
          </span>
        )}
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        {description && <p className="font-body text-ink-soft max-w-prose">{description}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  },
);
EmptyState.displayName = 'EmptyState';
