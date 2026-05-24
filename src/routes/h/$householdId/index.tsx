import { useRecipeList } from '@/lib/queries/recipes';
import { Badge } from '@/ui/primitives/Badge';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { RecipeCardDeleteButton } from '@/ui/recipe/RecipeCardDeleteButton';
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

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="font-display text-display">Recipes</h1>
        <Link to="/h/$householdId/import" params={{ householdId }}>
          <Button>{t('nav.import')}</Button>
        </Link>
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
          title={t('recipe.empty_title')}
          description=""
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
              <RecipeCardDeleteButton
                recipeId={r.id}
                recipeTitle={r.title}
                householdId={householdId}
              />
              <Link
                to="/h/$householdId/r/$recipeId"
                params={{ householdId, recipeId: r.id }}
                className="block group/link"
              >
                <Card className="p-0 overflow-hidden h-full">
                  {r.hero_image_path && (
                    <div className="aspect-[16/10] w-full overflow-hidden border-b border-cream-line">
                      <img
                        src={r.hero_image_path}
                        alt=""
                        className="h-full w-full object-cover group-hover/link:scale-[1.02] transition-transform duration-[var(--duration-base)]"
                      />
                    </div>
                  )}
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
