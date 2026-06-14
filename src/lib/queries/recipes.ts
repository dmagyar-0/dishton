import type { Quantity, Recipe } from '@/domain/recipe';
import { useAuth } from '@/lib/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { RECIPE_IMAGES_BUCKET, isRemoteImageUrl } from './storage';

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
  // Set on rows that are pantry links to a followed household's recipe (see
  // recipe-links.ts), so the home grid can badge them. Absent on own recipes.
  is_link?: boolean;
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
          'id, household_id, title, description, hero_image_path, total_time_min, source_type, created_at, recipe_tags(tag)',
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
    updated_at: string;
  };
  ingredients: {
    id: string;
    position: number;
    raw_text: string;
    // quantity is stored as jsonb and round-trips the domain Quantity union
    // (a number or a {numerator,denominator} fraction object) or null.
    quantity: Quantity | null;
    unit: string | null;
    ingredient_name: string | null;
    notes: string | null;
    section: string | null;
  }[];
  steps: { id: string; position: number; body: string; duration_min: number | null }[];
  tags: string[];
};

export type DeleteRecipeArgs = {
  recipeId: string;
  // The recipe's hero_image_path (as held in the list row), passed so we can
  // free its storage object after the row is gone. Null or a remote URL means
  // there is nothing in our bucket to delete.
  heroImagePath: string | null;
};

export function useDeleteRecipe(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, heroImagePath }: DeleteRecipeArgs) => {
      // `.select()` makes the DELETE return the rows it actually removed. RLS
      // turns a forbidden delete into a 0-row no-op rather than an error, so
      // without this check an unauthorized (or already-deleted) delete would
      // surface to the user as a false success.
      const { data, error } = await supabase
        .from('recipes')
        .delete()
        .eq('id', recipeId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('recipe_delete_not_permitted');
      }

      // Best-effort: free the hero image blob now that the recipe is gone.
      // Externally-imported heroes are remote URLs (nothing in our bucket);
      // our own uploads are storage paths. The recipe row is the source of
      // truth, so a storage failure (network, or RLS scoping deletes to the
      // uploader's own folder in a shared household) must not fail the delete.
      if (heroImagePath && !isRemoteImageUrl(heroImagePath)) {
        try {
          await supabase.storage.from(RECIPE_IMAGES_BUCKET).remove([heroImagePath]);
        } catch {
          // ignore — an orphaned blob is a cleanup concern, not a user error
        }
      }
      return recipeId;
    },
    onSuccess: (recipeId) => {
      void qc.invalidateQueries({ queryKey: ['recipes', householdId] });
      qc.removeQueries({ queryKey: ['recipe', recipeId] });
    },
  });
}

export type UpdateRecipeArgs = {
  draft: Recipe;
  // Optimistic-concurrency token: the recipe's updated_at as loaded into the
  // edit form. The update_recipe RPC raises `recipe_edit_conflict` when the row
  // has changed since, preventing a second editor from silently clobbering the
  // first. Pass null/undefined to skip the check (last-write-wins).
  expectedUpdatedAt?: string | null;
};

export function useUpdateRecipe(recipeId: string, householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ draft, expectedUpdatedAt }: UpdateRecipeArgs) => {
      const { error } = await supabase.rpc('update_recipe', {
        p_id: recipeId,
        p_draft: draft as never,
        p_expected_updated_at: expectedUpdatedAt ?? null,
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
