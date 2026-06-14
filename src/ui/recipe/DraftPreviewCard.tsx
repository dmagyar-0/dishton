import type { Recipe } from '@/domain';
import { formatDisplayQuantity, formatNumber, formatUnit } from '@/domain';
import { Badge } from '@/ui/primitives/Badge';
import { Card } from '@/ui/primitives/Card';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// Renders an in-progress recipe draft using the same visual language as the
// recipe detail page (it is a plain Recipe, not a persisted row, so it can't
// reuse IngredientsCard's DB-row-shaped props — the styling is mirrored here).
export function DraftPreviewCard({ draft }: { draft: Recipe }) {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    const out: { section: string | null; items: Recipe['ingredients'] }[] = [];
    for (const ing of draft.ingredients) {
      const section = ing.section ?? null;
      const last = out[out.length - 1];
      if (last && last.section === section) last.items.push(ing);
      else out.push({ section, items: [ing] });
    }
    return out;
  }, [draft.ingredients]);

  return (
    <div className="space-y-6">
      {draft.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div>
        <h2 className="font-display text-2xl leading-tight">{draft.title}</h2>
        <p className="font-mono text-xs text-ink-muted mt-1">
          {`${draft.servings} · ${draft.canonical_unit_system}`}
          {draft.total_time_min ? ` · ${draft.total_time_min} min` : ''}
        </p>
      </div>

      {draft.description && (
        <p className="text-ink-soft leading-relaxed max-w-prose">{draft.description}</p>
      )}

      <Card className="p-5">
        <h3 className="font-display text-xl text-ink mb-4 pb-2 border-b border-saffron/30">
          {t('recipe.ingredients')}
        </h3>
        {groups.map((group) => (
          <section key={group.items[0]?.position ?? -1} className="mt-5 first:mt-0">
            {group.section && (
              <h4 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-saffron mb-2">
                {group.section}
              </h4>
            )}
            <ul className="space-y-1">
              {group.items.map((ing) => {
                const qty =
                  ing.quantity != null
                    ? formatDisplayQuantity(ing.quantity, ing.unit, formatNumber)
                    : null;
                const unit = ing.unit ? formatUnit(ing.unit) : null;
                return (
                  <li
                    key={ing.position}
                    className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-4"
                  >
                    <span className="font-mono text-sm tabular-nums text-right">
                      {qty ? (
                        <>
                          <span className="text-saffron font-semibold">{qty}</span>
                          {unit && <span className="text-ink-muted font-medium"> {unit}</span>}
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
              })}
            </ul>
          </section>
        ))}
      </Card>

      <section>
        <h3 className="font-display text-xl mb-4">{t('recipe.steps')}</h3>
        <ol className="space-y-6">
          {draft.steps.map((s) => (
            <li key={s.position} className="grid grid-cols-[2.5rem_1fr] gap-4">
              <span className="font-mono text-2xl tabular-nums text-saffron">{s.position + 1}</span>
              <p className="leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
