import { cn } from '@/ui/cn';
import { categoryIcon } from './categoryIcons';

export type CategoryTileItem = { id: string; label: string };

export type CategoryTilesProps = {
  /** Category tiles to show, in order. The "All" tile is expected first. */
  items: CategoryTileItem[];
  /** The active category id ('all' when nothing is filtered). */
  active: string;
  onPick: (id: string) => void;
  className?: string;
};

/**
 * Horizontal, scrollable row of meal-category icon tiles for the Home screen.
 * The active tile fills saffron; the rest are paper-coloured. A re-skin of the
 * old tag-pill filter — selecting a tile filters the list by that tag.
 */
export function CategoryTiles({ items, active, onPick, className }: CategoryTilesProps) {
  return (
    <div
      role="group"
      aria-label="Categories"
      className={cn(
        '-mx-4 flex gap-[0.9rem] overflow-x-auto px-4 pt-1 pb-2',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map(({ id, label }) => {
        const Icon = categoryIcon(id);
        const on = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(id)}
            className="group/ctile flex w-15 shrink-0 cursor-pointer flex-col items-center gap-1.5 bg-transparent p-0"
          >
            <span
              className={cn(
                'flex size-15 items-center justify-center rounded-[18px] border',
                'transition-[transform,background-color,color,border-color,box-shadow]',
                'duration-[var(--duration-fast)] ease-[var(--ease-paper)]',
                'group-hover/ctile:-translate-y-0.5',
                on
                  ? 'border-saffron bg-saffron text-saffron-ink shadow-press'
                  : 'border-cream-line bg-paper-2 text-ink-soft',
              )}
            >
              <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span
              className={cn(
                'max-w-[3.9rem] truncate text-[0.7rem] leading-tight',
                on ? 'font-semibold text-ink' : 'text-ink-soft',
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
