// "Save to pantry" links: references from your household to recipes owned by
// households you follow. The link is live — each row resolves the current
// original recipe, so source edits show through. See
// docs/superpowers/specs/2026-06-14-followed-recipe-pantry-links-design.md.

import { useAuth } from '@/lib/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { RecipeListRow } from './recipes';

// A pantry link, flattened to the same shape as an own-recipe list row so the
// home grid can render both side by side. `is_link` drives the badge; the
// resolved fields (id, household_id, ...) point at the ORIGINAL recipe, so the
// card links straight to the source.
export type LinkedRecipeRow = RecipeListRow & { is_link: true };

// The canonical household a solo user saves into: their personal household,
// falling back to the first membership. Mirrors /following's target selection
// so a saved recipe lands where the user's own recipes live.
export function usePantryHouseholdId(): string {
  return useAuth(
    (s) => (s.memberships.find((m) => m.is_personal) ?? s.memberships[0])?.household_id ?? '',
  );
}

export function useRecipeLinks(householdId: string, enabled = true) {
  return useQuery({
    queryKey: ['recipe-links', householdId],
    enabled: enabled && householdId.length > 0,
    queryFn: async (): Promise<LinkedRecipeRow[]> => {
      // `recipes!inner` drops links whose original isn't visible to the reader
      // (e.g. an unfollowed household), so dangling links never render. The
      // link's created_at becomes the row's sort key, so a freshly saved recipe
      // surfaces at the top of the pantry.
      const { data, error } = await supabase
        .from('recipe_links')
        .select(
          'created_at, recipe:recipes!inner(id, household_id, title, description, hero_image_path, total_time_min, source_type, recipe_tags(tag))',
        )
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      type Joined = { created_at: string; recipe: Omit<RecipeListRow, 'created_at'> };
      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        ...row.recipe,
        created_at: row.created_at,
        is_link: true,
      }));
    },
    staleTime: 60_000,
  });
}

// The set of recipe ids the given household has already saved, so a followed
// household's cards can show "saved" without a per-card query.
export function useLinkedRecipeIds(householdId: string, enabled = true) {
  return useQuery({
    queryKey: ['recipe-links', householdId, 'ids'],
    enabled: enabled && householdId.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('recipe_links')
        .select('recipe_id')
        .eq('household_id', householdId);
      if (error) throw error;
      return new Set(((data ?? []) as { recipe_id: string }[]).map((r) => r.recipe_id));
    },
    staleTime: 60_000,
  });
}

function invalidateLinks(qc: ReturnType<typeof useQueryClient>, householdId: string) {
  void qc.invalidateQueries({ queryKey: ['recipe-links', householdId] });
  void qc.invalidateQueries({ queryKey: ['recipes', householdId] });
}

export function useSaveRecipeLink(householdId: string) {
  const qc = useQueryClient();
  const profileId = useAuth((s) => s.profile?.id ?? '');
  return useMutation({
    mutationFn: async (recipeId: string) => {
      // RLS turns a forbidden insert into an error; surface it so the UI can
      // toast. created_by must equal the caller per the insert policy.
      const { error } = await supabase
        .from('recipe_links')
        .insert({ household_id: householdId, recipe_id: recipeId, created_by: profileId });
      if (error) throw error;
      return recipeId;
    },
    onSuccess: () => invalidateLinks(qc, householdId),
  });
}

export function useRemoveRecipeLink(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      // `.select()` so RLS no-ops (0 rows) don't read as a false success.
      const { data, error } = await supabase
        .from('recipe_links')
        .delete()
        .eq('household_id', householdId)
        .eq('recipe_id', recipeId)
        .select('recipe_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('recipe_link_remove_not_permitted');
      return recipeId;
    },
    onSuccess: () => invalidateLinks(qc, householdId),
  });
}
