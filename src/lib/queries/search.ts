import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { RecipeListRow } from './recipes';

export function useRecipeSearch(q: string, householdIds: string[]) {
  return useQuery({
    queryKey: ['search', q, householdIds],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_recipes', {
        q,
        household_ids: householdIds,
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as RecipeListRow[];
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
