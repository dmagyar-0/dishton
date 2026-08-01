import { useState } from 'react';
import { ChartFrame } from './ChartFrame';
import { Legend } from './Legend';
import { niceMax, sparseIndices, yTicks } from './chartMath';
import { CHART_COLORS } from './colors';
import { formatCompactNumber, formatDay } from './format';

export type OrdinalSeries = { key: string; label: string };
export type OrdinalLineChartRow = { day: string; values: number[] };

export type OrdinalLineChartProps = {
  data: OrdinalLineChartRow[];
  series: OrdinalSeries[];
  ariaLabel: string;
  emptyLabel: string;
};

const HEIGHT = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const MAX_X_LABELS = 6;

// Ordinal multi-series line chart for DAU/WAU/MAU: one hue (aubergine),
// monotone-lightness steps via opacity -- see colors.ts for why this is
// ordinal (nested rolling windows, not independent identities) rather than
// categorical. Validated with the dataviz skill's --ordinal check: PASS.
export function OrdinalLineChart({ data, series, ariaLabel, emptyLabel }: OrdinalLineChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const n = data.length;
  const width = Math.max(480, n * 28);
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const allValues = data.flatMap((row) => row.values);
  const maxValue = allValues.length > 0 ? Math.max(...allValues, 0) : 0;
  const top = niceMax(maxValue);
  const ticks = yTicks(maxValue);
  const isEmpty = n === 0 || maxValue === 0;

  const xAt = (i: number) => (n <= 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (plotW * i) / (n - 1));
  const yAt = (v: number) => PAD_TOP + plotH - (v / top) * plotH;

  const labelIndices = new Set(sparseIndices(n, MAX_X_LABELS));
  const hoveredRow = hover !== null ? data[hover] : undefined;

  return (
    <div>
      <Legend
        items={series.map((s) => ({
          key: s.key,
          label: s.label,
          color: CHART_COLORS.ordinal,
          shape: 'line' as const,
        }))}
      />
      <ChartFrame ariaLabel={ariaLabel} minWidth={width} isEmpty={isEmpty} emptyLabel={emptyLabel}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="presentation"
          className="block"
        >
          <title>{ariaLabel}</title>
          {/* Gridlines -- hairline, recessive, never dashed. */}
          {ticks.map((t) => (
            <line
              key={t}
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke={CHART_COLORS.grid}
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
              {formatCompactNumber(t)}
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

          {/* Series lines, drawn back-to-front so the shortest/darkest window
              (dau) paints last and sits on top. */}
          {series
            .map((s, seriesIndex) => ({ s, seriesIndex }))
            .reverse()
            .map(({ s, seriesIndex }) => {
              const points = data.map((row, i) => `${xAt(i)},${yAt(row.values[seriesIndex] ?? 0)}`);
              const opacity = CHART_COLORS.ordinalOpacity[seriesIndex] ?? 1;
              return (
                <polyline
                  key={s.key}
                  points={points.join(' ')}
                  fill="none"
                  stroke={CHART_COLORS.ordinal}
                  strokeOpacity={opacity}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}

          {/* End markers for the last point of each series. */}
          {n > 0 &&
            series.map((s, seriesIndex) => {
              const last = data[n - 1];
              if (!last) return null;
              const opacity = CHART_COLORS.ordinalOpacity[seriesIndex] ?? 1;
              return (
                <circle
                  key={`end-${s.key}`}
                  cx={xAt(n - 1)}
                  cy={yAt(last.values[seriesIndex] ?? 0)}
                  r={4}
                  fill={CHART_COLORS.ordinal}
                  fillOpacity={opacity}
                  stroke={CHART_COLORS.surface}
                  strokeWidth={2}
                />
              );
            })}

          {/* Crosshair. */}
          {hover !== null && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              stroke={CHART_COLORS.axisText}
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          )}

          {/* Hover/focus hit columns -- bigger than the mark, keyboard reachable. */}
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
                aria-label={`${formatDay(row.day)}: ${series
                  .map((s, si) => `${s.label} ${row.values[si] ?? 0}`)
                  .join(', ')}`}
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
            <p className="font-medium text-ink mb-1">{formatDay(hoveredRow.day)}</p>
            {series.map((s, i) => (
              <p key={s.key} className="text-ink-soft">
                {s.label}: <span className="text-ink font-medium">{hoveredRow.values[i] ?? 0}</span>
              </p>
            ))}
          </div>
        )}
      </ChartFrame>
    </div>
  );
}
