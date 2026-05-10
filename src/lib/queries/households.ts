import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

export type HouseholdSettings = {
  id: string;
  name: string;
  allowed_tags: string[];
};

export function useHousehold(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId],
    queryFn: async (): Promise<HouseholdSettings> => {
      const { data, error } = await supabase
        .from('households')
        .select('id, name, allowed_tags')
        .eq('id', householdId)
        .single();
      if (error) throw error;
      const row = data as { id: string; name: string; allowed_tags?: unknown };
      return {
        id: row.id,
        name: row.name,
        allowed_tags: Array.isArray(row.allowed_tags)
          ? (row.allowed_tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
      };
    },
  });
}

// Returns just the allowed tag list. Recipe edit screens use this to populate
// the TagPicker chips. Sharing the same `['household', id]` cache key as
// useHousehold means the settings screen and the picker stay in sync after a
// mutation invalidates one entry.
export function useHouseholdAllowedTags(householdId: string): {
  tags: string[];
  isLoading: boolean;
} {
  const q = useHousehold(householdId);
  return { tags: q.data?.allowed_tags ?? [], isLoading: q.isLoading };
}

export function useUpdateHouseholdAllowedTags(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (allowedTags: string[]) => {
      const { error } = await supabase
        .from('households')
        .update({ allowed_tags: allowedTags })
        .eq('id', householdId);
      if (error) throw error;
      return allowedTags;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
    },
  });
}
