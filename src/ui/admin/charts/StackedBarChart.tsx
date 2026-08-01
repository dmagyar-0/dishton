import { useState } from 'react';
import { ChartFrame } from './ChartFrame';
import { Legend, type LegendItem } from './Legend';
import { niceMax, sparseIndices, yTicks } from './chartMath';
import { CHART_COLORS } from './colors';
import { formatCompactNumber, formatDay } from './format';

export type BarSegment = { key: string; label: string; value: number; color: string };
export type StackedBarRow = { day: string; segments: BarSegment[] };

export type StackedBarChartProps = {
  data: StackedBarRow[];
  ariaLabel: string;
  emptyLabel: string;
};

const HEIGHT = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const MAX_X_LABELS = 6;
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 2;

// Generic stacked/simple bar chart: N (usually 1 or 2) colored segments per
// day, growing from a shared baseline. Used for app-opens (standalone vs
// browser), imports volume (single segment), and edge-call ok/failed. Bars
// stay thin and capped per marks-and-anatomy.md -- never fill the slot.
export function StackedBarChart({ data, ariaLabel, emptyLabel }: StackedBarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const n = data.length;
  const width = Math.max(480, n * 32);
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const totals = data.map((row) => row.segments.reduce((sum, seg) => sum + seg.value, 0));
  const maxTotal = totals.length > 0 ? Math.max(...totals, 0) : 0;
  const top = niceMax(maxTotal);
  const ticks = yTicks(maxTotal);
  const isEmpty = n === 0 || maxTotal === 0;

  const slot = n > 0 ? plotW / n : plotW;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(2, slot * 0.6));

  const legendItems: LegendItem[] = [];
  const seenKeys = new Set<string>();
  for (const row of data) {
    for (const seg of row.segments) {
      if (!seenKeys.has(seg.key)) {
        seenKeys.add(seg.key);
        legendItems.push({ key: seg.key, label: seg.label, color: seg.color, shape: 'rect' });
      }
    }
  }

  const labelIndices = new Set(sparseIndices(n, MAX_X_LABELS));
  const hoveredRow = hover !== null ? data[hover] : undefined;
  const hoverX = hover !== null ? PAD_LEFT + slot * hover + slot / 2 : 0;

  return (
    <div>
      <Legend items={legendItems} />
      <ChartFrame ariaLabel={ariaLabel} minWidth={width} isEmpty={isEmpty} emptyLabel={emptyLabel}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="presentation"
          className="block"
        >
          <title>{ariaLabel}</title>
          {ticks.map((t) => (
            <line
              key={t}
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={PAD_TOP + plotH - (t / top) * plotH}
              y2={PAD_TOP + plotH - (t / top) * plotH}
              stroke={CHART_COLORS.grid}
              strokeWidth={1}
            />
          ))}
          {ticks.map((t) => (
            <text
              key={`label-${t}`}
              x={PAD_LEFT - 8}
              y={PAD_TOP + plotH - (t / top) * plotH}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-soft text-[10px]"
            >
              {formatCompactNumber(t)}
            </text>
          ))}

          {data.map((row, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const total = totals[i] ?? 0;
            // Stack segments bottom-up with a 2px surface gap between them
            // (the spacer, not a stroke, separates touching fills).
            let cursorY = PAD_TOP + plotH - (total / top) * plotH;
            const baselineY = PAD_TOP + plotH;
            const bars = row.segments.map((seg, si) => {
              const segHeightRaw = (seg.value / top) * plotH;
              const gap = row.segments.length > 1 && si > 0 ? SEGMENT_GAP : 0;
              const y = cursorY + gap;
              const h = Math.max(0, segHeightRaw - gap);
              cursorY += segHeightRaw;
              const isTopSegment = si === 0;
              return (
                <rect
                  key={seg.key}
                  x={cx - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={h}
                  fill={seg.color}
                  rx={isTopSegment ? 3 : 0}
                  ry={isTopSegment ? 3 : 0}
                />
              );
            });
            return (
              <g key={row.day}>
                {bars}
                {/* Hover/focus hit target -- covers the full bar slot, not
                    just the painted pixels. */}
                <rect
                  x={PAD_LEFT + slot * i}
                  y={PAD_TOP}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatDay(row.day)}: ${row.segments
                    .map((s) => `${s.label} ${s.value}`)
                    .join(', ')}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                />
                {labelIndices.has(i) && (
                  <text
                    x={cx}
                    y={baselineY + 16}
                    textAnchor="middle"
                    className="fill-ink-soft text-[10px]"
                  >
                    {formatDay(row.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hoveredRow && (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-cream-line bg-paper px-3 py-2 text-xs shadow-press"
            style={{ left: `${(hoverX / width) * 100}%` }}
          >
            <p className="font-medium text-ink mb-1">{formatDay(hoveredRow.day)}</p>
            {hoveredRow.segments.map((seg) => (
              <p key={seg.key} className="text-ink-soft">
                {seg.label}: <span className="text-ink font-medium">{seg.value}</span>
              </p>
            ))}
          </div>
        )}
      </ChartFrame>
    </div>
  );
}
