import type { Recipe } from '@/domain/recipe';
import { useAuth } from '@/lib/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

export type RecipeListRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  hero_image_path: string | null;
  total_time_min: number | null;
  source_type: 'url' | 'instagram' | 'photo' | 'manual';
  created_at: string;
  recipe_tags: { tag: string }[] | null;
};

export function useRecipeList(householdId: string) {
  return useQuery({
    queryKey: ['recipes', householdId],
    queryFn: async (): Promise<RecipeListRow[]> => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          'id, household_id, title, description, hero_image_path, total_time_min, source_type, created_at, recipe_tags(tag)',
        )
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as RecipeListRow[];
    },
    staleTime: 60_000,
  });
}

export function useRecipesAcrossHouseholds(householdIds: string[], enabled = true) {
  return useQuery({
    queryKey: ['recipes-across', householdIds],
    enabled: enabled && householdIds.length > 0,
    queryFn: async (): Promise<RecipeListRow[]> => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          'id, title, description, hero_image_path, total_time_min, source_type, created_at, recipe_tags(tag)',
        )
        .in('household_id', householdIds)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as RecipeListRow[];
    },
    staleTime: 60_000,
  });
}

export type FullRecipe = {
  recipe: {
    id: string;
    household_id: string;
    title: string;
    description: string | null;
    source_type: 'url' | 'instagram' | 'photo' | 'manual';
    source_url: string | null;
    source_language: string;
    canonical_unit_system: 'metric' | 'imperial';
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
  };
  ingredients: {
    id: string;
    position: number;
    raw_text: string;
    quantity: number | null;
    unit: string | null;
    ingredient_name: string | null;
    notes: string | null;
    section: string | null;
  }[];
  steps: { id: string; position: number; body: string; duration_min: number | null }[];
  tags: string[];
};

export function useDeleteRecipe(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
      if (error) throw error;
      return recipeId;
    },
    onSuccess: (recipeId) => {
      void qc.invalidateQueries({ queryKey: ['recipes', householdId] });
      qc.removeQueries({ queryKey: ['recipe', recipeId] });
    },
  });
}

export function useUpdateRecipe(recipeId: string, householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: Recipe) => {
      const { error } = await supabase.rpc('update_recipe', {
        p_id: recipeId,
        p_draft: draft as never,
      });
      if (error) throw error;
      return recipeId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      void qc.invalidateQueries({ queryKey: ['recipes', householdId] });
    },
  });
}

// Whether the signed-in user can edit recipes in the given household.
// Mirrors the server-side `is_recipe_editor()` RLS check: any membership
// with role 'owner' or 'editor' qualifies (which is every membership in
// the current data model — followers aren't stored in `memberships`).
export function useIsRecipeEditor(householdId: string): boolean {
  const memberships = useAuth((s) => s.memberships);
  return memberships.some(
    (m) => m.household_id === householdId && (m.role === 'owner' || m.role === 'editor'),
  );
}

export function useRecipe(recipeId: string) {
  return useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: async (): Promise<FullRecipe> => {
      const [r, ings, steps, tags] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', recipeId).single(),
        supabase.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('position'),
        supabase.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('position'),
        supabase.from('recipe_tags').select('tag').eq('recipe_id', recipeId),
      ]);
      if (r.error) throw r.error;
      if (ings.error) throw ings.error;
      if (steps.error) throw steps.error;
      if (tags.error) throw tags.error;
      return {
        recipe: r.data as FullRecipe['recipe'],
        ingredients: (ings.data ?? []) as FullRecipe['ingredients'],
        steps: (steps.data ?? []) as FullRecipe['steps'],
        tags: ((tags.data ?? []) as { tag: string }[]).map((t) => t.tag),
      };
    },
  });
}
