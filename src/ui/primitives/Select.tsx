import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...rest }, ref) => {
    return (
      <span className="relative inline-flex w-full items-center">
        <select
          ref={ref}
          className={cn(
            'block w-full appearance-none bg-transparent pr-8 pl-1 py-2 font-body text-ink',
            'border-0 border-b-2 border-cream-line outline-none cursor-pointer',
            'transition-colors duration-[var(--duration-fast)]',
            'focus:border-saffron focus-visible:border-saffron',
            'disabled:cursor-not-allowed disabled:opacity-60',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-1 text-ink-soft"
          size={16}
          strokeWidth={1.5}
        />
      </span>
    );
  },
);
Select.displayName = 'Select';
