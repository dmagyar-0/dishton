import type { DateRangeDays } from '@/lib/queries/metrics';
import { DATE_RANGE_OPTIONS } from '@/lib/queries/metrics';
import { cn } from '@/ui/cn';
import { useTranslation } from 'react-i18next';

export type DateRangeSelectorProps = {
  value: DateRangeDays;
  onChange: (days: DateRangeDays) => void;
};

// One filter row, above everything it scopes (per the dataviz skill's
// interaction guidance) -- every chart and stat tile on the page reads
// through the same [from, to] window this selector sets.
export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('admin.metrics.date_range_label')}
      className="inline-flex gap-1"
    >
      {DATE_RANGE_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={cn(
            'rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-medium transition-colors',
            'border border-cream-line',
            value === days
              ? 'bg-aubergine text-paper border-aubergine'
              : 'bg-paper-2 text-ink-soft hover:text-ink',
          )}
        >
          {t('admin.metrics.date_range_days', { count: days })}
        </button>
      ))}
    </div>
  );
}
