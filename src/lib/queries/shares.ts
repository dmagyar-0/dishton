// Share-link management (members/editors) + the anon public read path.

import type { Quantity } from '@/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { RECIPE_IMAGES_BUCKET, isRemoteImageUrl } from './storage';

export type RecipeShare = { token: string };

export function useRecipeShare(recipeId: string) {
  return useQuery({
    queryKey: ['recipe-share', recipeId],
    queryFn: async (): Promise<RecipeShare | null> => {
      const { data, error } = await supabase
        .from('recipe_shares')
        .select('token')
        .eq('recipe_id', recipeId)
        .maybeSingle();
      if (error) throw error;
      return (data as RecipeShare | null) ?? null;
    },
  });
}

export function useEnableShare(recipeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RecipeShare> => {
      const { data, error } = await supabase
        .from('recipe_shares')
        .insert({ recipe_id: recipeId })
        .select('token')
        .single();
      if (error) throw error;
      return data as RecipeShare;
    },
    onSuccess: (share) => {
      qc.setQueryData(['recipe-share', recipeId], share);
    },
  });
}

export function useDisableShare(recipeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recipe_shares').delete().eq('recipe_id', recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.setQueryData(['recipe-share', recipeId], null);
    },
  });
}

// ---------------------------------------------------------------------------
// Public (anon-capable) reads
// ---------------------------------------------------------------------------

export type PublicRecipePayload = {
  recipe: {
    title: string;
    description: string | null;
    source_type: 'url' | 'instagram' | 'photo' | 'manual';
    source_url: string | null;
    source_language: string;
    canonical_unit_system: 'metric' | 'imperial';
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
    tags: string[];
    ingredients: {
      position: number;
      raw_text: string;
      quantity: Quantity | null;
      unit: string | null;
      ingredient_name: string | null;
      notes: string | null;
      section: string | null;
    }[];
    steps: { position: number; body: string; duration_min: number | null }[];
  };
  household_name: string;
};

export function usePublicRecipe(token: string) {
  return useQuery({
    queryKey: ['public-recipe', token],
    queryFn: async (): Promise<PublicRecipePayload | null> => {
      const { data, error } = await supabase.rpc('get_public_recipe', { share_token: token });
      if (error) throw error;
      return (data ?? null) as PublicRecipePayload | null;
    },
    staleTime: 60_000,
  });
}

// Hero loader that works for anon viewers: signed URLs require an
// authenticated session, but a direct download passes the share-keyed storage
// RLS branch with the anon key. Remote (imported) heroes are used verbatim.
export function usePublicHeroImage(path: string | null): string | null {
  const q = useQuery({
    queryKey: ['public-hero', path ?? null],
    enabled: path != null && path !== '',
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string | null> => {
      if (!path) return null;
      if (isRemoteImageUrl(path)) return path;
      const { data, error } = await supabase.storage.from(RECIPE_IMAGES_BUCKET).download(path);
      if (error || !data) return null;
      return URL.createObjectURL(data);
    },
  });
  if (path && isRemoteImageUrl(path)) return path;
  return q.data ?? null;
}
