// Small pure helpers shared by the SVG chart components. Kept separate so
// they're trivially unit-testable without mounting any SVG.

// Rounds a max value up to a "nice" round number (1/2/5 x 10^n) for an axis
// ceiling, the way most charting libraries pick tick tops. Guards <= 0 so a
// brand-new install with zero events never divides by zero downstream.
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const residual = max / magnitude;
  let niceResidual: number;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

// Evenly spaced y-axis ticks from 0 to niceMax(max), deduped (a very small
// max can otherwise produce repeated rounded values).
export function yTicks(max: number, count = 4): number[] {
  const top = niceMax(max);
  const raw = Array.from({ length: count + 1 }, (_, i) => Math.round((top * i) / count));
  return Array.from(new Set(raw)).sort((a, b) => a - b);
}

// Picks up to `maxLabels` evenly spaced indices from [0, length) so x-axis
// labels don't collide on a wide date range (90 days of daily labels would
// overlap into mush). Always includes the first and last index.
export function sparseIndices(length: number, maxLabels: number): number[] {
  if (length <= 0) return [];
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (maxLabels - 1);
  const picked = new Set<number>();
  for (let i = 0; i < maxLabels; i++) picked.add(Math.round(i * step));
  return Array.from(picked).sort((a, b) => a - b);
}
