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

// Whether `step` is itself a "nice" round number (1/2/5/10 x 10^n) -- the
// same family niceMax() picks from, just checked in the other direction so
// we can validate a candidate step rather than derive one from a residual.
function isNiceStep(step: number): boolean {
  if (!(step > 0)) return false;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const residual = step / magnitude;
  const epsilon = 1e-9 * Math.max(1, residual);
  return [1, 2, 5, 10].some((n) => Math.abs(residual - n) < epsilon);
}

// Rounds to a sane number of decimals for the given step so that e.g.
// 3 * 0.1 prints as 0.3, not 0.30000000000000004.
function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 6);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Evenly spaced, evenly VALUED y-axis ticks from 0 to niceMax(max). Rather
// than dividing the axis top into a fixed number of slices (which produces
// unevenly valued ticks whenever top/count isn't a round number -- e.g.
// yTicks(3) used to skip straight from 1 to 3), this picks the step size
// (out of the same 1/2/5/10 x 10^n family niceMax() ceils to) that divides
// evenly into the axis top and lands closest to `targetCount` ticks. Every
// candidate step is a nice divisor of `top`, so the final tick is always
// exactly `top` -- the same value chart components get from their own,
// independent `niceMax(max)` call -- keeping ticks and plotted scale in sync.
export function yTicks(max: number, targetCount = 5): number[] {
  const top = niceMax(max);
  let bestDivisions = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let divisions = 1; divisions <= 12; divisions++) {
    const step = top / divisions;
    if (!isNiceStep(step)) continue;
    const score = Math.abs(divisions + 1 - targetCount);
    if (score < bestScore) {
      bestScore = score;
      bestDivisions = divisions;
    }
  }
  const step = top / bestDivisions;
  return Array.from({ length: bestDivisions + 1 }, (_, i) => roundToStep(i * step, step));
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
