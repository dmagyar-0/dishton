import { useFeatureFlag } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { useHousehold, useUpdateHouseholdPrimaryTags } from '@/lib/queries/households';
import {
  useLinkedRecipeIds,
  usePantryHouseholdId,
  useRecipeLinks,
} from '@/lib/queries/recipe-links';
import { type RecipeListRow, useIsRecipeEditor, useRecipeList } from '@/lib/queries/recipes';
import { useRecipeSearch } from '@/lib/queries/search';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { useToast } from '@/ui/primitives/Toast';
import { RecipeCardDeleteButton } from '@/ui/recipe/RecipeCardDeleteButton';
import { RecipeCardRemoveLinkButton } from '@/ui/recipe/RecipeCardRemoveLinkButton';
import { RecipeCardSaveButton } from '@/ui/recipe/RecipeCardSaveButton';
import { RecipeLinkBadge } from '@/ui/recipe/RecipeLinkBadge';
import { CategoryFilterSheet } from '@/ui/search/CategoryFilterSheet';
import { CategoryTiles } from '@/ui/search/CategoryTiles';
import { CustomizeHomeSheet } from '@/ui/search/CustomizeHomeSheet';
import { SearchBar } from '@/ui/search/SearchBar';
import { ALL_CATEGORY, categoryLabel } from '@/ui/search/categoryIcons';
import { Link, createFileRoute } from '@tanstack/react-router';
import { ChefHat, Plus, SlidersHorizontal } from 'lucide-react';
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

  const updatePrimary = useUpdateHouseholdPrimaryTags(householdId);
  const { push } = useToast();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

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

  // Meal categories ARE tags (see src/domain/default-tags.ts). The household's
  // primary_tags lead Home as icon tiles after an always-present "All"; the full
  // allowed_tags library powers the Customize + Filter sheets. Picking a tile
  // filters the list by that tag, reusing the same `tag` URL param.
  const homeTags = household.data?.primary_tags ?? [];
  const library = household.data?.allowed_tags ?? [];

  const categoryItems = useMemo(
    () => [ALL_CATEGORY, ...homeTags].map((id) => ({ id, label: categoryLabel(id) })),
    [homeTags],
  );
  // Highlight a tile only for a clean single-category view; multi-tag filters
  // (set via the filter sheet) leave every tile unhighlighted.
  const activeCategory =
    selected.length === 0 ? ALL_CATEGORY : selected.length === 1 ? (selected[0] ?? '') : '';

  const setTagParam = (next: string[]) =>
    nav({
      search: (prev: SearchParams) => ({ ...prev, tag: next.length === 0 ? undefined : next }),
    });

  const onPickCategory = (id: string) => {
    if (id === ALL_CATEGORY) {
      setTagParam([]);
      return;
    }
    // Re-tapping the active single category clears back to "All".
    setTagParam(selected.length === 1 && selected[0] === id ? [] : [id]);
  };

  const onToggleTag = (tag: string) =>
    setTagParam(selected.includes(tag) ? selected.filter((x) => x !== tag) : [...selected, tag]);

  const saveHome = async (next: string[]) => {
    try {
      await updatePrimary.mutateAsync(next);
      push({ variant: 'success', title: t('household_settings.tags_saved') });
      // A category dropped from Home shouldn't keep silently filtering the list.
      if (selected.length === 1 && selected[0] && !next.includes(selected[0])) setTagParam([]);
    } catch {
      push({ variant: 'error', title: t('household_settings.tags_save_failed') });
    }
    setCustomizeOpen(false);
  };

  const sectionLabel =
    searchActive || selected.length > 1
      ? t('search.results')
      : selected.length === 1 && selected[0]
        ? categoryLabel(selected[0])
        : t('recipe.latest_imports');

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

      <div className="mb-6 space-y-5">
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
          trailing={
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              aria-label={t('search.filter_action')}
              title={t('search.filter_action')}
              className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] text-saffron transition-colors duration-[var(--duration-fast)] hover:bg-paper"
            >
              <SlidersHorizontal size={17} strokeWidth={1.5} aria-hidden="true" />
              {selected.length > 0 && (
                <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-saffron px-1 font-mono text-[0.6rem] leading-4 text-saffron-ink">
                  {selected.length}
                </span>
              )}
            </button>
          }
        />

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-saffron">
              {t('search.categories_label')}
            </span>
            <button
              type="button"
              onClick={() => setCustomizeOpen(true)}
              className="font-body text-sm font-medium text-saffron hover:underline"
            >
              {t('search.customize_link')}
            </button>
          </div>
          <CategoryTiles items={categoryItems} active={activeCategory} onPick={onPickCategory} />
        </div>
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
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-saffron">
              {sectionLabel}
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-muted">{filtered.length}</span>
          </div>
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
        </section>
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

      <CustomizeHomeSheet
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        library={library}
        homeTags={homeTags}
        onSave={saveHome}
        saving={updatePrimary.isPending}
      />
      <CategoryFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        library={library}
        selected={selected}
        onToggle={onToggleTag}
        onClear={() => setTagParam([])}
      />
    </main>
  );
}
