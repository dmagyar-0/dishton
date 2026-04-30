import { Minus, Plus } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cn } from '@/ui/cn';

export type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
};

const FRACTION_RE = /^\s*(-?\d+)?\s*(\d+)\s*\/\s*(\d+)\s*$/;
const DECIMAL_RE = /^-?\d*(?:\.\d+)?$/;

export function parseNumeric(input: string): number | null {
  if (input.trim() === '') return null;
  const fraction = FRACTION_RE.exec(input);
  if (fraction) {
    const whole = fraction[1] ? Number(fraction[1]) : 0;
    const num = Number(fraction[2]);
    const den = Number(fraction[3]);
    if (den === 0 || Number.isNaN(num) || Number.isNaN(den)) return null;
    const sign = whole < 0 || (fraction[1]?.trim().startsWith('-') ?? false) ? -1 : 1;
    const value = sign * (Math.abs(whole) + num / den);
    return Number.isFinite(value) ? value : null;
  }
  if (DECIMAL_RE.test(input.trim())) {
    const n = Number(input.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === 'number') v = Math.max(min, v);
  if (typeof max === 'number') v = Math.min(max, v);
  return v;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    { className, value, onValueChange, min, max, step = 1, ariaLabel, disabled, id, ...rest },
    ref,
  ) => {
    const [draft, setDraft] = useState<string>(String(value));

    useEffect(() => {
      setDraft(String(value));
    }, [value]);

    const commit = (raw: string) => {
      const parsed = parseNumeric(raw);
      if (parsed === null) {
        setDraft(String(value));
        return;
      }
      const next = clamp(parsed, min, max);
      onValueChange(next);
      setDraft(String(next));
    };

    const bump = (delta: number) => {
      const next = clamp(value + delta, min, max);
      onValueChange(next);
    };

    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 border-b-2 border-cream-line',
          'focus-within:border-saffron transition-colors duration-[var(--duration-fast)]',
          disabled && 'opacity-60 cursor-not-allowed',
          className,
        )}
      >
        <button
          type="button"
          aria-label="Decrement"
          onClick={() => bump(-step)}
          disabled={disabled || (typeof min === 'number' && value <= min)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-ink hover:bg-paper-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Minus aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            }
          }}
          className={cn(
            'w-16 bg-transparent text-center font-mono tabular-nums text-ink',
            'border-0 outline-none py-2',
            'disabled:cursor-not-allowed',
          )}
          {...rest}
        />
        <button
          type="button"
          aria-label="Increment"
          onClick={() => bump(step)}
          disabled={disabled || (typeof max === 'number' && value >= max)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-ink hover:bg-paper-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
      </div>
    );
  },
);
NumberInput.displayName = 'NumberInput';
