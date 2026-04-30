import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

export function useTranslateRecipe(recipeId: string, language: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('translate-recipe', {
        body: { recipe_id: recipeId, language },
      });
      if (error) throw error;
      return data as { payload: unknown; cached: boolean };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
    },
  });
}

export function useCachedTranslations(recipeId: string) {
  return useQuery({
    queryKey: ['translations', recipeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipe_translations')
        .select('language')
        .eq('recipe_id', recipeId);
      if (error) throw error;
      return (data ?? []).map((r: { language: string }) => r.language);
    },
    staleTime: 60_000,
  });
}
