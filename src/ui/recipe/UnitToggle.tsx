import { cn } from '@/ui/cn';

export type UnitSystem = 'metric' | 'imperial';

export type UnitToggleProps = {
  value: UnitSystem;
  onChange: (value: UnitSystem) => void;
  className?: string;
};

const OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

export function UnitToggle({ value, onChange, className }: UnitToggleProps) {
  return (
    <div
      role="group"
      aria-label="Unit system"
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-cream-line bg-paper p-1',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[var(--radius-pill)] px-3 py-1 font-body text-sm',
              'transition-colors duration-[var(--duration-fast)]',
              active
                ? 'bg-saffron text-saffron-ink shadow-press'
                : 'bg-transparent text-ink hover:bg-paper-2',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
