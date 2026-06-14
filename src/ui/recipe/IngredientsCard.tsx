import type { Quantity } from '@/domain';
import { formatUnit } from '@/domain';
import type { FullRecipe } from '@/lib/queries/recipes';
import { cn } from '@/ui/cn';
import { Card } from '@/ui/primitives/Card';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type DisplayIngredient = FullRecipe['ingredients'][number] & {
  // The scaled + unit-converted quantity to render (a number, a fraction
  // object, or null for "no quantity"). Distinct from the canonical `quantity`.
  displayQuantity: Quantity | null;
  displayUnit: string | null;
};

export type IngredientsCardProps = {
  ingredients: DisplayIngredient[];
  // Pure formatters injected from the domain layer so this component stays free
  // of unit/fraction logic.
  formatDecimal: (value: number) => string;
  formatDisplayQuantity: (
    value: Quantity,
    unit: string | null | undefined,
    formatDecimal: (value: number) => string,
  ) => string;
  isTranslating?: boolean;
  className?: string;
};

export function IngredientsCard({
  ingredients,
  formatDecimal,
  formatDisplayQuantity,
  isTranslating,
  className,
}: IngredientsCardProps) {
  const { t } = useTranslation();
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
        {t('recipe.ingredients')}
      </h2>

      {groups.length === 0 ? (
        <p className="font-body text-sm text-ink-muted italic">{t('recipe.no_ingredients')}</p>
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
                  className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-saffron mb-2"
                >
                  {group.section}
                </h3>
              )}
              <ul className="space-y-1">
                {group.items.map((ing) => (
                  <IngredientRow
                    key={ing.id}
                    ing={ing}
                    formatDecimal={formatDecimal}
                    formatDisplayQuantity={formatDisplayQuantity}
                    isTranslating={isTranslating}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </Card>
  );
}

function IngredientRow({
  ing,
  formatDecimal,
  formatDisplayQuantity,
  isTranslating,
}: {
  ing: DisplayIngredient;
  formatDecimal: IngredientsCardProps['formatDecimal'];
  formatDisplayQuantity: IngredientsCardProps['formatDisplayQuantity'];
  isTranslating?: boolean;
}) {
  const hasQty = ing.displayQuantity != null;
  const qtyText = hasQty
    ? formatDisplayQuantity(ing.displayQuantity as Quantity, ing.displayUnit, formatDecimal)
    : null;
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
                <span aria-hidden> </span>
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

      <span
        className={cn(
          'font-body text-[0.95rem] leading-snug text-ink',
          isTranslating && 'opacity-50',
        )}
      >
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
