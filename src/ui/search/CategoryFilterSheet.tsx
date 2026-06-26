import { cn } from '@/ui/cn';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/ui/primitives';
import { useTranslation } from 'react-i18next';
import { ProduceGlyph } from './ProduceGlyph';
import { categoryLabel } from './categoryIcons';

export type CategoryFilterSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every category the household can filter by (allowed_tags). */
  library: string[];
  /** Currently active filter tags. */
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
};

/**
 * Filter the recipe list by any category, reached from the sliders button in
 * the search bar. Multi-select (AND), driving the same `tag` URL param the
 * category tiles use — this preserves filtering by categories that aren't on
 * the Home row.
 */
export function CategoryFilterSheet({
  open,
  onOpenChange,
  library,
  selected,
  onToggle,
  onClear,
}: CategoryFilterSheetProps) {
  const { t } = useTranslation();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        side="bottom"
        closeLabel={t('common.close')}
        className="mx-auto max-h-[88vh] max-w-[460px]"
      >
        <DrawerHeader className="pr-8">
          <DrawerTitle className="text-xl">{t('search.filter_title')}</DrawerTitle>
          <DrawerDescription>{t('search.filter_help')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-1 flex-wrap gap-2 overflow-y-auto py-1" role="group">
          {library.map((tag) => {
            const active = selected.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(tag)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm',
                  'transition-colors duration-[var(--duration-fast)]',
                  active
                    ? 'border-saffron bg-[color-mix(in_srgb,var(--color-saffron)_15%,var(--color-paper))] text-saffron-ink'
                    : 'border-cream-line bg-paper-2 text-ink hover:bg-paper',
                )}
              >
                <ProduceGlyph category={tag} size={18} />
                {categoryLabel(tag)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClear} disabled={selected.length === 0}>
            {t('search.clear_filters')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('search.filter_done')}</Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
