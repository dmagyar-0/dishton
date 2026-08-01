import type { DateRange } from '@/lib/queries/metrics';
import { useMetricsActiveUsers } from '@/lib/queries/metrics';
import { Card, Skeleton } from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { DataTable } from './charts/DataTable';
import { OrdinalLineChart } from './charts/OrdinalLineChart';
import { StatTile } from './charts/StatTile';

export function ActiveUsersSection({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const query = useMetricsActiveUsers(range);
  const rows = query.data ?? [];
  const latest = rows[rows.length - 1];

  return (
    <Card as="section" aria-labelledby="metrics-active-users-heading">
      <h2 id="metrics-active-users-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.active_users.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.active_users.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatTile
              label={t('admin.metrics.active_users.dau')}
              value={String(latest?.dau ?? 0)}
            />
            <StatTile
              label={t('admin.metrics.active_users.wau')}
              value={String(latest?.wau_rolling ?? 0)}
            />
            <StatTile
              label={t('admin.metrics.active_users.mau')}
              value={String(latest?.mau_rolling ?? 0)}
            />
          </div>

          <OrdinalLineChart
            ariaLabel={t('admin.metrics.active_users.chart_label')}
            emptyLabel={t('admin.metrics.no_data')}
            data={rows.map((r) => ({ day: r.day, values: [r.dau, r.wau_rolling, r.mau_rolling] }))}
            series={[
              { key: 'dau', label: t('admin.metrics.active_users.dau') },
              { key: 'wau', label: t('admin.metrics.active_users.wau') },
              { key: 'mau', label: t('admin.metrics.active_users.mau') },
            ]}
          />

          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-soft">
              {t('admin.metrics.view_table')}
            </summary>
            <div className="mt-2">
              <DataTable
                columns={[
                  { key: 'day', label: t('admin.metrics.column_day') },
                  { key: 'dau', label: t('admin.metrics.active_users.dau'), align: 'right' },
                  { key: 'wau', label: t('admin.metrics.active_users.wau'), align: 'right' },
                  { key: 'mau', label: t('admin.metrics.active_users.mau'), align: 'right' },
                ]}
                rows={rows.map((r) => ({
                  day: r.day,
                  dau: r.dau,
                  wau: r.wau_rolling,
                  mau: r.mau_rolling,
                }))}
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
