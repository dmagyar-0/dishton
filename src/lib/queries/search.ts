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
      return (data ?? []) as unknown as RecipeListRow[];
    },
    staleTime: 30_000,
  });
}

export function usePopularTags(householdIds: string[]) {
  return useQuery({
    queryKey: ['popular-tags', householdIds],
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
