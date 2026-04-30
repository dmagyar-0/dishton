import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type={type ?? 'text'}
        className={cn(
          'block w-full bg-transparent px-1 py-2 font-body text-ink',
          'border-0 border-b-2 border-cream-line outline-none',
          'placeholder:text-ink-muted',
          'transition-colors duration-[var(--duration-fast)]',
          'focus:border-saffron focus-visible:border-saffron',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = 'Input';
