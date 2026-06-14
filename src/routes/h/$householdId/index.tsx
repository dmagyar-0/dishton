import { useFeatureFlag } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { useHousehold } from '@/lib/queries/households';
import {
  useLinkedRecipeIds,
  usePantryHouseholdId,
  useRecipeLinks,
} from '@/lib/queries/recipe-links';
import { type RecipeListRow, useIsRecipeEditor, useRecipeList } from '@/lib/queries/recipes';
import { usePopularTags, useRecipeSearch } from '@/lib/queries/search';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { RecipeCardDeleteButton } from '@/ui/recipe/RecipeCardDeleteButton';
import { RecipeCardRemoveLinkButton } from '@/ui/recipe/RecipeCardRemoveLinkButton';
import { RecipeCardSaveButton } from '@/ui/recipe/RecipeCardSaveButton';
import { RecipeLinkBadge } from '@/ui/recipe/RecipeLinkBadge';
import { SearchBar } from '@/ui/search/SearchBar';
import { TagStrip } from '@/ui/search/TagStrip';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ChefHat, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { requireAuth } from '../../_guards';

const Search = z.object({
  q: z.string().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
});

export const Route = createFileRoute('/h/$householdId/')({
  beforeLoad: requireAuth,
  validateSearch: Search,
  component: RecipeListPage,
});

type SearchParams = z.infer<typeof Search>;

function RecipeListPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const params = Route.useSearch() as SearchParams;
  const nav = Route.useNavigate();
  const household = useHousehold(householdId);
  const memberships = useAuth((s) => s.memberships);
  // Only owners/editors may delete; followers can read but their delete would
  // be a silent RLS no-op, so don't offer them the action.
  const isEditor = useIsRecipeEditor(householdId);
  // Member of the household being viewed? Followers (who reached this page from
  // /following) are not in `memberships`, so this distinguishes "my pantry"
  // (own + saved recipes, with delete/remove) from "browsing a followed
  // household" (their recipes, with a save-to-pantry button).
  const isMember = memberships.some((m) => m.household_id === householdId);
  const followsEnabled = useFeatureFlag('follows_enabled');
  // The household saved links land in / are read from (the user's own pantry).
  const pantryId = usePantryHouseholdId();

  // Own pantry: pull in the live links saved into this household, badged and
  // merged with own recipes. Only meaningful for a member view with follows on.
  const linksEnabled = followsEnabled && isMember;
  const links = useRecipeLinks(householdId, linksEnabled);
  // Followed-household browse: which of these recipes are already in my pantry,
  // so the save toggle can render its "saved" state without a per-card query.
  const browsingFollowed = followsEnabled && !isMember && pantryId.length > 0;
  const linkedIds = useLinkedRecipeIds(pantryId, browsingFollowed);
  // Solo = personal household with the current user as only member. We
  // use it to swap in a friendlier headline + empty state for new
  // signups, so the recipe-list page doesn't feel like a clinical
  // "household" surface when there's no household to speak of.
  const isSolo =
    household.data?.is_personal === true &&
    memberships.filter((m) => m.household_id === householdId).length === 1 &&
    memberships.length === 1;

  const tagParam = params.tag;
  const selected = useMemo(
    () => (Array.isArray(tagParam) ? tagParam : tagParam ? [tagParam] : []),
    [tagParam],
  );

  const q = params.q ?? '';
  const searchActive = q.trim().length >= 2;
  // Scoped to THIS household only — Home stays single-household.
  const search = useRecipeSearch(q, [householdId]);
  const list = useRecipeList(householdId);
  const tags = usePopularTags([householdId]);

  // Browse view = own recipes + saved links, newest first (link rows carry the
  // save time as their created_at). Text search stays own-household-only.
  const browseList = useMemo<RecipeListRow[]>(() => {
    const own = list.data ?? [];
    const linked = links.data ?? [];
    if (linked.length === 0) return own;
    return [...own, ...linked].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );
  }, [list.data, links.data]);

  const browseLoading = list.isLoading || (linksEnabled && links.isLoading);
  const source = searchActive ? search.data : browseList;
  const sourceFetching = searchActive ? search.isFetching : list.isFetching || links.isFetching;
  const sourceLoading = searchActive ? search.isLoading : browseLoading;

  const filtered = useMemo(() => {
    if (!source) return [];
    if (selected.length === 0) return source;
    return source.filter((r) => {
      const rt = (r.recipe_tags ?? []).map((t: { tag: string }) => t.tag);
      return selected.every((tag: string) => rt.includes(tag));
    });
  }, [source, selected]);

  // Two-level tag filter: level 1 = the household's configured main tags (in
  // their configured order); level 2 = the remaining popular tags. Counts come
  // from popular_tags; main tags with no current count simply show no number.
  const primary = household.data?.primary_tags ?? [];
  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const { tag, n } of tags.data ?? []) m.set(tag, n);
    return m;
  }, [tags.data]);

  const level1 = useMemo(
    () => primary.map((tag) => ({ tag, n: countMap.get(tag) })),
    [primary, countMap],
  );
  const level2 = useMemo(
    () => (tags.data ?? []).filter((tg) => !primary.includes(tg.tag)),
    [tags.data, primary],
  );

  const [showMore, setShowMore] = useState(false);
  // Auto-expand level 2 if a selected tag lives there, so a hidden selected tag
  // is never invisible.
  const expanded = showMore || selected.some((tg) => !primary.includes(tg));

  const onToggleTag = (tag: string) =>
    nav({
      search: (prev: SearchParams) => {
        const cur = Array.isArray(prev.tag) ? prev.tag : prev.tag ? [prev.tag] : [];
        const next = cur.includes(tag) ? cur.filter((tg) => tg !== tag) : [...cur, tag];
        return { ...prev, tag: next.length === 0 ? undefined : next };
      },
    });

  const hasTagUi = level1.length > 0 || level2.length > 0;
  const showNoMatches =
    !sourceLoading && filtered.length === 0 && (searchActive || selected.length > 0);
  const showEmptyPantry =
    !searchActive && selected.length === 0 && !browseLoading && browseList.length === 0;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="font-display text-display">
          {isSolo ? t('recipe.list_title_solo') : t('recipe.list_title')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/h/$householdId/import" params={{ householdId }}>
            <Button>{t('nav.import')}</Button>
          </Link>
        </div>
      </header>

      <div className="mb-6 space-y-3">
        <SearchBar
          value={q}
          loading={sourceFetching}
          onChange={(value) =>
            nav({
              search: (prev: SearchParams) => ({
                ...prev,
                q: value === '' ? undefined : value,
              }),
            })
          }
        />
        {hasTagUi && (
          <div className="space-y-2">
            {level1.length > 0 && (
              <TagStrip tags={level1} selected={selected} onToggle={onToggleTag} />
            )}
            {expanded && level2.length > 0 && (
              <TagStrip tags={level2} selected={selected} onToggle={onToggleTag} />
            )}
            {level2.length > 0 && (
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="text-sm text-ink-soft hover:text-ink underline underline-offset-2 transition-colors duration-[var(--duration-fast)]"
              >
                {expanded ? t('search.fewer_tags') : t('search.more_tags')}
              </button>
            )}
          </div>
        )}
      </div>

      {sourceLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}

      {showEmptyPantry && (
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

      {showNoMatches && (
        <Card className="p-6">
          <EmptyState
            title={t('search.no_matches_title')}
            description={
              searchActive
                ? selected.length > 0
                  ? t('search.no_matches_query_tags', { query: q })
                  : t('search.no_matches_query', { query: q })
                : t('search.no_matches_tags')
            }
            action={null}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((r) => (
            <li key={r.id} className="group/card relative">
              {/* Linked (followed) recipe in my own pantry: badge + remove. */}
              {r.is_link && (
                <>
                  <RecipeLinkBadge />
                  <RecipeCardRemoveLinkButton
                    recipeId={r.id}
                    recipeTitle={r.title}
                    householdId={householdId}
                  />
                </>
              )}
              {/* My own recipe: editors get delete. */}
              {!r.is_link && isMember && isEditor && (
                <RecipeCardDeleteButton
                  recipeId={r.id}
                  recipeTitle={r.title}
                  householdId={householdId}
                  heroImagePath={r.hero_image_path}
                />
              )}
              {/* Browsing a followed household: save into my pantry. */}
              {!r.is_link && browsingFollowed && (
                <RecipeCardSaveButton
                  recipeId={r.id}
                  recipeTitle={r.title}
                  pantryHouseholdId={pantryId}
                  saved={linkedIds.data?.has(r.id) ?? false}
                />
              )}
              <Link
                to="/h/$householdId/r/$recipeId"
                params={{ householdId: r.household_id, recipeId: r.id }}
                className="block group/link"
              >
                <Card className="p-0 overflow-hidden h-full">
                  {/* Always render the image box — recipes without a hero get a
                      branded placeholder so every card is the same height. */}
                  <div className="aspect-[4/3] w-full overflow-hidden border-b border-cream-line">
                    {r.hero_image_path ? (
                      <RecipeImage
                        path={r.hero_image_path}
                        alt=""
                        className="h-full w-full object-cover group-hover/link:scale-[1.02] transition-transform duration-[var(--duration-base)]"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center bg-paper"
                        aria-hidden="true"
                      >
                        <ChefHat
                          size={40}
                          strokeWidth={1.5}
                          className="text-ink-muted group-hover/link:scale-[1.02] transition-transform duration-[var(--duration-base)]"
                        />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    {/* min-h reserves two lines so single-line titles don't make a
                        shorter card than wrapped ones; line-clamp caps the overflow. */}
                    <h2 className="font-display text-base sm:text-lg leading-snug line-clamp-2 min-h-[2lh]">
                      {r.title}
                    </h2>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Always-visible shortcut to the import flow. `fixed` keeps it pinned to
          the bottom-center of the viewport as the recipe list scrolls. */}
      <Link
        to="/h/$householdId/import"
        params={{ householdId }}
        aria-label={t('nav.import_action')}
        title={t('nav.import_action')}
        className="fixed bottom-6 left-1/2 z-40 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-saffron text-saffron-ink shadow-press-lg transition-[transform,box-shadow] duration-[var(--duration-fast)] hover:-translate-y-px active:translate-y-0"
      >
        <Plus size={28} strokeWidth={2.25} aria-hidden="true" />
      </Link>
    </main>
  );
}
