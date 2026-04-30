import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, label, id, ...rest }, ref) => {
    return (
      <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
        <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
          <input
            ref={ref}
            type="checkbox"
            checked={checked}
            id={id}
            className="peer absolute inset-0 h-[18px] w-[18px] cursor-pointer appearance-none rounded-[3px] bg-paper outline-none [box-shadow:var(--shadow-stamp)] checked:bg-saffron checked:[box-shadow:none] disabled:cursor-not-allowed disabled:opacity-60"
            {...rest}
          />
          <svg
            viewBox="0 0 18 18"
            className="pointer-events-none relative h-[18px] w-[18px] text-saffron-ink opacity-0 peer-checked:opacity-100 transition-opacity duration-[var(--duration-fast)]"
            aria-hidden="true"
          >
            <path
              d="M3.5 9.5 L7.5 13 L14.5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="[stroke-dasharray:1] [stroke-dashoffset:1] peer-checked:[stroke-dashoffset:0] [transition:stroke-dashoffset_var(--duration-base)_var(--ease-stamp)]"
              style={{ strokeDashoffset: checked ? 0 : 1 }}
            />
          </svg>
        </span>
        {label != null && <span className="font-body text-ink">{label}</span>}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
