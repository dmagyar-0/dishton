import { createContext, forwardRef, useContext, useId, useMemo, useRef } from 'react';
import type { HTMLAttributes, InputHTMLAttributes, KeyboardEvent } from 'react';

import { cn } from '@/ui/cn';

type Orientation = 'row' | 'column';

type RadioGroupContextValue = {
  name: string;
  value: string | undefined;
  onChange: (value: string) => void;
  orientation: Orientation;
  disabled: boolean;
  registerItem: (el: HTMLInputElement | null, value: string) => void;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function useRadioGroupContext(componentName: string) {
  const ctx = useContext(RadioGroupContext);
  if (!ctx) {
    throw new Error(`<${componentName}> must be rendered inside <RadioGroup>`);
  }
  return ctx;
}

export type RadioGroupProps = HTMLAttributes<HTMLDivElement> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: Orientation;
  disabled?: boolean;
  name?: string;
};

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  (
    {
      className,
      children,
      value,
      defaultValue,
      onValueChange,
      orientation = 'column',
      disabled = false,
      name,
      ...rest
    },
    ref,
  ) => {
    const autoName = useId();
    const itemsRef = useRef<Map<string, HTMLInputElement>>(new Map());
    const internalValueRef = useRef<string | undefined>(defaultValue);
    const current = value ?? internalValueRef.current;

    const ctx = useMemo<RadioGroupContextValue>(
      () => ({
        name: name ?? `radio-${autoName}`,
        value: current,
        orientation,
        disabled,
        onChange: (next) => {
          internalValueRef.current = next;
          onValueChange?.(next);
        },
        registerItem: (el, val) => {
          if (el) itemsRef.current.set(val, el);
          else itemsRef.current.delete(val);
        },
      }),
      [name, autoName, current, orientation, disabled, onValueChange],
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const isHorizontal = orientation === 'row';
      const next = isHorizontal ? 'ArrowRight' : 'ArrowDown';
      const prev = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
      if (e.key !== next && e.key !== prev) return;
      e.preventDefault();
      const entries = Array.from(itemsRef.current.entries()).filter(([, el]) => !el.disabled);
      if (entries.length === 0) return;
      const idx = entries.findIndex(([val]) => val === current);
      const dir = e.key === next ? 1 : -1;
      const start = idx === -1 ? 0 : idx;
      const target = entries[(start + dir + entries.length) % entries.length];
      if (!target) return;
      const [tVal, tEl] = target;
      tEl.focus();
      ctx.onChange(tVal);
    };

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-orientation={orientation === 'row' ? 'horizontal' : 'vertical'}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'inline-flex',
          orientation === 'row' ? 'flex-row gap-4' : 'flex-col gap-2',
          className,
        )}
        {...rest}
      >
        <RadioGroupContext.Provider value={ctx}>{children}</RadioGroupContext.Provider>
      </div>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';

export type RadioGroupItemProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'value' | 'onChange'
> & {
  value: string;
  label?: string;
};

export const RadioGroupItem = forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ className, value, label, id, disabled, ...rest }, ref) => {
    const ctx = useRadioGroupContext('RadioGroupItem');
    const checked = ctx.value === value;
    const isDisabled = disabled || ctx.disabled;

    const setRefs = (el: HTMLInputElement | null) => {
      ctx.registerItem(el, value);
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
    };

    return (
      <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
        <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
          <input
            ref={setRefs}
            type="radio"
            id={id}
            name={ctx.name}
            value={value}
            checked={checked}
            disabled={isDisabled}
            onChange={() => ctx.onChange(value)}
            className="peer absolute inset-0 h-[18px] w-[18px] cursor-pointer appearance-none rounded-full border-2 border-ink bg-paper outline-none disabled:cursor-not-allowed disabled:opacity-60"
            {...rest}
          />
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute h-2 w-2 rounded-full bg-saffron transition-transform duration-[var(--duration-fast)]',
              checked ? 'scale-100' : 'scale-0',
            )}
          />
        </span>
        {label != null && <span className="font-body text-ink">{label}</span>}
      </label>
    );
  },
);
RadioGroupItem.displayName = 'RadioGroupItem';
