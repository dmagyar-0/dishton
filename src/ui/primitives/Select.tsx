import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { cn } from '@/ui/cn';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  options: readonly SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
};

const TYPEAHEAD_RESET_MS = 500;

/**
 * Themed single-select dropdown. Implemented as the WAI-ARIA "select-only
 * combobox" (button trigger + listbox popup) so the option list can be styled
 * with our tokens — a native `<select>` popup is drawn by the OS and ignores the
 * theme.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    { options, value, onValueChange, placeholder = 'Select…', disabled, id, ariaLabel, className },
    ref,
  ) => {
    const listboxId = useId();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);
    const typeahead = useRef({ buffer: '', at: 0 });
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const selectedIndex = options.findIndex((o) => o.value === value);
    const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

    // Close when clicking outside the control.
    useEffect(() => {
      if (!open) return;
      const handler = (event: MouseEvent) => {
        const node = containerRef.current;
        if (node && !node.contains(event.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Keep the active option scrolled into view.
    useEffect(() => {
      if (!open) return;
      const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex]);

    const openList = () => {
      if (disabled) return;
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(options));
      setOpen(true);
    };

    const commit = (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      onValueChange?.(opt.value);
      setOpen(false);
    };

    const step = (delta: number) => {
      setActiveIndex((i) => {
        let next = i;
        for (let n = 0; n < options.length; n++) {
          next = (next + delta + options.length) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return i;
      });
    };

    const runTypeahead = (char: string) => {
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at > TYPEAHEAD_RESET_MS ? char : t.buffer + char;
      t.at = now;
      const q = t.buffer.toLowerCase();
      const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
      if (match >= 0) setActiveIndex(match);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        open ? step(1) : openList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        open ? step(-1) : openList();
      } else if (e.key === 'Home' && open) {
        e.preventDefault();
        setActiveIndex(firstEnabled(options));
      } else if (e.key === 'End' && open) {
        e.preventDefault();
        setActiveIndex(lastEnabled(options));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open ? commit(activeIndex) : openList();
      } else if (e.key === 'Escape') {
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
      } else if (e.key === 'Tab') {
        setOpen(false);
      } else if (e.key.length === 1) {
        if (!open) openList();
        runTypeahead(e.key);
      }
    };

    return (
      <div ref={containerRef} className={cn('relative inline-block w-full', className)}>
        <button
          ref={ref}
          type="button"
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          className={cn(
            'relative block w-full bg-transparent py-2 pr-8 pl-1 text-left font-body',
            selected ? 'text-ink' : 'text-ink-muted',
            'cursor-pointer border-0 border-b-2 border-cream-line outline-none',
            'transition-colors duration-[var(--duration-fast)]',
            'focus:border-saffron focus-visible:border-saffron',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <span className="block truncate">{selected ? selected.label : placeholder}</span>
          <ChevronDown
            aria-hidden="true"
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-1 text-ink-soft"
            size={16}
            strokeWidth={1.5}
          />
        </button>
        {open && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              'absolute z-10 mt-1 max-h-60 w-full overflow-auto py-1',
              'rounded-[var(--radius-md)] border border-cream-line bg-paper-2 shadow-press',
            )}
          >
            {options.map((opt, index) => {
              const active = index === activeIndex;
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseEnter={() => {
                    if (!opt.disabled) setActiveIndex(index);
                  }}
                  onClick={() => commit(index)}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-2 text-ink',
                    opt.disabled ? 'cursor-not-allowed text-ink-muted' : 'cursor-pointer',
                    active && !opt.disabled && 'bg-paper',
                    isSelected && 'font-medium',
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <Check
                      aria-hidden="true"
                      className="shrink-0 text-saffron"
                      size={16}
                      strokeWidth={1.5}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';

function firstEnabled(options: readonly SelectOption[]): number {
  const i = options.findIndex((o) => !o.disabled);
  return i >= 0 ? i : 0;
}

function lastEnabled(options: readonly SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i;
  }
  return 0;
}
