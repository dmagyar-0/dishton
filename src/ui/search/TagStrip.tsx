import { cn } from '@/ui/cn';

export type TagStripProps = {
  tags: { tag: string; n?: number }[];
  selected: string[];
  onToggle: (tag: string) => void;
  className?: string;
};

export function TagStrip({ tags, selected, onToggle, className }: TagStripProps) {
  if (tags.length === 0) return null;
  return (
    <div
      className={cn('flex flex-wrap gap-2 overflow-x-auto md:overflow-visible', className)}
      role="group"
      aria-label="Tag filters"
    >
      {tags.map(({ tag, n }) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(tag)}
            className={cn(
              'rounded-[var(--radius-pill)] border px-3 py-1 text-sm transition-colors',
              'duration-[var(--duration-fast)]',
              active
                ? 'bg-sage text-sage-ink border-sage'
                : 'bg-paper-2 text-ink border-cream-line hover:bg-paper',
            )}
          >
            {tag}
            {n != null && <span className="ml-1 font-mono text-xs opacity-70">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
