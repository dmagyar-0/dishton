import { useState } from 'react';
import { ChartFrame } from './ChartFrame';
import { niceMax, sparseIndices, yTicks } from './chartMath';
import { formatDay } from './format';

export type AreaChartRow = { day: string; value: number };

export type AreaChartProps = {
  data: AreaChartRow[];
  color: string;
  ariaLabel: string;
  emptyLabel: string;
  formatValue: (v: number) => string;
  gridColor: string;
  surfaceColor: string;
};

const HEIGHT = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;
const MAX_X_LABELS = 6;

// Single-series area chart (AI cost). One hue, no legend needed (the card
// title names the series): a 2px line over a ~10% wash fill, per
// marks-and-anatomy.md. Single series -> no CVD/categorical check applies,
// only the mark's own >=3:1 contrast against the surface (checked in colors.ts).
export function AreaChart({
  data,
  color,
  ariaLabel,
  emptyLabel,
  formatValue,
  gridColor,
  surfaceColor,
}: AreaChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const n = data.length;
  const width = Math.max(480, n * 24);
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const maxValue = n > 0 ? Math.max(...data.map((r) => r.value), 0) : 0;
  const top = niceMax(maxValue);
  const ticks = yTicks(maxValue);
  const isEmpty = n === 0 || maxValue === 0;

  const xAt = (i: number) => (n <= 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (plotW * i) / (n - 1));
  const yAt = (v: number) => PAD_TOP + plotH - (v / top) * plotH;

  const linePoints = data.map((row, i) => `${xAt(i)},${yAt(row.value)}`).join(' ');
  const areaPoints =
    n > 0 ? `${xAt(0)},${PAD_TOP + plotH} ${linePoints} ${xAt(n - 1)},${PAD_TOP + plotH}` : '';

  const labelIndices = new Set(sparseIndices(n, MAX_X_LABELS));
  const hoveredRow = hover !== null ? data[hover] : undefined;

  return (
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
            y1={yAt(t)}
            y2={yAt(t)}
            stroke={gridColor}
            strokeWidth={1}
          />
        ))}
        {ticks.map((t) => (
          <text
            key={`label-${t}`}
            x={PAD_LEFT - 8}
            y={yAt(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-ink-soft text-[10px]"
          >
            {formatValue(t)}
          </text>
        ))}
        {data.map((row, i) =>
          labelIndices.has(i) ? (
            <text
              key={`x-${row.day}`}
              x={xAt(i)}
              y={HEIGHT - PAD_BOTTOM + 16}
              textAnchor="middle"
              className="fill-ink-soft text-[10px]"
            >
              {formatDay(row.day)}
            </text>
          ) : null,
        )}

        {n > 0 && <polygon points={areaPoints} fill={color} fillOpacity={0.1} stroke="none" />}
        {n > 0 && (
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {n > 0 && data[n - 1] && (
          <circle
            cx={xAt(n - 1)}
            cy={yAt(data[n - 1]?.value ?? 0)}
            r={4}
            fill={color}
            stroke={surfaceColor}
            strokeWidth={2}
          />
        )}

        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotH}
            stroke={gridColor}
            strokeWidth={1}
          />
        )}

        {data.map((row, i) => {
          const colWidth = n <= 1 ? plotW : plotW / n;
          const colX = PAD_LEFT + (n <= 1 ? 0 : (plotW * i) / n);
          return (
            <rect
              key={`hit-${row.day}`}
              x={colX}
              y={PAD_TOP}
              width={colWidth}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${formatDay(row.day)}: ${formatValue(row.value)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onBlur={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hoveredRow && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-[var(--radius-md)] border border-cream-line bg-paper px-3 py-2 text-xs shadow-press"
          style={{ left: `${(xAt(hover ?? 0) / width) * 100}%` }}
        >
          <p className="font-medium text-ink">{formatDay(hoveredRow.day)}</p>
          <p className="text-ink-soft">
            <span className="text-ink font-medium">{formatValue(hoveredRow.value)}</span>
          </p>
        </div>
      )}
    </ChartFrame>
  );
}
