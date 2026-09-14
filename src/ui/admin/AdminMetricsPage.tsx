import type { DateRangeDays } from '@/lib/queries/metrics';
import { dateRangeBounds } from '@/lib/queries/metrics';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveUsersSection } from './ActiveUsersSection';
import { AiCostSection } from './AiCostSection';
import { AppOpensSection } from './AppOpensSection';
import { DateRangeSelector } from './DateRangeSelector';
import { EdgeReliabilitySection } from './EdgeReliabilitySection';
import { ImportsSection } from './ImportsSection';
import { UsersSection } from './UsersSection';

// Content of /admin/metrics, split out from the route file so it can be unit
// tested without a router context (see src/routes/admin/metrics.tsx, which is
// just the beforeLoad guard + this component).
export function AdminMetricsPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<DateRangeDays>(30);
  const range = useMemo(() => dateRangeBounds(days), [days]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-cream-line pb-4">
        <div>
          <h1 className="font-display text-3xl text-ink">{t('admin.metrics.title')}</h1>
          <p className="text-ink-soft text-sm mt-1">{t('admin.metrics.subtitle')}</p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      <UsersSection />
      <ActiveUsersSection range={range} />
      <AppOpensSection range={range} />
      <ImportsSection range={range} />
      <AiCostSection range={range} />
      <EdgeReliabilitySection range={range} />
    </main>
  );
}
