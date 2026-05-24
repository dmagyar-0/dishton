import { refreshAuthDerivedState, useAuth } from '@/lib/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

export type HouseholdSettings = {
  id: string;
  name: string;
  allowed_tags: string[];
  is_personal: boolean;
};

export type HouseholdMember = {
  household_id: string;
  profile_id: string;
  role: 'owner' | 'editor';
  joined_at: string;
  profile: { display_name: string; avatar_url: string | null };
};

export type HouseholdInvite = {
  code: string;
  created_by: string;
  expires_at: string;
  created_at: string;
};

export type HouseholdFollowCode = {
  code: string;
  created_by: string;
  expires_at: string;
  created_at: string;
};

export type FollowedHousehold = {
  followed_household_id: string;
  household: { id: string; name: string };
  created_at: string;
};

export type FollowerHousehold = {
  follower_household_id: string;
  household: { id: string; name: string };
  created_at: string;
};

export function useHousehold(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId],
    queryFn: async (): Promise<HouseholdSettings> => {
      const { data, error } = await supabase
        .from('households')
        .select('id, name, allowed_tags, is_personal')
        .eq('id', householdId)
        .single();
      if (error) throw error;
      const row = data as {
        id: string;
        name: string;
        allowed_tags?: unknown;
        is_personal?: unknown;
      };
      return {
        id: row.id,
        name: row.name,
        allowed_tags: Array.isArray(row.allowed_tags)
          ? (row.allowed_tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
        is_personal: row.is_personal === true,
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

export function useUpdateHouseholdName(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('households').update({ name }).eq('id', householdId);
      if (error) throw error;
      return name;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
    },
  });
}

export function useHouseholdMembers(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId, 'members'],
    queryFn: async (): Promise<HouseholdMember[]> => {
      const { data, error } = await supabase
        .from('household_members')
        .select(
          'household_id, profile_id, role, joined_at, profiles!inner(display_name, avatar_url)',
        )
        .eq('household_id', householdId)
        .order('joined_at', { ascending: true });
      if (error) throw error;
      const rows =
        (data as unknown as Array<{
          household_id: string;
          profile_id: string;
          role: 'owner' | 'editor';
          joined_at: string;
          profiles: { display_name: string; avatar_url: string | null };
        }>) ?? [];
      return rows.map((r) => ({
        household_id: r.household_id,
        profile_id: r.profile_id,
        role: r.role,
        joined_at: r.joined_at,
        profile: {
          display_name: r.profiles.display_name,
          avatar_url: r.profiles.avatar_url,
        },
      }));
    },
  });
}

export function useHouseholdInvites(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId, 'invites'],
    queryFn: async (): Promise<HouseholdInvite[]> => {
      const { data, error } = await supabase
        .from('household_invites')
        .select('code, created_by, expires_at, created_at')
        .eq('household_id', householdId)
        .is('redeemed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as HouseholdInvite[]) ?? [];
    },
  });
}

export function useHouseholdFollowCodes(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId, 'follow_codes'],
    queryFn: async (): Promise<HouseholdFollowCode[]> => {
      const { data, error } = await supabase
        .from('household_follow_codes')
        .select('code, created_by, expires_at, created_at')
        .eq('household_id', householdId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as HouseholdFollowCode[]) ?? [];
    },
  });
}

export function useFollowedHouseholds(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId, 'following'],
    queryFn: async (): Promise<FollowedHousehold[]> => {
      const { data, error } = await supabase
        .from('follows')
        .select(
          'followed_household_id, created_at, households!follows_followed_household_id_fkey(id, name)',
        )
        .eq('follower_household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows =
        (data as unknown as Array<{
          followed_household_id: string;
          created_at: string;
          households: { id: string; name: string };
        }>) ?? [];
      return rows.map((r) => ({
        followed_household_id: r.followed_household_id,
        created_at: r.created_at,
        household: r.households,
      }));
    },
  });
}

export function useFollowersOfHousehold(householdId: string) {
  return useQuery({
    queryKey: ['household', householdId, 'followers'],
    queryFn: async (): Promise<FollowerHousehold[]> => {
      const { data, error } = await supabase
        .from('follows')
        .select(
          'follower_household_id, created_at, households!follows_follower_household_id_fkey(id, name)',
        )
        .eq('followed_household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows =
        (data as unknown as Array<{
          follower_household_id: string;
          created_at: string;
          households: { id: string; name: string };
        }>) ?? [];
      return rows.map((r) => ({
        follower_household_id: r.follower_household_id,
        created_at: r.created_at,
        household: r.households,
      }));
    },
  });
}

export function useCreateInvite(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('create_invite', {
        p_household: householdId,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'invites'] });
    },
  });
}

export function useRevokeInvite(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase.from('household_invites').delete().eq('code', code);
      if (error) throw error;
      return code;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'invites'] });
    },
  });
}

export function useRemoveMember(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase
        .from('household_members')
        .delete()
        .match({ household_id: householdId, profile_id: profileId });
      if (error) throw error;
      return profileId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'members'] });
    },
  });
}

export function useChangeMemberRole(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { profileId: string; role: 'owner' | 'editor' }) => {
      const { error } = await supabase
        .from('household_members')
        .update({ role: args.role })
        .match({ household_id: householdId, profile_id: args.profileId });
      if (error) throw error;
      return args;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'members'] });
    },
  });
}

export function useLeaveHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (householdId: string) => {
      const { error } = await supabase.rpc('leave_household', { p_household: householdId });
      if (error) throw error;
      const remaining = useAuth
        .getState()
        .memberships.filter((m) => m.household_id !== householdId);
      useAuth.getState().setMemberships(remaining);
      return householdId;
    },
    onSuccess: (householdId) => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
    },
  });
}

// Leaves the household but pulls the caller's authored recipes into a
// fresh personal household. Returns the new personal household id so the
// caller can route there immediately; the server-side RPC reuses an
// existing personal household if one is already linked to the user.
export function useLeaveHouseholdWithRecipes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (householdId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('leave_household_with_recipes', {
        p_household: householdId,
      });
      if (error) throw error;
      const newPersonalId = data as unknown as string;
      const user = useAuth.getState().user;
      if (user) {
        await refreshAuthDerivedState(user.id);
      }
      return newPersonalId;
    },
    onSuccess: (newPersonalId, householdId) => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
      void qc.invalidateQueries({ queryKey: ['recipes', householdId] });
      void qc.invalidateQueries({ queryKey: ['recipes', newPersonalId] });
    },
  });
}

export function useTransferOwnership(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (newOwnerProfileId: string) => {
      const { error } = await supabase.rpc('transfer_ownership', {
        p_household: householdId,
        p_new_owner: newOwnerProfileId,
      });
      if (error) throw error;
      const auth = useAuth.getState();
      auth.setMemberships(
        auth.memberships.map((m) =>
          m.household_id === householdId ? { ...m, role: 'editor' as const } : m,
        ),
      );
      return newOwnerProfileId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
    },
  });
}

export function useDeleteHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (householdId: string) => {
      const { error } = await supabase.from('households').delete().eq('id', householdId);
      if (error) throw error;
      const remaining = useAuth
        .getState()
        .memberships.filter((m) => m.household_id !== householdId);
      useAuth.getState().setMemberships(remaining);
      return householdId;
    },
    onSuccess: (householdId) => {
      void qc.invalidateQueries({ queryKey: ['household', householdId] });
    },
  });
}

export function useCreateFollowCode(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('create_follow_code', {
        p_household: householdId,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'follow_codes'] });
    },
  });
}

export function useRevokeFollowCode(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase.from('household_follow_codes').delete().eq('code', code);
      if (error) throw error;
      return code;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household', householdId, 'follow_codes'] });
    },
  });
}

export function useAddFollow(currentHouseholdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc('add_follow', { p_code: code });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['household', currentHouseholdId, 'following'],
      });
    },
  });
}

export function useUnfollow(currentHouseholdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (followedHouseholdId: string) => {
      const { error } = await supabase.from('follows').delete().match({
        follower_household_id: currentHouseholdId,
        followed_household_id: followedHouseholdId,
      });
      if (error) throw error;
      return followedHouseholdId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['household', currentHouseholdId, 'following'],
      });
    },
  });
}
