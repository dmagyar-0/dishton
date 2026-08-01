import type { DateRange, ImportsRow } from '@/lib/queries/metrics';
import { useMetricsImports } from '@/lib/queries/metrics';
import { Card, Skeleton } from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { DataTable } from './charts/DataTable';
import { StackedBarChart } from './charts/StackedBarChart';
import { StatTile } from './charts/StatTile';
import { CHART_COLORS } from './charts/colors';
import { formatMs, formatPercent } from './charts/format';

type KindTotals = {
  kind: string;
  started: number;
  succeeded: number;
  failed: number;
  p50Weighted: number | null;
  p95Weighted: number | null;
};

// Weighted average of a per-(day, kind) percentile, weighted by that row's
// `started` count. This is an approximation, not a true percentile-of-raw-
// jobs (the client only ever sees pre-aggregated daily percentiles from the
// RPC) -- good enough for "which kind is slow", not for an SLO burn-rate
// calc. Rows with a null percentile (no completed jobs that day) are
// excluded from both the sum and the weight.
function weightedAverage(
  rows: ImportsRow[],
  pick: (r: ImportsRow) => number | null,
): number | null {
  let weightedSum = 0;
  let weight = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || r.started <= 0) continue;
    weightedSum += v * r.started;
    weight += r.started;
  }
  return weight > 0 ? weightedSum / weight : null;
}

function aggregateByKind(rows: ImportsRow[]): KindTotals[] {
  const byKind = new Map<string, ImportsRow[]>();
  for (const r of rows) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }
  return Array.from(byKind.entries())
    .map(([kind, kindRows]) => ({
      kind,
      started: kindRows.reduce((s, r) => s + r.started, 0),
      succeeded: kindRows.reduce((s, r) => s + r.succeeded, 0),
      failed: kindRows.reduce((s, r) => s + r.failed, 0),
      p50Weighted: weightedAverage(kindRows, (r) => r.p50_ms),
      p95Weighted: weightedAverage(kindRows, (r) => r.p95_ms),
    }))
    .sort((a, b) => b.started - a.started);
}

function aggregateByDay(rows: ImportsRow[]): Array<{ day: string; started: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.started);
  return Array.from(byDay.entries()).map(([day, started]) => ({ day, started }));
}

export function ImportsSection({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const query = useMetricsImports(range);
  const rows = query.data ?? [];

  const totalStarted = rows.reduce((s, r) => s + r.started, 0);
  const totalSucceeded = rows.reduce((s, r) => s + r.succeeded, 0);
  const totalFailed = rows.reduce((s, r) => s + r.failed, 0);
  const terminal = totalSucceeded + totalFailed;
  const successRate = terminal > 0 ? totalSucceeded / terminal : null;
  const p95 = weightedAverage(rows, (r) => r.p95_ms);
  const byDay = aggregateByDay(rows);
  const byKind = aggregateByKind(rows);

  return (
    <Card as="section" aria-labelledby="metrics-imports-heading">
      <h2 id="metrics-imports-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.imports.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.imports.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatTile label={t('admin.metrics.imports.started')} value={String(totalStarted)} />
            <StatTile
              label={t('admin.metrics.imports.success_rate')}
              value={formatPercent(successRate)}
            />
            <StatTile label={t('admin.metrics.imports.p95')} value={formatMs(p95)} />
          </div>

          <StackedBarChart
            ariaLabel={t('admin.metrics.imports.chart_label')}
            emptyLabel={t('admin.metrics.no_data')}
            data={byDay.map((r) => ({
              day: r.day,
              segments: [
                {
                  key: 'started',
                  label: t('admin.metrics.imports.started'),
                  value: r.started,
                  color: CHART_COLORS.volume,
                },
              ],
            }))}
          />

          <h3 className="font-body text-sm font-medium text-ink mt-4 mb-2">
            {t('admin.metrics.imports.by_kind')}
          </h3>
          <DataTable
            columns={[
              { key: 'kind', label: t('admin.metrics.imports.kind') },
              { key: 'started', label: t('admin.metrics.imports.started'), align: 'right' },
              { key: 'succeeded', label: t('admin.metrics.imports.succeeded'), align: 'right' },
              { key: 'failed', label: t('admin.metrics.imports.failed'), align: 'right' },
              {
                key: 'success_rate',
                label: t('admin.metrics.imports.success_rate'),
                align: 'right',
              },
              { key: 'p95', label: t('admin.metrics.imports.p95'), align: 'right' },
            ]}
            rows={byKind.map((k) => ({
              kind: k.kind,
              started: k.started,
              succeeded: k.succeeded,
              failed: k.failed,
              success_rate: formatPercent(
                k.succeeded + k.failed > 0 ? k.succeeded / (k.succeeded + k.failed) : null,
              ),
              p95: formatMs(k.p95Weighted),
            }))}
            getRowKey={(row) => String(row.kind)}
            emptyLabel={t('admin.metrics.no_data')}
          />
        </>
      )}
    </Card>
  );
}
