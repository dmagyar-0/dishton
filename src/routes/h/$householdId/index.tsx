import { useAuth } from '@/lib/auth';
import { useHousehold } from '@/lib/queries/households';
import { useIsRecipeEditor, useRecipeList } from '@/lib/queries/recipes';
import { Badge } from '@/ui/primitives/Badge';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { RecipeCardDeleteButton } from '@/ui/recipe/RecipeCardDeleteButton';
import { RecipeCardMedia } from '@/ui/recipe/RecipeCardMedia';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

export const Route = createFileRoute('/h/$householdId/')({
  beforeLoad: requireAuth,
  component: RecipeListPage,
});

function RecipeListPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const list = useRecipeList(householdId);
  const household = useHousehold(householdId);
  const memberships = useAuth((s) => s.memberships);
  // Only owners/editors may delete; followers can read but their delete would
  // be a silent RLS no-op, so don't offer them the action.
  const isEditor = useIsRecipeEditor(householdId);
  // Solo = personal household with the current user as only member. We
  // use it to swap in a friendlier headline + empty state for new
  // signups, so the recipe-list page doesn't feel like a clinical
  // "household" surface when there's no household to speak of.
  const isSolo =
    household.data?.is_personal === true &&
    memberships.filter((m) => m.household_id === householdId).length === 1 &&
    memberships.length === 1;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="font-display text-display">
          {isSolo ? t('recipe.list_title_solo') : t('recipe.list_title')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/h/$householdId/draft" params={{ householdId }}>
            <Button variant="secondary">{t('chat.nav')}</Button>
          </Link>
          <Link to="/h/$householdId/import" params={{ householdId }}>
            <Button>{t('nav.import')}</Button>
          </Link>
        </div>
      </header>

      {list.isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {list.data && list.data.length === 0 && (
        <EmptyState
          title={isSolo ? t('recipe.empty_title_solo') : t('recipe.empty_title')}
          description={isSolo ? t('recipe.empty_body_solo') : ''}
          action={
            <Link to="/h/$householdId/import" params={{ householdId }}>
              <Button>{t('recipe.empty_action')}</Button>
            </Link>
          }
        />
      )}

      {list.data && list.data.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {list.data.map((r) => (
            <li key={r.id} className="group/card relative">
              {isEditor && (
                <RecipeCardDeleteButton
                  recipeId={r.id}
                  recipeTitle={r.title}
                  householdId={householdId}
                  heroImagePath={r.hero_image_path}
                />
              )}
              <Link
                to="/h/$householdId/r/$recipeId"
                params={{ householdId, recipeId: r.id }}
                className="block group/link"
              >
                <Card className="p-0 overflow-hidden h-full">
                  <RecipeCardMedia heroImagePath={r.hero_image_path} title={r.title} />
                  <div className="p-5">
                    <h2 className="font-display text-2xl leading-tight mb-2">{r.title}</h2>
                    {r.description && (
                      <p className="text-ink-soft text-sm line-clamp-2">{r.description}</p>
                    )}
                    {r.recipe_tags && r.recipe_tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {r.recipe_tags.slice(0, 4).map((t) => (
                          <Badge key={t.tag} variant="outline">
                            {t.tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
