// Public, unauthenticated share landing page body. The /r/$token route wires
// search params into the props; keeping the component router-light makes it
// testable without router internals. The token in the URL is the credential,
// resolved via the get_public_recipe RPC (anon-capable).

import { formatDisplayQuantity, formatNumber, scaleToServings } from '@/domain';
import { usePublicHeroImage, usePublicRecipe } from '@/lib/queries/shares';
import { resolveDisplay, toDomainRecipe } from '@/lib/recipe-display';
import { Badge } from '@/ui/primitives/Badge';
import { Card } from '@/ui/primitives/Card';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { type DisplayIngredient, IngredientsCard } from '@/ui/recipe/IngredientsCard';
import { ServingsScaler } from '@/ui/recipe/ServingsScaler';
import { type UnitSystem, UnitToggle } from '@/ui/recipe/UnitToggle';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type PublicRecipePageProps = {
  token: string;
  servings?: number;
  units?: UnitSystem;
  onServingsChange: (servings: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
};

const CTA_CLASS =
  'inline-flex h-11 items-center rounded-[var(--radius-md)] bg-saffron px-5 font-body text-sm text-saffron-ink shadow-press transition-colors duration-[var(--duration-fast)] hover:opacity-90';

export function PublicRecipePage({
  token,
  servings,
  units,
  onServingsChange,
  onUnitsChange,
}: PublicRecipePageProps) {
  const { t } = useTranslation();
  const q = usePublicRecipe(token);
  const heroUrl = usePublicHeroImage(q.data?.recipe.hero_image_path ?? null);

  const displayUnits = units ?? 'metric';

  useEffect(() => {
    if (q.data) document.title = `${q.data.recipe.title} — Dishton`;
  }, [q.data]);

  const displayed = useMemo(() => {
    if (!q.data) return null;
    const { recipe } = q.data;
    const domainRecipe = toDomainRecipe({
      recipe: {
        title: recipe.title,
        description: recipe.description,
        source_type: recipe.source_type,
        source_url: recipe.source_url,
        source_language: recipe.source_language,
        canonical_unit_system: recipe.canonical_unit_system,
        servings: recipe.servings,
        total_time_min: recipe.total_time_min,
        hero_image_path: recipe.hero_image_path,
      },
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      tags: recipe.tags,
    });
    const scaled = servings ? scaleToServings(domainRecipe, servings) : domainRecipe;
    const ingredients: DisplayIngredient[] = recipe.ingredients.map((ing, i) => {
      const scaledQty = scaled.ingredients[i]?.quantity ?? null;
      const { displayQuantity, displayUnit } = resolveDisplay(ing, scaledQty, displayUnits);
      return { ...ing, id: `${ing.position}`, displayQuantity, displayUnit };
    });
    return { servings: scaled.servings, ingredients, steps: recipe.steps };
  }, [q.data, servings, displayUnits]);

  if (q.isLoading) {
    return (
      <PublicFrame>
        <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
          <Skeleton className="h-64" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-32" />
        </main>
      </PublicFrame>
    );
  }

  if (q.isError || !q.data || !displayed) {
    return (
      <PublicFrame>
        <main className="mx-auto max-w-2xl px-4 py-12">
          <Card className="space-y-3 p-6 text-center">
            <h1 className="font-display text-2xl text-ink">{t('public.inactive_title')}</h1>
            <p className="text-ink-soft">{t('public.inactive_body')}</p>
            <div className="pt-2">
              <Link to="/" className={CTA_CLASS}>
                {t('public.inactive_action')}
              </Link>
            </div>
          </Card>
        </main>
      </PublicFrame>
    );
  }

  const { recipe } = q.data;
  return (
    <PublicFrame>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {heroUrl && (
          <div className="mb-8 aspect-[3/2] overflow-hidden rounded-[var(--radius-lg)] border border-cream-line">
            <img src={heroUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}

        {recipe.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {recipe.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <h1 className="mb-2 font-display text-display leading-tight">{recipe.title}</h1>
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-saffron">
          {t('public.from_household', {
            name: q.data.household_name,
            namePossessive: possessive(q.data.household_name),
          })}
        </p>
        {recipe.description && (
          <p className="mb-8 max-w-prose text-lg leading-relaxed text-ink-soft">
            {recipe.description}
          </p>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[20rem_1fr]">
          <aside className="space-y-6">
            <Card className="space-y-4 p-5">
              <ServingsScaler
                servings={displayed.servings}
                defaultServings={recipe.servings}
                onChange={(s) => onServingsChange(Math.round(s))}
              />
              <UnitToggle value={displayUnits} onChange={onUnitsChange} />
            </Card>
            <IngredientsCard
              ingredients={displayed.ingredients}
              formatDecimal={formatNumber}
              formatDisplayQuantity={formatDisplayQuantity}
            />
          </aside>

          <section>
            <h2 className="mb-4 font-display text-xl">{t('recipe.steps')}</h2>
            <ol className="space-y-6">
              {displayed.steps.map((s) => (
                <li key={s.position} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="font-mono text-2xl tabular-nums text-saffron">
                    {s.position + 1}
                  </span>
                  <p className="leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <Card className="mt-12 space-y-3 bg-paper-2 p-6 text-center">
          <h2 className="font-display text-2xl text-ink">{t('public.cta_title')}</h2>
          <p className="mx-auto max-w-prose text-ink-soft">{t('public.cta_body')}</p>
          <div className="pt-1">
            <Link to="/auth/signup" className={CTA_CLASS}>
              {t('public.cta_action')}
            </Link>
          </div>
        </Card>
      </main>
    </PublicFrame>
  );
}

// English possessive for the attribution line. Names already ending in "s"
// (e.g. the default "My Recipes") take a bare apostrophe so we don't render
// the awkward "My Recipes's pantry". Only the English string consumes this;
// the de/hu templates phrase attribution without a genitive 's.
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function PublicFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-cream-line">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="font-display text-xl text-aubergine">
            {t('app.name')}
          </Link>
          <Link to="/auth/signup" className="font-body text-sm text-ink-soft hover:text-ink">
            {t('public.cta_action')}
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
