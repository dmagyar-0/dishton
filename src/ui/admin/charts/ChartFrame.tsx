import type { ReactNode } from 'react';

export type ChartFrameProps = {
  ariaLabel: string;
  minWidth?: number;
  isEmpty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
};

// Every chart's outer shell: an overflow-x:auto scroll region (so the page
// body never scrolls horizontally on mobile -- the whole chart scrolls
// within its own card instead) around a fixed-minWidth inner box the SVG
// renders into. `role="img"` + `ariaLabel` gives screen readers a summary;
// the sighted, keyboard, and color-blind paths are covered by the chart's
// own hover/focus tooltip plus the DataTable each section renders alongside.
export function ChartFrame({
  ariaLabel,
  minWidth = 480,
  isEmpty,
  emptyLabel,
  children,
}: ChartFrameProps) {
  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ minWidth }} role="img" aria-label={ariaLabel}>
        {children}
        {isEmpty && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-ink-muted text-sm">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
