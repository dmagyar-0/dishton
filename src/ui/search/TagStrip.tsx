import { cn } from '@/ui/cn';
import { useTranslation } from 'react-i18next';

export type TagStripProps = {
  tags: { tag: string; n?: number }[];
  selected: string[];
  onToggle: (tag: string) => void;
  /** When true, collapse the full cloud to a single row with only active chips +
   *  a disclosure toggle. Pass `undefined` (default) to always show the full cloud. */
  collapsed?: boolean;
  /** Called when the disclosure toggle is clicked. Required when `collapsed` is provided. */
  onCollapseToggle?: () => void;
  className?: string;
};

function TagChip({
  tag,
  n,
  active,
  onToggle,
}: {
  tag: string;
  n?: number;
  active: boolean;
  onToggle: (t: string) => void;
}) {
  return (
    <button
      key={tag}
      type="button"
      aria-pressed={active}
      onClick={() => onToggle(tag)}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-3 py-1 text-sm transition-colors',
        'duration-[var(--duration-fast)]',
        active
          ? 'bg-sage text-sage-ink border-sage'
          : 'bg-paper-2 text-ink border-cream-line hover:bg-paper',
      )}
    >
      <span>{tag}</span>
      {n != null && (
        <span className="text-xs opacity-60">
          {'· '}
          {n}
        </span>
      )}
    </button>
  );
}

export function TagStrip({
  tags,
  selected,
  onToggle,
  collapsed,
  onCollapseToggle,
  className,
}: TagStripProps) {
  const { t } = useTranslation();

  if (tags.length === 0) return null;

  // Collapsed mode: show only active chips + disclosure toggle.
  if (collapsed) {
    const activeTags = tags.filter(({ tag }) => selected.includes(tag));
    return (
      <div
        className={cn('flex flex-wrap items-center gap-2', className)}
        role="group"
        aria-label="Tag filters"
      >
        {activeTags.map(({ tag, n }) => (
          <TagChip key={tag} tag={tag} n={n} active onToggle={onToggle} />
        ))}
        <button
          type="button"
          onClick={onCollapseToggle}
          aria-expanded={false}
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-3 py-1 text-sm transition-colors',
            'duration-[var(--duration-fast)]',
            'bg-paper-2 text-ink-soft border-cream-line hover:bg-paper',
          )}
        >
          {t('search.filter_by_tag')}
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" />
          </svg>
        </button>
      </div>
    );
  }

  // Expanded / default mode: full cloud.
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group" aria-label="Tag filters">
      {tags.map(({ tag, n }) => {
        const active = selected.includes(tag);
        return <TagChip key={tag} tag={tag} n={n} active={active} onToggle={onToggle} />;
      })}
      {/* When a collapse toggle is provided (query active) show a "less" button */}
      {onCollapseToggle && (
        <button
          type="button"
          onClick={onCollapseToggle}
          aria-expanded={true}
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-3 py-1 text-sm transition-colors',
            'duration-[var(--duration-fast)]',
            'bg-paper-2 text-ink-soft border-cream-line hover:bg-paper',
          )}
        >
          {t('search.hide_tag_filters')}
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 8l4-4 4 4" />
          </svg>
        </button>
      )}
    </div>
  );
}
