// TanStack Query hook for the /admin/metrics dashboard's Users section.
// Wraps `app.list_app_users()` from
// supabase/migrations/20260914150000_admin_list_users.sql -- SECURITY
// DEFINER, gated on `app.is_app_admin()` server-side. A non-admin caller
// gets a Postgres exception (`not_app_admin`), surfaced here as a normal
// react-query error; the route itself never lets a non-admin reach this page
// (see src/routes/_guards.ts#requireAppAdmin), so that error path is a
// defence-in-depth backstop, not the primary gate.
//
// Kept separate from src/lib/queries/metrics.ts: this isn't a date-ranged
// analytics metric, it's a point-in-time roster.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

export type AppUserRow = {
  profile_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async (): Promise<AppUserRow[]> => {
      const { data, error } = await supabase.rpc('list_app_users');
      if (error) throw error;
      return (data ?? []) as unknown as AppUserRow[];
    },
    staleTime: 60_000,
  });
}
