import type { ActiveImport } from '@/lib/imports/ActiveImportsProvider';
import { cn } from '@/ui/cn';
import { Camera, CheckCircle2, Globe, Instagram, Loader, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PHASE_LABEL_KEYS = {
  scrape: 'import.phase_scrape',
  ai: 'import.phase_ai',
  saving: 'import.phase_saving',
} as const;

const KIND_ICON = { url: Globe, instagram: Instagram, photo: Camera, manual: Globe } as const;

function isActive(status: ActiveImport['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_save';
}

function sourceLabel(item: ActiveImport, t: (k: string) => string): string {
  if (item.kind === 'photo') return t('import.queue_source_photo');
  if (item.sourceUrl) {
    try {
      return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return item.sourceUrl;
    }
  }
  if (item.kind === 'instagram') return t('import.queue_source_instagram');
  return t('import.phase_default');
}

function statusLabel(item: ActiveImport, t: (k: string) => string): string {
  switch (item.status) {
    case 'queued':
      return t('import.queue_status_queued');
    case 'running':
    case 'awaiting_save':
      return item.phase ? t(PHASE_LABEL_KEYS[item.phase]) : t('import.phase_default');
    case 'done':
      return t('import.queue_status_done');
    case 'needs_review':
      return t('import.queue_status_needs_review');
    case 'failed':
      return t('import.queue_status_failed');
  }
}

export function ImportQueue({
  items,
  onDismiss,
  onView,
}: {
  items: ActiveImport[];
  onDismiss: (jobId: string) => void;
  onView: (item: ActiveImport) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <section className="mt-6" aria-label={t('import.queue_heading')}>
      <h2 className="font-display text-lg mb-2">{t('import.queue_heading')}</h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          const active = isActive(item.status);
          const source = sourceLabel(item, t);
          return (
            <li
              key={item.jobId}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-ink/10 bg-paper px-3 py-2"
            >
              <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink-soft" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{source}</p>
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    item.status === 'failed' ? 'text-pomegranate' : 'text-ink-soft',
                  )}
                >
                  {active && (
                    <Loader size={12} strokeWidth={1.75} className="animate-spin" aria-hidden />
                  )}
                  {item.status === 'done' && (
                    <CheckCircle2 size={12} strokeWidth={1.75} className="text-basil" aria-hidden />
                  )}
                  {(item.status === 'failed' || item.status === 'needs_review') && (
                    <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
                  )}
                  {statusLabel(item, t)}
                </p>
              </div>
              {item.status === 'done' && item.recipeId && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-aubergine underline"
                  onClick={() => onView(item)}
                >
                  {t('import.ready_view_recipe')}
                </button>
              )}
              {!active && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-ink-muted hover:text-ink"
                  aria-label={t('import.queue_dismiss_aria', { source })}
                  onClick={() => onDismiss(item.jobId)}
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
