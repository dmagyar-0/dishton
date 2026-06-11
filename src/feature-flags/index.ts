// Typed feature-flag access. Build-time flags read import.meta.env. Runtime
// flags read app.feature_flags via TanStack Query and Supabase Realtime.

import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { FLAGS, type FlagDefinition } from './registry';

const BUILD_TIME = new Map<string, FlagDefinition>(
  FLAGS.filter((f) => f.transport === 'build-time').map((f) => [f.key, f]),
);
const RUNTIME = new Map<string, FlagDefinition>(
  FLAGS.filter((f) => f.transport === 'runtime').map((f) => [f.key, f]),
);

function readBuildTime(key: string): boolean {
  const def = BUILD_TIME.get(key);
  if (!def?.envVar) return false;
  const v = (import.meta.env as Record<string, string | undefined>)[def.envVar];
  return v === 'true' || v === '1';
}

function useFlagQuery(key: string, isRuntime: boolean) {
  // Runs unconditionally so the React rules are satisfied; `enabled`
  // short-circuits the actual DB fetch when the flag is build-time.
  // FLAG: keep this dispatch in sync with registry.ts.
  return useQuery({
    queryKey: ['feature-flag', key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      return (data as { enabled?: boolean } | null)?.enabled ?? false;
    },
    enabled: isRuntime,
    staleTime: 60_000,
  });
}

export function useFeatureFlag(key: string): boolean {
  const { data } = useFlagQuery(key, RUNTIME.has(key));
  if (BUILD_TIME.has(key)) return readBuildTime(key);
  return data === true;
}

/**
 * Like {@link useFeatureFlag}, but also reports whether the flag value is known
 * yet. Build-time flags are always resolved. Runtime flags are unresolved while
 * their first DB read is in flight — callers that gate routing on a flag must
 * wait for `isResolved` before acting, or a cold page load decides on the
 * default-off value and (e.g.) redirects/crashes before the real value arrives.
 */
export function useFeatureFlagStatus(key: string): { enabled: boolean; isResolved: boolean } {
  const query = useFlagQuery(key, RUNTIME.has(key));
  if (BUILD_TIME.has(key)) return { enabled: readBuildTime(key), isResolved: true };
  return { enabled: query.data === true, isResolved: !query.isLoading };
}

export type { FlagDefinition };
export { FLAGS };
