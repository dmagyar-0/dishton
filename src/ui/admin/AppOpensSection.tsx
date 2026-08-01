import type { DateRange } from '@/lib/queries/metrics';
import { useMetricsAppOpens } from '@/lib/queries/metrics';
import { Card, Skeleton } from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { DataTable } from './charts/DataTable';
import { StackedBarChart } from './charts/StackedBarChart';
import { StatTile } from './charts/StatTile';
import { CHART_COLORS } from './charts/colors';

export function AppOpensSection({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const query = useMetricsAppOpens(range);
  const rows = query.data ?? [];

  const totalOpens = rows.reduce((sum, r) => sum + r.opens, 0);
  const totalResumes = rows.reduce((sum, r) => sum + r.resumes, 0);
  const totalStandalone = rows.reduce((sum, r) => sum + r.standalone_opens, 0);
  // unique_sessions is per-day already-deduped; summing across days
  // double-counts a session that opened on two different days, which is fine
  // here -- it reads as "session-days", a rough engagement signal, not a
  // claim about distinct devices.
  const totalSessions = rows.reduce((sum, r) => sum + r.unique_sessions, 0);

  return (
    <Card as="section" aria-labelledby="metrics-app-opens-heading">
      <h2 id="metrics-app-opens-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.app_opens.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.app_opens.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatTile label={t('admin.metrics.app_opens.total_opens')} value={String(totalOpens)} />
            <StatTile label={t('admin.metrics.app_opens.resumes')} value={String(totalResumes)} />
            <StatTile
              label={t('admin.metrics.app_opens.unique_sessions')}
              value={String(totalSessions)}
            />
          </div>

          <StackedBarChart
            ariaLabel={t('admin.metrics.app_opens.chart_label')}
            emptyLabel={t('admin.metrics.no_data')}
            data={rows.map((r) => ({
              day: r.day,
              segments: [
                {
                  key: 'standalone',
                  label: t('admin.metrics.app_opens.standalone'),
                  value: r.standalone_opens,
                  color: CHART_COLORS.accent,
                },
                {
                  key: 'browser',
                  label: t('admin.metrics.app_opens.browser'),
                  value: Math.max(0, r.opens - r.standalone_opens),
                  color: CHART_COLORS.context,
                },
              ],
            }))}
          />

          <p className="text-ink-muted text-xs mt-2">
            {t('admin.metrics.app_opens.standalone_share', {
              percent: totalOpens > 0 ? Math.round((totalStandalone / totalOpens) * 100) : 0,
            })}
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-soft">
              {t('admin.metrics.view_table')}
            </summary>
            <div className="mt-2">
              <DataTable
                columns={[
                  { key: 'day', label: t('admin.metrics.column_day') },
                  { key: 'opens', label: t('admin.metrics.app_opens.total_opens'), align: 'right' },
                  {
                    key: 'standalone_opens',
                    label: t('admin.metrics.app_opens.standalone'),
                    align: 'right',
                  },
                  { key: 'resumes', label: t('admin.metrics.app_opens.resumes'), align: 'right' },
                  {
                    key: 'unique_sessions',
                    label: t('admin.metrics.app_opens.unique_sessions'),
                    align: 'right',
                  },
                ]}
                rows={rows.map((r) => ({ ...r }))}
                getRowKey={(row) => String(row.day)}
                emptyLabel={t('admin.metrics.no_data')}
              />
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
