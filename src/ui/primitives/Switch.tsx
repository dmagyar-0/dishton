import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, label, disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-pill)]',
          'transition-colors duration-[var(--duration-fast)]',
          'border border-cream-line',
          checked ? 'bg-sage' : 'bg-paper-2',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-[var(--radius-pill)] bg-paper shadow-press',
            'transition-transform duration-[var(--duration-fast)]',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
    );
  },
);
Switch.displayName = 'Switch';
