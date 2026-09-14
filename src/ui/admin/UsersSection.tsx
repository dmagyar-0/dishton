import { useAdminUsers } from '@/lib/queries/adminUsers';
import { Card, Skeleton } from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { DataTable } from './charts/DataTable';

// The dashboard's user roster -- not date-ranged (unlike every other section
// here), since "who are our users" isn't scoped to the metrics date picker.
export function UsersSection() {
  const { t } = useTranslation();
  const query = useAdminUsers();
  const rows = query.data ?? [];

  return (
    <Card as="section" aria-labelledby="metrics-users-heading">
      <h2 id="metrics-users-heading" className="font-display text-xl text-ink mb-1">
        {t('admin.metrics.users.title')}
      </h2>
      <p className="text-ink-soft text-sm mb-4">{t('admin.metrics.users.subtitle')}</p>

      {query.isLoading && <Skeleton className="h-52" />}
      {query.isError && <p className="text-pomegranate text-sm">{t('admin.metrics.load_error')}</p>}

      {!query.isLoading && !query.isError && (
        <DataTable
          columns={[
            { key: 'email', label: t('admin.metrics.users.email') },
            { key: 'display_name', label: t('admin.metrics.users.display_name') },
            { key: 'created_at', label: t('admin.metrics.users.joined') },
            { key: 'last_sign_in_at', label: t('admin.metrics.users.last_sign_in') },
          ]}
          rows={rows.map((r) => ({
            id: r.profile_id,
            email: r.email ?? '—',
            display_name: r.display_name ?? '—',
            created_at: new Date(r.created_at).toLocaleDateString(),
            last_sign_in_at: r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString() : '—',
          }))}
          getRowKey={(row) => String(row.id)}
          emptyLabel={t('admin.metrics.no_data')}
        />
      )}
    </Card>
  );
}
