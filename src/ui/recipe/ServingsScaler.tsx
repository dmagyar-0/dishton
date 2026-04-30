import { cn } from '@/ui/cn';
import { NumberInput } from '@/ui/primitives/NumberInput';
import { Slider } from '@/ui/primitives/Slider';

export type ServingsScalerProps = {
  servings: number;
  defaultServings: number;
  onChange: (servings: number) => void;
  className?: string;
};

const SNAP_PILLS = [2, 4, 6, 8] as const;
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;
const STEP = 0.25;

export function ServingsScaler({
  servings,
  defaultServings,
  onChange,
  className,
}: ServingsScalerProps) {
  const safeDefault = defaultServings <= 0 ? 1 : defaultServings;
  const ratio = servings / safeDefault;
  const clampedRatio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

  const setRatio = (next: number) => {
    const value = Math.max(MIN_RATIO, Math.min(MAX_RATIO, next));
    const computed = Math.round(value * safeDefault * 100) / 100;
    onChange(computed);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)} role="group" aria-label="Servings scaler">
      <div className="flex items-center gap-2" role="group" aria-label="Quick servings">
        {SNAP_PILLS.map((pill) => {
          const active = pill === servings;
          return (
            <button
              key={pill}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(pill)}
              className={cn(
                'rounded-[var(--radius-pill)] border px-3 py-1 font-mono text-sm tabular-nums',
                'transition-colors duration-[var(--duration-fast)]',
                active
                  ? 'bg-saffron text-saffron-ink border-saffron'
                  : 'bg-transparent text-ink border-cream-line hover:bg-paper-2',
              )}
            >
              {pill}
            </button>
          );
        })}
      </div>
      <Slider
        aria-label="Servings ratio"
        min={MIN_RATIO}
        max={MAX_RATIO}
        step={STEP}
        value={[clampedRatio]}
        onValueChange={(values) => {
          if (values[0] !== undefined) setRatio(values[0]);
        }}
      />
      <div className="flex items-center gap-2">
        <NumberInput
          ariaLabel="Servings"
          value={servings}
          onValueChange={(value) => onChange(value)}
          min={1}
          max={Math.round(safeDefault * MAX_RATIO)}
          step={1}
        />
        <span className="font-body text-sm text-ink-soft">servings</span>
      </div>
    </div>
  );
}
