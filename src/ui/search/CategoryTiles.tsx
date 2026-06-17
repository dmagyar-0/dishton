import { cn } from '@/ui/cn';
import { ProduceGlyph, categoryDisc } from './ProduceGlyph';

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
 * Horizontal, scrollable row of meal-category tiles for the Home screen — the
 * Lane 3 (Soft Contrast) look: a tinted, print-textured disc holding an artsy
 * produce glyph, label beneath. The active tile gets an accent ring (not a
 * fill) and a bold label. Selecting a tile filters the list by that tag.
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
        const on = active === id;
        const disc = categoryDisc(id);
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
                'tex flex size-15 items-center justify-center overflow-hidden rounded-[18px]',
                'border border-black/8 text-ink-soft shadow-press',
                'transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-paper)]',
                'group-hover/ctile:-translate-y-0.5',
                disc.tint,
                disc.tex,
                on && 'ring-2 ring-accent-ink',
              )}
            >
              <ProduceGlyph category={id} size={34} />
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
