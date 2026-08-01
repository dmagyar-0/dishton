import { formatUsd } from '@/domain/ai-cost';
import type { AiCostRow, DateRange } from '@/lib/queries/metrics';
import { useMetricsAiCost } from '@/lib/queries/metrics';
import { Card, Skeleton } from '@/ui/primitives';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaChart } from './charts/AreaChart';
import { DataTable } from './charts/DataTable';
import { StatTile } from './charts/StatTile';
import { CHART_COLORS } from './charts/colors';
import { formatCompactNumber } from './charts/format';

type ModelTotals = {
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  unpricedCalls: number;
};

function aggregateByModel(rows: AiCostRow[]): ModelTotals[] {
  const byModel = new Map<string, ModelTotals>();
  for (const r of rows) {
    const acc = byModel.get(r.model) ?? {
      model: r.model,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      unpricedCalls: 0,
    };
    acc.calls += r.calls;
    acc.tokensIn += r.tokens_in;
    acc.tokensOut += r.tokens_out;
    acc.usd += r.usd;
    acc.unpricedCalls += r.unpriced_calls;
    byModel.set(r.model, acc);
  }
  return Array.from(byModel.values()).sort((a, b) => b.usd - a.usd);
}

function aggregateByDay(rows: AiCostRow[]): Array<{ day: string; value: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.usd);
  return Array.from(byDay.entries()).map(([day, value]) => ({ day, value }));
}

export function AiCostSection({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const query = useMetricsAiCost(range);
  const rows = query.data ?? [];

  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalUnpriced = rows.reduce((s, r) => s + r.unpriced_calls, 0);
  const byModel = aggregateByModel(rows);
  const byDay = aggregateByDay(rows);

  return (
    <Card as="section" aria-labelledby="metrics-ai-cost-heading">
      <h2 id="metrics-ai-cost-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.ai_cost.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.ai_cost.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <>
          {totalUnpriced > 0 && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-pomegranate/40 bg-paper-2 px-3 py-2 text-sm text-pomegranate"
            >
              <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 mt-0.5" />
              <span>{t('admin.metrics.ai_cost.unpriced_warning', { count: totalUnpriced })}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatTile label={t('admin.metrics.ai_cost.total_usd')} value={formatUsd(totalUsd)} />
            <StatTile
              label={t('admin.metrics.ai_cost.total_calls')}
              value={formatCompactNumber(totalCalls)}
            />
          </div>

          <AreaChart
            ariaLabel={t('admin.metrics.ai_cost.chart_label')}
            emptyLabel={t('admin.metrics.no_data')}
            data={byDay}
            color={CHART_COLORS.cost}
            gridColor={CHART_COLORS.grid}
            surfaceColor={CHART_COLORS.surface}
            formatValue={formatUsd}
          />

          <h3 className="font-body text-sm font-medium text-ink mt-4 mb-2">
            {t('admin.metrics.ai_cost.by_model')}
          </h3>
          <DataTable
            columns={[
              { key: 'model', label: t('admin.metrics.ai_cost.model') },
              { key: 'calls', label: t('admin.metrics.ai_cost.total_calls'), align: 'right' },
              { key: 'tokens_in', label: t('admin.metrics.ai_cost.tokens_in'), align: 'right' },
              { key: 'tokens_out', label: t('admin.metrics.ai_cost.tokens_out'), align: 'right' },
              { key: 'usd', label: t('admin.metrics.ai_cost.total_usd'), align: 'right' },
              {
                key: 'unpriced',
                label: t('admin.metrics.ai_cost.unpriced_calls'),
                align: 'right',
              },
            ]}
            rows={byModel.map((m) => ({
              model: m.model,
              calls: formatCompactNumber(m.calls),
              tokens_in: formatCompactNumber(m.tokensIn),
              tokens_out: formatCompactNumber(m.tokensOut),
              usd: formatUsd(m.usd),
              unpriced: m.unpricedCalls > 0 ? m.unpricedCalls : '—',
            }))}
            getRowKey={(row) => String(row.model)}
            emptyLabel={t('admin.metrics.no_data')}
          />
        </>
      )}
    </Card>
  );
}
