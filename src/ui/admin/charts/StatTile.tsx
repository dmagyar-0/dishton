import { cn } from '@/ui/cn';

export type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'critical';
};

// The figure contract from the dataviz skill: label (sentence case, no
// trailing colon) + value (proportional figures -- never tabular-nums on a
// big standalone number, see marks-and-anatomy.md) + an optional hint. No
// delta/sparkline here -- these tiles summarise a whole date-range window,
// which has no "previous period" to compare against yet.
export function StatTile({ label, value, hint, tone = 'default' }: StatTileProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border bg-paper-2 px-4 py-3',
        tone === 'critical' ? 'border-pomegranate/40' : 'border-cream-line',
      )}
    >
      <p className="text-ink-soft text-xs">{label}</p>
      <p
        className={cn(
          'font-body text-2xl font-semibold mt-1',
          tone === 'critical' ? 'text-pomegranate' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-ink-muted text-xs mt-1">{hint}</p>}
    </div>
  );
}
