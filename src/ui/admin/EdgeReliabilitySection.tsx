import type { DateRange, EdgeFailuresRow } from '@/lib/queries/metrics';
import { useMetricsEdgeFailures, useMetricsStuckImports } from '@/lib/queries/metrics';
import { Badge, Card, Skeleton } from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { DataTable } from './charts/DataTable';
import { StackedBarChart } from './charts/StackedBarChart';
import { CHART_COLORS } from './charts/colors';
import { formatMs } from './charts/format';

type FnOutcomeTotals = {
  fn: string;
  outcome: string;
  calls: number;
  p95Weighted: number | null;
};

function weightedAverage(
  rows: EdgeFailuresRow[],
  pick: (r: EdgeFailuresRow) => number | null,
): number | null {
  let weightedSum = 0;
  let weight = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || r.calls <= 0) continue;
    weightedSum += v * r.calls;
    weight += r.calls;
  }
  return weight > 0 ? weightedSum / weight : null;
}

function aggregateByFnOutcome(rows: EdgeFailuresRow[]): FnOutcomeTotals[] {
  const key = (r: EdgeFailuresRow) => `${r.fn ?? '?'}::${r.outcome ?? '?'}`;
  const byKey = new Map<string, EdgeFailuresRow[]>();
  for (const r of rows) {
    const list = byKey.get(key(r)) ?? [];
    list.push(r);
    byKey.set(key(r), list);
  }
  return Array.from(byKey.values())
    .map((group) => {
      const first = group[0];
      return {
        fn: first?.fn ?? '?',
        outcome: first?.outcome ?? '?',
        calls: group.reduce((s, r) => s + r.calls, 0),
        p95Weighted: weightedAverage(group, (r) => r.p95_ms),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

function aggregateByDay(
  rows: EdgeFailuresRow[],
): Array<{ day: string; ok: number; failed: number }> {
  const byDay = new Map<string, { ok: number; failed: number }>();
  for (const r of rows) {
    const entry = byDay.get(r.day) ?? { ok: 0, failed: 0 };
    if (r.outcome === 'ok') entry.ok += r.calls;
    else entry.failed += r.calls;
    byDay.set(r.day, entry);
  }
  return Array.from(byDay.entries()).map(([day, v]) => ({ day, ...v }));
}

export function EdgeReliabilitySection({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const query = useMetricsEdgeFailures(range);
  const stuck = useMetricsStuckImports();
  const rows = query.data ?? [];

  const byDay = aggregateByDay(rows);
  const byFnOutcome = aggregateByFnOutcome(rows);
  const stuckRows = stuck.data ?? [];

  return (
    <Card as="section" aria-labelledby="metrics-edge-reliability-heading">
      <h2 id="metrics-edge-reliability-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.edge_reliability.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.edge_reliability.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <>
          <StackedBarChart
            ariaLabel={t('admin.metrics.edge_reliability.chart_label')}
            emptyLabel={t('admin.metrics.no_data')}
            data={byDay.map((r) => ({
              day: r.day,
              segments: [
                {
                  key: 'ok',
                  label: t('admin.metrics.edge_reliability.ok'),
                  value: r.ok,
                  color: CHART_COLORS.good,
                },
                {
                  key: 'failed',
                  label: t('admin.metrics.edge_reliability.failed'),
                  value: r.failed,
                  color: CHART_COLORS.bad,
                },
              ],
            }))}
          />

          <h3 className="font-body text-sm font-medium text-ink mt-4 mb-2">
            {t('admin.metrics.edge_reliability.by_function')}
          </h3>
          <DataTable
            columns={[
              { key: 'fn', label: t('admin.metrics.edge_reliability.function') },
              { key: 'outcome', label: t('admin.metrics.edge_reliability.outcome') },
              { key: 'calls', label: t('admin.metrics.edge_reliability.calls'), align: 'right' },
              { key: 'p95', label: t('admin.metrics.imports.p95'), align: 'right' },
            ]}
            rows={byFnOutcome.map((r) => ({
              fn: r.fn,
              outcome:
                r.outcome === 'ok' ? (
                  <Badge variant="secondary">{t('admin.metrics.edge_reliability.ok')}</Badge>
                ) : (
                  <Badge variant="outline" className="border-pomegranate/40 text-pomegranate">
                    {r.outcome}
                  </Badge>
                ),
              calls: r.calls,
              p95: formatMs(r.p95Weighted),
            }))}
            getRowKey={(row, i) => `${row.fn}-${row.outcome}-${i}`}
            emptyLabel={t('admin.metrics.no_data')}
          />
        </>
      )}

      <h3 className="font-body text-sm font-medium text-ink mt-6 mb-2">
        {t('admin.metrics.edge_reliability.stuck_imports')}
      </h3>
      {stuck.isLoading && <Skeleton className="h-24" />}
      {stuck.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}
      {!stuck.isLoading && !stuck.isError && (
        <DataTable
          columns={[
            { key: 'kind', label: t('admin.metrics.imports.kind') },
            { key: 'status', label: t('admin.metrics.edge_reliability.status') },
            { key: 'created_at', label: t('admin.metrics.edge_reliability.started_at') },
            {
              key: 'age_minutes',
              label: t('admin.metrics.edge_reliability.age_minutes'),
              align: 'right',
            },
          ]}
          rows={stuckRows.map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            created_at: new Date(r.created_at).toLocaleString(),
            age_minutes: Math.round(r.age_minutes),
          }))}
          getRowKey={(row) => String(row.id)}
          emptyLabel={t('admin.metrics.edge_reliability.no_stuck_imports')}
        />
      )}
    </Card>
  );
}
