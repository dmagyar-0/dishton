import { formatNumber, formatUnit } from '@/domain';
import type { FullRecipe } from '@/lib/queries/recipes';
import { cn } from '@/ui/cn';
import { Card } from '@/ui/primitives/Card';
import { useMemo } from 'react';

export type DisplayIngredient = FullRecipe['ingredients'][number] & {
  displayValue: number | null;
  displayUnit: string | null;
};

export type IngredientsCardProps = {
  ingredients: DisplayIngredient[];
  className?: string;
};

export function IngredientsCard({ ingredients, className }: IngredientsCardProps) {
  const groups = useMemo(() => {
    const out: { section: string | null; items: DisplayIngredient[] }[] = [];
    for (const ing of ingredients) {
      const last = out[out.length - 1];
      const section = ing.section ?? null;
      if (last && last.section === section) last.items.push(ing);
      else out.push({ section, items: [ing] });
    }
    return out;
  }, [ingredients]);

  return (
    <Card className={cn('p-5', className)}>
      <h2 className="font-display text-xl text-ink mb-4 pb-2 border-b border-saffron/30">
        Ingredients
      </h2>

      {groups.length === 0 ? (
        <p className="font-body text-sm text-ink-muted italic">No ingredients listed.</p>
      ) : (
        groups.map((group, gi) => {
          const headingId = group.section ? `ing-section-${gi}` : undefined;
          return (
            <section
              key={group.items[0]?.id ?? gi}
              className={gi === 0 ? '' : 'mt-5'}
              aria-labelledby={headingId}
            >
              {group.section && (
                <h3
                  id={headingId}
                  className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-saffron-ink mb-2"
                >
                  {group.section}
                </h3>
              )}
              <ul className="space-y-1">
                {group.items.map((ing) => (
                  <IngredientRow key={ing.id} ing={ing} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Card>
  );
}

function IngredientRow({ ing }: { ing: DisplayIngredient }) {
  const hasQty = ing.displayValue != null;
  const qtyText = hasQty ? formatNumber(ing.displayValue as number) : null;
  const unitText = ing.displayUnit ? formatUnit(ing.displayUnit) : null;

  return (
    <li
      className={cn(
        'grid grid-cols-[5.5rem_1fr] items-baseline gap-x-4 rounded-[var(--radius-sm)]',
        'px-1.5 py-1.5 -mx-1.5',
        'transition-colors duration-[var(--duration-fast)] hover:bg-paper/60',
      )}
    >
      <span className="font-mono text-sm tabular-nums leading-snug text-right">
        {hasQty ? (
          <>
            <span className="text-saffron font-semibold">{qtyText}</span>
            {unitText && (
              <>
                <span aria-hidden>{' '}</span>
                <span className="text-ink-muted font-medium">{unitText}</span>
              </>
            )}
          </>
        ) : (
          <span aria-hidden className="text-saffron/50">
            ·
          </span>
        )}
      </span>

      <span className="font-body text-[0.95rem] leading-snug text-ink">
        {ing.ingredient_name ?? ing.raw_text}
        {ing.notes && (
          <span className="block font-display italic text-xs text-ink-muted mt-0.5">
            {ing.notes}
          </span>
        )}
      </span>
    </li>
  );
}
