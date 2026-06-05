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
const MAX_PILL = Math.max(...SNAP_PILLS);

export function ServingsScaler({
  servings,
  defaultServings,
  onChange,
  className,
}: ServingsScalerProps) {
  const safeDefault = defaultServings <= 0 ? 1 : defaultServings;
  // The slider works in ratio of the recipe default, but the pills are
  // absolute target servings. Widen the ratio bounds so the slider and numeric
  // input can always reach every pill (and the current value) regardless of
  // the recipe's base servings — otherwise an 8-serving pill on a 1-serving
  // recipe would clamp and never line up.
  const maxServings = Math.max(Math.round(safeDefault * MAX_RATIO), MAX_PILL, servings);
  const maxRatio = maxServings / safeDefault;
  const minRatio = Math.min(MIN_RATIO, servings / safeDefault);
  const ratio = servings / safeDefault;
  const clampedRatio = Math.min(maxRatio, Math.max(minRatio, ratio));

  const setRatio = (next: number) => {
    const value = Math.max(minRatio, Math.min(maxRatio, next));
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
        min={minRatio}
        max={maxRatio}
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
          max={maxServings}
          step={1}
        />
        <span className="font-body text-sm text-ink-soft">servings</span>
      </div>
    </div>
  );
}
