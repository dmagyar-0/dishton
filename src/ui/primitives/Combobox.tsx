import { ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { cn } from '@/ui/cn';

export type ComboboxOption = {
  value: string;
  label: string;
};

export type ComboboxProps = {
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(
  (
    {
      options,
      value,
      onValueChange,
      placeholder = 'Select...',
      emptyMessage = 'No matches',
      className,
      id,
      disabled,
      ariaLabel,
    },
    ref,
  ) => {
    const listboxId = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
      const selected = options.find((o) => o.value === value);
      setQuery(selected ? selected.label : '');
    }, [value, options]);

    useEffect(() => {
      if (!open) return;
      const handler = (event: MouseEvent) => {
        const node = containerRef.current;
        if (node && !node.contains(event.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const filtered = options.filter((o) =>
      o.label.toLowerCase().includes(query.trim().toLowerCase()),
    );

    const select = (opt: ComboboxOption) => {
      onValueChange?.(opt.value);
      setQuery(opt.label);
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        if (open && filtered[activeIndex]) {
          e.preventDefault();
          select(filtered[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    const setRefs = (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
    };

    return (
      <div ref={containerRef} className={cn('relative inline-block w-full', className)}>
        <span className="relative inline-flex w-full items-center">
          <input
            ref={setRefs}
            id={id}
            role="combobox"
            type="text"
            autoComplete="off"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
            }
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              'block w-full bg-transparent px-1 py-2 pr-8 font-body text-ink',
              'border-0 border-b-2 border-cream-line outline-none',
              'placeholder:text-ink-muted',
              'transition-colors duration-[var(--duration-fast)]',
              'focus:border-saffron focus-visible:border-saffron',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-1 text-ink-soft"
            size={16}
            strokeWidth={1.5}
          />
        </span>
        {open && (
          <ul
            id={listboxId}
            role="listbox"
            className={cn(
              'absolute z-10 mt-1 max-h-60 w-full overflow-auto py-1',
              'bg-paper-2 border border-cream-line shadow-press rounded-[var(--radius-md)]',
            )}
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-ink-muted text-sm">{emptyMessage}</li>
            ) : (
              filtered.map((opt, index) => {
                const active = index === activeIndex;
                const selected = opt.value === value;
                return (
                  <li
                    key={opt.value}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(opt);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-ink',
                      active && 'bg-paper',
                      selected && 'font-medium text-saffron-ink',
                    )}
                  >
                    {opt.label}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
    );
  },
);
Combobox.displayName = 'Combobox';
