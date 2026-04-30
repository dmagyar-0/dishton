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

export function useFeatureFlag(key: string): boolean {
  // The hook below runs unconditionally; `enabled` short-circuits the actual
  // DB fetch when the flag is build-time so the React rules are satisfied.
  // FLAG: keep this dispatch in sync with registry.ts.
  const isRuntime = RUNTIME.has(key);
  const { data } = useQuery({
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
  if (BUILD_TIME.has(key)) return readBuildTime(key);
  return data === true;
}

export type { FlagDefinition };
export { FLAGS };
