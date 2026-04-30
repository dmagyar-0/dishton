import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows, ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows ?? 4}
        className={cn(
          'block w-full bg-transparent px-1 py-2 font-body text-ink',
          'border-0 border-b-2 border-cream-line outline-none',
          'placeholder:text-ink-muted',
          'transition-colors duration-[var(--duration-fast)]',
          'focus:border-saffron focus-visible:border-saffron',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'resize-y',
          className,
        )}
        {...rest}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
