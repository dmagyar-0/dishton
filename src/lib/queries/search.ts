import { track } from '@/observability/analytics';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { RecipeListRow } from './recipes';

// `includeLinks` widens the search to recipes SAVED into these households from
// households they follow (see queries/recipe-links.ts). Pass it only where the
// browse list also merges links -- i.e. your own household -- so what search
// finds matches what the list shows.
export function useRecipeSearch(q: string, householdIds: string[], includeLinks = false) {
  return useQuery({
    queryKey: ['search', q, householdIds, includeLinks],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_recipes', {
        q,
        household_ids: householdIds,
        include_links: includeLinks,
      });
      if (error) throw error;
      // A hit whose household isn't one we searched can only have arrived via
      // the link branch, so it needs the same badge/remove treatment the browse
      // list gives links. No extra round-trip needed to tell them apart.
      const searched = new Set(householdIds);
      const rows = ((data ?? []) as unknown as RecipeListRow[]).map((r) =>
        searched.has(r.household_id) ? r : { ...r, is_link: true },
      );
      // Never the query text itself -- just that a search ran and how many
      // results it found.
      track('search_performed', { result_count: rows.length });
      if (rows.length === 0) return rows;
      const ids = rows.map((r) => r.id);
      const { data: tagRows, error: tagErr } = await supabase
        .from('recipe_tags')
        .select('recipe_id, tag')
        .in('recipe_id', ids);
      if (tagErr) throw tagErr;
      const byRecipe = new Map<string, { tag: string }[]>();
      for (const row of (tagRows ?? []) as { recipe_id: string; tag: string }[]) {
        const list = byRecipe.get(row.recipe_id) ?? [];
        list.push({ tag: row.tag });
        byRecipe.set(row.recipe_id, list);
      }
      return rows.map((r) => ({ ...r, recipe_tags: byRecipe.get(r.id) ?? [] }));
    },
    staleTime: 30_000,
  });
}

export function usePopularTags(householdIds: string[]) {
  return useQuery({
    queryKey: ['popular-tags', householdIds],
    // No accessible households means there is nothing to aggregate; skip the
    // round-trip entirely (mirrors useRecipesAcrossHouseholds' guard).
    enabled: householdIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('popular_tags', {
        p_household_ids: householdIds,
        p_limit: 24,
      });
      if (error) throw error;
      return (data ?? []) as unknown as { tag: string; n: number }[];
    },
    staleTime: 5 * 60_000,
  });
}
