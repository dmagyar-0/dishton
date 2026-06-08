import { useActiveImports } from '@/lib/imports/ActiveImportsProvider';
import { cn } from '@/ui/cn';
import { Link } from '@tanstack/react-router';
import { Loader } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PHASE_LABEL_KEYS = {
  scrape: 'import.phase_scrape',
  ai: 'import.phase_ai',
  saving: 'import.phase_saving',
} as const;

export function ActiveImportsIndicator() {
  const { items } = useActiveImports();
  const { t } = useTranslation();
  const active = items.filter(
    (it) => it.status === 'queued' || it.status === 'running' || it.status === 'awaiting_save',
  );
  const newest = active[0];
  if (!newest) return null;
  const phaseKey = newest.phase ? PHASE_LABEL_KEYS[newest.phase] : null;
  const phaseLabel = phaseKey ? t(phaseKey) : t('import.phase_default');
  return (
    <Link
      to="/h/$householdId/import"
      params={{ householdId: newest.householdId }}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-pill)]',
        'bg-saffron/15 text-aubergine text-xs font-body hover:bg-saffron/25',
      )}
      role="status"
      aria-live="polite"
      title={t('import.active_indicator_tooltip', { count: active.length })}
    >
      <Loader size={14} strokeWidth={1.75} className="animate-spin" />
      <span className="hidden sm:inline">
        {active.length === 1
          ? phaseLabel
          : t('import.active_indicator_count', { count: active.length })}
      </span>
      <span className="sm:hidden font-medium">{active.length}</span>
    </Link>
  );
}
