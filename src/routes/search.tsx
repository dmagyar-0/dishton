import { useFeatureFlag } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { useFollowedHouseholds } from '@/lib/queries/households';
import { useRecipesAcrossHouseholds } from '@/lib/queries/recipes';
import { usePopularTags, useRecipeSearch } from '@/lib/queries/search';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { RecipeCardMedia } from '@/ui/recipe/RecipeCardMedia';
import { SearchBar } from '@/ui/search/SearchBar';
import { TagStrip } from '@/ui/search/TagStrip';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { requireAuth } from './_guards';

const Search = z.object({
  q: z.string().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
});

export const Route = createFileRoute('/search')({
  beforeLoad: requireAuth,
  validateSearch: Search,
  component: SearchPage,
});

type SearchParams = z.infer<typeof Search>;

function SearchPage() {
  const { t } = useTranslation();
  const params = Route.useSearch() as SearchParams;
  const nav = Route.useNavigate();
  const memberships = useAuth((s) => s.memberships);
  // Canonical household for the follow scope: prefer the personal household so
  // search scoping lines up with the /following list and AppShell (both keyed
  // on the personal household). Follows are created against this household.
  const canonicalHouseholdId = useMemo(
    () => (memberships.find((m) => m.is_personal) ?? memberships[0])?.household_id ?? '',
    [memberships],
  );
  // FLAG: follows_enabled — only widen the search scope to followed households
  // when following is enabled, matching the /following route + nav gating.
  const followsEnabled = useFeatureFlag('follows_enabled');
  const followed = useFollowedHouseholds(followsEnabled ? canonicalHouseholdId : '');
  // Search and tags cover the full accessible surface: own households plus the
  // households this user follows (docs/10 — own + followed scoping). RLS still
  // strips anything the caller cannot read, so merging here is purely additive.
  const householdIds = useMemo(() => {
    const ids = new Set(memberships.map((m) => m.household_id));
    if (followsEnabled) for (const f of followed.data ?? []) ids.add(f.followed_household_id);
    return [...ids];
  }, [memberships, followed.data, followsEnabled]);
  const tagParam = params.tag;
  const selected = useMemo(
    () => (Array.isArray(tagParam) ? tagParam : tagParam ? [tagParam] : []),
    [tagParam],
  );

  const q = params.q ?? '';
  const searchActive = q.trim().length >= 2;
  const search = useRecipeSearch(q, householdIds);
  const list = useRecipesAcrossHouseholds(householdIds, !searchActive);
  const tags = usePopularTags(householdIds);

  // Cloud is auto-collapsed whenever a text query is active or tags are selected,
  // so results appear immediately after the search input. The user can re-expand
  // via the disclosure toggle without losing their tag filters.
  const cloudShouldCollapse = searchActive || selected.length > 0;
  const [cloudManuallyExpanded, setCloudManuallyExpanded] = useState(false);
  // Reset manual expansion each time the trigger condition flips to true (i.e. a
  // new query is typed after the user previously expanded the cloud). This ensures
  // the cloud re-collapses on a fresh search without clearing active tag filters.
  useEffect(() => {
    if (!cloudShouldCollapse) setCloudManuallyExpanded(false);
  }, [cloudShouldCollapse]);
  const cloudCollapsed = cloudShouldCollapse && !cloudManuallyExpanded;

  const source = searchActive ? search.data : list.data;
  const sourceFetching = searchActive ? search.isFetching : list.isFetching;
  const sourceLoading = searchActive ? search.isLoading : list.isLoading;

  const filtered = useMemo(() => {
    if (!source) return [];
    if (selected.length === 0) return source;
    return source.filter((r) => {
      const rt = (r.recipe_tags ?? []).map((t: { tag: string }) => t.tag);
      return selected.every((tag: string) => rt.includes(tag));
    });
  }, [source, selected]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="font-display text-3xl">{t('search.title')}</h1>
      <SearchBar
        value={q}
        loading={sourceFetching}
        onChange={(value) =>
          nav({
            search: (prev: SearchParams) => ({ ...prev, q: value === '' ? undefined : value }),
          })
        }
      />
      {tags.data && (
        <TagStrip
          tags={tags.data}
          selected={selected}
          collapsed={cloudCollapsed}
          onCollapseToggle={
            cloudShouldCollapse ? () => setCloudManuallyExpanded((v) => !v) : undefined
          }
          onToggle={(tag) => {
            // When a tag is toggled while collapsed, always auto-collapse again
            // so results remain visible. If the user has manually expanded, keep
            // them in the expanded view.
            nav({
              search: (prev: SearchParams) => {
                const cur = Array.isArray(prev.tag) ? prev.tag : prev.tag ? [prev.tag] : [];
                const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
                return { ...prev, tag: next.length === 0 ? undefined : next };
              },
            });
          }}
        />
      )}

      {!sourceLoading && filtered.length === 0 && (searchActive || selected.length > 0) && (
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((r) => (
            <li key={r.id}>
              <Link
                to="/h/$householdId/r/$recipeId"
                params={{ householdId: r.household_id, recipeId: r.id }}
                className="block group/link"
              >
                <Card className="p-0 overflow-hidden h-full">
                  <RecipeCardMedia heroImagePath={r.hero_image_path} title={r.title} />
                  <div className="p-5">
                    <h2 className="font-display text-xl mb-2">{r.title}</h2>
                    {r.description && (
                      <p className="text-sm text-ink-soft line-clamp-3">{r.description}</p>
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
