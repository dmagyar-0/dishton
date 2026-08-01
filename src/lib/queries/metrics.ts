// TanStack Query hooks for the /admin/metrics dashboard. Every hook wraps one
// of the six `app.metrics_*` RPCs from
// supabase/migrations/20260801120000_product_metrics.sql -- all SECURITY
// DEFINER, all gated on `app.is_app_admin()` server-side. A non-admin caller
// gets a Postgres exception (`not_app_admin`), surfaced here as a normal
// react-query error; the route itself never lets a non-admin reach this page
// (see src/routes/_guards.ts#requireAppAdmin), so that error path is a
// defence-in-depth backstop, not the primary gate.
//
// The Supabase client (src/lib/supabase.ts) is intentionally untyped against
// `Database`, so every RPC result is cast the same way the rest of
// src/lib/queries/*.ts casts embeds and RPC rows.

import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

export type DateRangeDays = 7 | 30 | 90;

export const DATE_RANGE_OPTIONS: readonly DateRangeDays[] = [7, 30, 90];

export type DateRange = { from: string; to: string };

// `p_from`/`p_to` are Postgres `date` params -- plain YYYY-MM-DD strings.
// `days` is inclusive of both endpoints (7 = today and the 6 days before).
export function dateRangeBounds(days: DateRangeDays, now: Date = new Date()): DateRange {
  const to = toDateOnly(now);
  const from = toDateOnly(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  return { from, to };
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Admin gate (used by the route guard, not a hook -- beforeLoad isn't a
// component). Fails closed: any RPC error or thrown exception (including the
// expected `not_app_admin` for a non-admin) means "not an admin", never
// "unknown, let them through".
// ---------------------------------------------------------------------------
export async function fetchIsAppAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_app_admin');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

// Reactive admin flag for UI (the AppShell nav entry, the metrics page
// itself). Only queried once signed in -- an anon RPC call would just fail
// is_app_admin's auth.uid() check, but there is no reason to make it.
export function useIsAppAdmin() {
  const session = useAuth((s) => s.session);
  return useQuery({
    queryKey: ['is-app-admin'],
    queryFn: fetchIsAppAdmin,
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Row shapes -- mirror the RETURNS TABLE columns in the migration exactly
// (see supabase/migrations/20260801120000_product_metrics.sql). Nullable
// aggregates (percentile_cont over an empty group) come back as `null` from
// Postgres regardless of what src/lib/database.types.ts declares, so p50/p95
// are typed nullable here.
// ---------------------------------------------------------------------------

export type ActiveUsersRow = {
  day: string;
  dau: number;
  wau_rolling: number;
  mau_rolling: number;
};

export type AppOpensRow = {
  day: string;
  opens: number;
  resumes: number;
  standalone_opens: number;
  unique_sessions: number;
};

export type ImportsRow = {
  day: string;
  kind: string;
  started: number;
  succeeded: number;
  failed: number;
  p50_ms: number | null;
  p95_ms: number | null;
};

export type AiCostRow = {
  day: string;
  function: string;
  model: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  usd: number;
  unpriced_calls: number;
};

export type EdgeFailuresRow = {
  day: string;
  fn: string | null;
  outcome: string | null;
  calls: number;
  p95_ms: number | null;
};

export type StuckImportRow = {
  id: string;
  profile_id: string | null;
  household_id: string | null;
  kind: string;
  status: string;
  created_at: string;
  age_minutes: number;
};

// ---------------------------------------------------------------------------
// Hooks. All admin-only, all scoped to the same [from, to] window from the
// dashboard's date-range selector, so query keys include the resolved bounds
// (not just `days`) -- a fresh page load and a "yesterday I picked 7d" load
// get the same cache entry only when the actual window matches.
// ---------------------------------------------------------------------------

export function useMetricsActiveUsers(range: DateRange) {
  return useQuery({
    queryKey: ['metrics', 'active-users', range.from, range.to],
    queryFn: async (): Promise<ActiveUsersRow[]> => {
      const { data, error } = await supabase.rpc('metrics_active_users', {
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ActiveUsersRow[];
    },
    staleTime: 60_000,
  });
}

export function useMetricsAppOpens(range: DateRange) {
  return useQuery({
    queryKey: ['metrics', 'app-opens', range.from, range.to],
    queryFn: async (): Promise<AppOpensRow[]> => {
      const { data, error } = await supabase.rpc('metrics_app_opens', {
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AppOpensRow[];
    },
    staleTime: 60_000,
  });
}

export function useMetricsImports(range: DateRange) {
  return useQuery({
    queryKey: ['metrics', 'imports', range.from, range.to],
    queryFn: async (): Promise<ImportsRow[]> => {
      const { data, error } = await supabase.rpc('metrics_imports', {
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ImportsRow[];
    },
    staleTime: 60_000,
  });
}

export function useMetricsAiCost(range: DateRange) {
  return useQuery({
    queryKey: ['metrics', 'ai-cost', range.from, range.to],
    queryFn: async (): Promise<AiCostRow[]> => {
      const { data, error } = await supabase.rpc('metrics_ai_cost', {
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AiCostRow[];
    },
    staleTime: 60_000,
  });
}

export function useMetricsEdgeFailures(range: DateRange) {
  return useQuery({
    queryKey: ['metrics', 'edge-failures', range.from, range.to],
    queryFn: async (): Promise<EdgeFailuresRow[]> => {
      const { data, error } = await supabase.rpc('metrics_edge_failures', {
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      return (data ?? []) as unknown as EdgeFailuresRow[];
    },
    staleTime: 60_000,
  });
}

// No date range -- "stuck" is defined server-side as "queued/running for
// >15 minutes right now" (see the migration), not a historical window.
export function useMetricsStuckImports() {
  return useQuery({
    queryKey: ['metrics', 'stuck-imports'],
    queryFn: async (): Promise<StuckImportRow[]> => {
      const { data, error } = await supabase.rpc('metrics_stuck_imports');
      if (error) throw error;
      return (data ?? []) as unknown as StuckImportRow[];
    },
    // Short staleTime: this is the closest thing the dashboard has to a
    // "something is on fire right now" signal.
    staleTime: 30_000,
  });
}
