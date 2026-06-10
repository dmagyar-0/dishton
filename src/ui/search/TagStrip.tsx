import { cn } from '@/ui/cn';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

export type CollapseProps =
  | { collapsed?: never; onCollapseToggle?: never }
  | { collapsed: boolean; onCollapseToggle: () => void };

export type TagStripProps = {
  tags: { tag: string; n?: number }[];
  selected: string[];
  onToggle: (tag: string) => void;
  /** When true, collapse the full cloud to a single row with only active chips +
   *  a disclosure toggle. Pass `undefined` (default) to always show the full cloud. */
  className?: string;
} & CollapseProps;

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
          {'· '}
          {n}
        </span>
      )}
    </button>
  );
}

function DisclosureToggle({
  expanded,
  onClick,
  controls,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  controls: string;
  label: string;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-pill)] border px-3 py-1 text-sm transition-colors',
        'duration-[var(--duration-fast)]',
        'bg-paper-2 text-ink-soft border-cream-line hover:bg-paper',
      )}
    >
      {label}
      <Icon className="h-3 w-3" aria-hidden="true" />
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
  // Stable id linking the disclosure buttons to the full cloud panel they toggle.
  const cloudId = useId();
  const panelId = `${cloudId}-panel`;

  if (tags.length === 0) return null;

  // Collapsed mode: show only active chips + disclosure toggle.
  if (collapsed) {
    const activeTags = tags.filter(({ tag }) => selected.includes(tag));
    return (
      <div
        className={cn('flex flex-wrap items-center gap-2', className)}
        role="group"
        aria-label={t('search.tag_filters_label')}
      >
        {activeTags.map(({ tag, n }) => (
          <TagChip key={tag} tag={tag} n={n} active onToggle={onToggle} />
        ))}
        <DisclosureToggle
          expanded={false}
          onClick={onCollapseToggle}
          controls={panelId}
          label={t('search.filter_by_tag')}
        />
      </div>
    );
  }

  // Expanded / default mode: full cloud.
  return (
    <div
      id={panelId}
      className={cn('flex flex-wrap items-center gap-2', className)}
      role="group"
      aria-label={t('search.tag_filters_label')}
    >
      {tags.map(({ tag, n }) => {
        const active = selected.includes(tag);
        return <TagChip key={tag} tag={tag} n={n} active={active} onToggle={onToggle} />;
      })}
      {/* When a collapse toggle is provided (query active or tags selected), show a "less" button */}
      {onCollapseToggle && (
        <DisclosureToggle
          expanded={true}
          onClick={onCollapseToggle}
          controls={panelId}
          label={t('search.hide_tag_filters')}
        />
      )}
    </div>
  );
}
