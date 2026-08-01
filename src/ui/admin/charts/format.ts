// Small formatting helpers shared by the /admin/metrics charts. Kept out of
// src/domain because these are display-only (locale-aware Intl calls), not
// business logic -- domain stays pure and I/O-free per CLAUDE.md.

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    n,
  );
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

// `day` is a Postgres `date` serialized as 'YYYY-MM-DD'. Parsed as UTC
// midnight so the label doesn't shift a day depending on the viewer's
// timezone offset.
export function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}
