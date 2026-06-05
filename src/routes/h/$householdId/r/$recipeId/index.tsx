import { convert, niceQuantity, pickDisplayUnit, quantityToNumber } from '@/domain';
import { useAuth } from '@/lib/auth';
import { useIsRecipeEditor, useRecipe } from '@/lib/queries/recipes';
import { Badge } from '@/ui/primitives/Badge';
import { Card } from '@/ui/primitives/Card';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { type DisplayIngredient, IngredientsCard } from '@/ui/recipe/IngredientsCard';
import { ServingsScaler } from '@/ui/recipe/ServingsScaler';
import { UnitToggle } from '@/ui/recipe/UnitToggle';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { requireAuth } from '../../../../_guards';

const Search = z
  .object({
    scale: z.coerce.number().positive().optional(),
    servings: z.coerce.number().int().positive().optional(),
    units: z.enum(['metric', 'imperial']).optional(),
    lang: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
  })
  .refine(
    (s) => !(s.scale !== undefined && s.servings !== undefined),
    'use scale or servings, not both',
  );

export const Route = createFileRoute('/h/$householdId/r/$recipeId/')({
  beforeLoad: requireAuth,
  validateSearch: Search,
  component: RecipeDetailPage,
});

function RecipeDetailPage() {
  const { householdId, recipeId } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const profile = useAuth((s) => s.profile);
  const canEdit = useIsRecipeEditor(householdId);
  const { t } = useTranslation();
  const q = useRecipe(recipeId);

  const displayUnits = search.units ?? profile?.preferred_unit_system ?? 'metric';

  const displayed = useMemo(() => {
    if (!q.data) return null;
    const factor = (() => {
      if (search.scale) return search.scale;
      if (search.servings) return search.servings / q.data.recipe.servings;
      return 1;
    })();
    const ingredients = q.data.ingredients.map((ing) => {
      if (ing.quantity == null || !ing.unit)
        return { ...ing, displayValue: null, displayUnit: null };
      // quantity is the domain union (number | {numerator,denominator});
      // collapse to a number for unit conversion + scaling.
      const baseQty = quantityToNumber(ing.quantity);
      const target = pickDisplayUnit(ing.unit, baseQty, displayUnits);
      try {
        const converted = convert(baseQty * factor, ing.unit, target);
        return { ...ing, displayValue: niceQuantity(converted, target), displayUnit: target };
      } catch {
        return { ...ing, displayValue: baseQty * factor, displayUnit: ing.unit };
      }
    });
    return {
      ...q.data,
      recipe: {
        ...q.data.recipe,
        servings: Math.max(1, Math.round(q.data.recipe.servings * factor)),
      },
      ingredients,
    };
  }, [q.data, search.scale, search.servings, displayUnits]);

  if (q.isLoading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-32" />
      </main>
    );
  }
  if (!displayed) return <main className="p-8 text-ink-soft">Recipe not found.</main>;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {displayed.recipe.hero_image_path && (
        <div className="aspect-[3/2] mb-8 overflow-hidden rounded-[var(--radius-lg)] border border-cream-line">
          <RecipeImage
            path={displayed.recipe.hero_image_path}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {displayed.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>

      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="font-display text-display leading-tight">{displayed.recipe.title}</h1>
        {canEdit && (
          <Link
            to="/h/$householdId/r/$recipeId/edit"
            params={{ householdId, recipeId }}
            className="mt-2 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-paper hover:text-ink"
            aria-label={t('recipe.edit_action')}
          >
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t('recipe.edit_action')}</span>
          </Link>
        )}
      </div>
      {displayed.recipe.description && (
        <p className="text-lg text-ink-soft leading-relaxed mb-8 max-w-prose">
          {displayed.recipe.description}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-8">
        <aside className="space-y-6">
          <Card className="p-5 space-y-4">
            <ServingsScaler
              servings={displayed.recipe.servings}
              defaultServings={q.data?.recipe.servings ?? displayed.recipe.servings}
              onChange={(s) =>
                nav({
                  to: '.',
                  search: (prev) => ({ ...prev, servings: Math.round(s), scale: undefined }),
                  resetScroll: false,
                })
              }
            />
            <UnitToggle
              value={displayUnits}
              onChange={(u) =>
                nav({ to: '.', search: (prev) => ({ ...prev, units: u }), resetScroll: false })
              }
            />
          </Card>

          <IngredientsCard ingredients={displayed.ingredients as DisplayIngredient[]} />
        </aside>

        <section>
          <h2 className="font-display text-xl mb-4">Steps</h2>
          <ol className="space-y-6">
            {displayed.steps.map((s) => (
              <li key={s.id} className="grid grid-cols-[2.5rem_1fr] gap-4">
                <span className="font-mono text-2xl tabular-nums text-saffron">
                  {s.position + 1}
                </span>
                <p className="leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
