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
//
// When there's no data, we deliberately DON'T mount the wide (`minWidth`,
// often >2000px for a 90-day range) scrollable SVG body at all -- only its
// empty-state message. A brand-new install with zero events is the default
// state of this dashboard, and centering the message inside a chart that's
// 5x wider than its scroll container just pushes it off-screen until the
// user scrolls right. Rendering at the card's natural width instead keeps
// the message visible at every range and viewport without touching the
// with-data path, which still scrolls inside its own `overflow-x-auto`.
export function ChartFrame({
  ariaLabel,
  minWidth = 480,
  isEmpty,
  emptyLabel,
  children,
}: ChartFrameProps) {
  if (isEmpty) {
    return (
      <div
        className="flex h-52 items-center justify-center text-center text-ink-muted text-sm"
        role="img"
        aria-label={ariaLabel}
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ minWidth }} role="img" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  );
}
