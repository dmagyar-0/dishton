import type { Quantity, Recipe } from '@/domain';
import {
  convert,
  formatDisplayQuantity,
  formatNumber,
  niceQuantity,
  normaliseBcp47,
  pickDisplayUnit,
  quantityIsEmpty,
  quantityToNumber,
  scale,
  scaleToServings,
} from '@/domain';
import { useFeatureFlag } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { useIsRecipeEditor, useRecipe } from '@/lib/queries/recipes';
import { useCachedTranslations, useTranslateRecipe } from '@/lib/queries/translations';
import { Badge } from '@/ui/primitives/Badge';
import { Card } from '@/ui/primitives/Card';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { type DisplayIngredient, IngredientsCard } from '@/ui/recipe/IngredientsCard';
import { LanguageToggle } from '@/ui/recipe/LanguageToggle';
import { ServingsScaler } from '@/ui/recipe/ServingsScaler';
import { UnitToggle } from '@/ui/recipe/UnitToggle';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
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

type FullRecipe = ReturnType<typeof useRecipe>['data'];
type FullIngredient = NonNullable<FullRecipe>['ingredients'][number];

// The translatable payload swapped in when a cached translation is shown.
type TranslationPayload = {
  title?: string;
  description?: string | null;
  steps?: { body?: string }[];
  ingredients?: { ingredient_name?: string | null; raw_text?: string }[];
};

// Build a domain Recipe from the loaded FullRecipe so we can run the tested
// scale() pipeline (which snaps via niceQuantity in the stored unit) before the
// display-side unit conversion. scalable persistence is deferred (the DB has no
// such column), so every ingredient is treated as scalable — matching current
// behaviour.
function toDomainRecipe(full: NonNullable<FullRecipe>): Recipe {
  return {
    title: full.recipe.title,
    description: full.recipe.description,
    source_type: full.recipe.source_type,
    source_url: full.recipe.source_url,
    source_language: full.recipe.source_language,
    canonical_unit_system: full.recipe.canonical_unit_system,
    servings: full.recipe.servings,
    total_time_min: full.recipe.total_time_min,
    hero_image_path: full.recipe.hero_image_path,
    tags: full.tags,
    ingredients: full.ingredients.map((ing) => ({
      position: ing.position,
      raw_text: ing.raw_text,
      quantity: ing.quantity,
      unit: ing.unit,
      ingredient_name: ing.ingredient_name,
      notes: ing.notes,
      scalable: true,
      non_scalable_qty: null,
      section: ing.section,
    })),
    steps: full.steps.map((s) => ({
      position: s.position,
      body: s.body,
      duration_min: s.duration_min,
    })),
  };
}

// Resolve the quantity + unit a row should display: scale via the domain
// pipeline, then convert to the preferred display unit. Stored fractions
// round-trip unchanged when neither scaling nor conversion changes the value.
function resolveDisplay(
  source: FullIngredient,
  scaledQty: Quantity | null,
  displayUnits: 'metric' | 'imperial',
): { displayQuantity: Quantity | null; displayUnit: string | null } {
  if (quantityIsEmpty(scaledQty) || !source.unit) {
    return { displayQuantity: null, displayUnit: null };
  }
  // scaledQty is non-empty here.
  const scaledNumber = quantityToNumber(scaledQty as Quantity);
  const target = pickDisplayUnit(source.unit, scaledNumber, displayUnits);
  if (target === source.unit) {
    // No conversion: prefer the value the scale pipeline produced, which keeps
    // a stored exact fraction (e.g. 1/3) faithful when the factor is 1.
    return { displayQuantity: scaledQty, displayUnit: source.unit };
  }
  try {
    const converted = convert(scaledNumber, source.unit, target);
    return { displayQuantity: niceQuantity(converted, target), displayUnit: target };
  } catch {
    return { displayQuantity: scaledQty, displayUnit: source.unit };
  }
}

function RecipeDetailPage() {
  const { householdId, recipeId } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const profile = useAuth((s) => s.profile);
  const canEdit = useIsRecipeEditor(householdId);
  const { t } = useTranslation();
  const q = useRecipe(recipeId);

  const translationEnabled = useFeatureFlag('translation_cache');
  const cachedLangsQ = useCachedTranslations(recipeId);

  const displayUnits = search.units ?? profile?.preferred_unit_system ?? 'metric';

  const sourceLanguage = q.data?.recipe.source_language ?? 'en';
  const cachedLanguages = useMemo(
    () => (translationEnabled ? (cachedLangsQ.data ?? []) : []),
    [translationEnabled, cachedLangsQ.data],
  );

  // Resolve the display language: ?lang override -> profile preference ->
  // recipe source language. Prefer an already-cached variant (exact, then the
  // base of a regional code); otherwise resolve to the requested language
  // itself so the translate effect fetches and caches it on demand, rather than
  // silently falling back to the source language.
  const displayLanguage = useMemo(() => {
    if (!translationEnabled) return sourceLanguage;
    const norm =
      normaliseBcp47(search.lang ?? profile?.preferred_language ?? sourceLanguage) ??
      sourceLanguage;
    if (norm === sourceLanguage) return sourceLanguage;
    const cached = new Set(cachedLanguages);
    if (cached.has(norm)) return norm;
    const base = norm.includes('-') ? (norm.split('-')[0] ?? norm) : norm;
    if (base !== norm && cached.has(base)) return base;
    return norm;
  }, [
    translationEnabled,
    search.lang,
    profile?.preferred_language,
    sourceLanguage,
    cachedLanguages,
  ]);

  const isSourceLanguage = displayLanguage === sourceLanguage;

  // Fetch the cached translation payload for the resolved non-source language.
  const translateMutation = useTranslateRecipe(recipeId, displayLanguage);
  const {
    mutate: triggerTranslate,
    isPending: isTranslating,
    data: translateData,
  } = translateMutation;

  // Fetch the translated payload for any non-source display language. The
  // translate-recipe Edge Function returns the cached payload on a hit (and only
  // calls the model on a true miss), so this both displays already-cached
  // translations and populates the cache on a miss. Fire once per language to
  // avoid redundant calls when the cached-languages list resolves.
  const requestedLangRef = useRef<string | null>(null);
  useEffect(() => {
    if (!translationEnabled) return;
    if (isSourceLanguage) return;
    if (cachedLangsQ.isLoading) return;
    if (requestedLangRef.current === displayLanguage) return;
    requestedLangRef.current = displayLanguage;
    triggerTranslate();
  }, [
    translationEnabled,
    isSourceLanguage,
    cachedLangsQ.isLoading,
    displayLanguage,
    triggerTranslate,
  ]);

  const translation = useMemo<TranslationPayload | null>(() => {
    if (!translationEnabled || isSourceLanguage) return null;
    const payload = (translateData as { payload?: unknown } | undefined)?.payload;
    if (payload && typeof payload === 'object') return payload as TranslationPayload;
    return null;
  }, [translationEnabled, isSourceLanguage, translateData]);

  const displayed = useMemo(() => {
    if (!q.data) return null;
    const domainRecipe = toDomainRecipe(q.data);
    const scaled = (() => {
      if (search.scale) return scale(domainRecipe, search.scale);
      if (search.servings) return scaleToServings(domainRecipe, search.servings);
      return domainRecipe;
    })();

    const ingredients: DisplayIngredient[] = q.data.ingredients.map((ing, i) => {
      const scaledQty = scaled.ingredients[i]?.quantity ?? null;
      const { displayQuantity, displayUnit } = resolveDisplay(ing, scaledQty, displayUnits);
      const translatedName = translation?.ingredients?.[i]?.ingredient_name;
      const translatedRaw = translation?.ingredients?.[i]?.raw_text;
      return {
        ...ing,
        ingredient_name: translatedName ?? ing.ingredient_name,
        raw_text: translatedRaw ?? ing.raw_text,
        displayQuantity,
        displayUnit,
      };
    });

    const steps = q.data.steps.map((s, i) => ({
      ...s,
      body: translation?.steps?.[i]?.body ?? s.body,
    }));

    return {
      ...q.data,
      recipe: {
        ...q.data.recipe,
        title: translation?.title ?? q.data.recipe.title,
        description:
          translation?.description !== undefined
            ? translation.description
            : q.data.recipe.description,
        servings: scaled.servings,
      },
      ingredients,
      steps,
    };
  }, [q.data, search.scale, search.servings, displayUnits, translation]);

  if (q.isLoading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-32" />
      </main>
    );
  }

  if (q.isError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Card className="space-y-3 text-center">
          <h1 className="font-display text-2xl text-ink">{t('recipe.load_error_title')}</h1>
          <p className="text-ink-soft">{t('recipe.load_error_body')}</p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => q.refetch()}
              className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-4 text-sm text-ink transition-colors hover:bg-paper"
            >
              {t('recipe.load_error_retry')}
            </button>
          </div>
        </Card>
      </main>
    );
  }

  if (!displayed) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <Card className="space-y-3 text-center">
          <h1 className="font-display text-2xl text-ink">{t('recipe.not_found_title')}</h1>
          <p className="text-ink-soft">{t('recipe.not_found_body')}</p>
        </Card>
      </main>
    );
  }

  const languageOptions = (() => {
    const codes = new Set([sourceLanguage, ...cachedLanguages, displayLanguage]);
    const preferred = normaliseBcp47(profile?.preferred_language);
    if (preferred) codes.add(preferred);
    return Array.from(codes).map((code) => ({ code, native: code }));
  })();

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

      <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <h1 className="font-display text-display leading-tight">{displayed.recipe.title}</h1>
        {canEdit && (
          <Link
            to="/h/$householdId/r/$recipeId/edit"
            params={{ householdId, recipeId }}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-paper hover:text-ink sm:mt-2"
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
            {translationEnabled && languageOptions.length > 1 && (
              <LanguageToggle
                value={displayLanguage}
                options={languageOptions}
                label={t('recipe.language')}
                onChange={(lang) =>
                  nav({ to: '.', search: (prev) => ({ ...prev, lang }), resetScroll: false })
                }
              />
            )}
          </Card>

          <IngredientsCard
            ingredients={displayed.ingredients}
            isTranslating={translationEnabled && !isSourceLanguage && isTranslating}
            formatDecimal={formatNumber}
            formatDisplayQuantity={formatDisplayQuantity}
          />
        </aside>

        <section>
          <h2 className="font-display text-xl mb-4">{t('recipe.steps')}</h2>
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
