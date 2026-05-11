import { useAuth } from '@/lib/auth';
import { useRecipesAcrossHouseholds } from '@/lib/queries/recipes';
import { usePopularTags, useRecipeSearch } from '@/lib/queries/search';
import { Card } from '@/ui/primitives/Card';
import { EmptyState } from '@/ui/primitives/EmptyState';
import { SearchBar } from '@/ui/search/SearchBar';
import { TagStrip } from '@/ui/search/TagStrip';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import { requireHousehold } from './_guards';

const Search = z.object({
  q: z.string().optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
});

export const Route = createFileRoute('/search')({
  beforeLoad: requireHousehold,
  validateSearch: Search,
  component: SearchPage,
});

type SearchParams = z.infer<typeof Search>;

function SearchPage() {
  const params = Route.useSearch() as SearchParams;
  const nav = Route.useNavigate();
  const memberships = useAuth((s) => s.memberships);
  const householdIds = useMemo(() => memberships.map((m) => m.household_id), [memberships]);
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
      <h1 className="font-display text-3xl">Search</h1>
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
          onToggle={(tag) =>
            nav({
              search: (prev: SearchParams) => {
                const cur = Array.isArray(prev.tag) ? prev.tag : prev.tag ? [prev.tag] : [];
                const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
                return { ...prev, tag: next.length === 0 ? undefined : next };
              },
            })
          }
        />
      )}

      {!sourceLoading && filtered.length === 0 && (searchActive || selected.length > 0) && (
        <Card className="p-6">
          <EmptyState
            title="No matches"
            description={
              searchActive
                ? `Nothing matched "${q}"${selected.length > 0 ? ' with the selected tags' : ''}. Try a different word or clear the filters.`
                : 'No recipes match the selected tags. Try removing a tag.'
            }
            action={null}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((r) => (
            <li key={r.id}>
              <Card className="p-5">
                <h2 className="font-display text-xl mb-2">{r.title}</h2>
                {r.description && (
                  <p className="text-sm text-ink-soft line-clamp-3">{r.description}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
